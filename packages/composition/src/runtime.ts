import { Context, Fiber, FiberState } from 'cordis'
import type {
  ActivationResult,
  AgentScope,
  CompositionDefinition,
  CompositionRuntime,
  PluginContext,
} from '@ev-agent/plugin-sdk'

interface Candidate {
  readonly definition: CompositionDefinition
  readonly group: Fiber
  readonly plugins: Fiber[]
  readonly scopes: Set<Fiber>
  readonly missing: Set<string>
  readonly providedServices: Set<string>
  readonly servicePrefix: string
  readonly config: unknown
  pluginsStarted: boolean
}

interface ScopeRecord {
  readonly id: string
  readonly state: AgentScopeState
  readonly effects: Set<symbol>
  disposed: boolean
  fiber: Fiber | undefined
  candidate: Candidate | undefined
}

interface AgentScopeState {
  set<T>(key: string, value: T): void
  get<T>(key: string): T | undefined
  clear(): void
}

const ACTIVE = FiberState.ACTIVE
const PENDING = FiberState.PENDING

export function createCompositionRuntime(): CompositionRuntime {
  return new CordisCompositionRuntime()
}

class CordisCompositionRuntime implements CompositionRuntime {
  private readonly root = new Context()
  private readonly trackedEffects = new Set<symbol>()
  private readonly scopes = new Map<string, ScopeRecord>()
  private candidateCounter = 0
  private current: Candidate | undefined
  private pending: Candidate | undefined

  async activate(definition: CompositionDefinition, config?: unknown): Promise<ActivationResult> {
    await this.disposeCandidate(this.pending)
    this.pending = undefined

    try {
      definition.validateConfig?.(config)
    } catch {
      return { status: 'failed', reason: 'invalid_configuration' }
    }

    let candidate: Candidate | undefined
    try {
      candidate = await this.createCandidate(definition, config)
      const result = await this.settleCandidate(candidate)
      if (result.status === 'active') {
        await this.publishCandidate(candidate)
        return result
      }
      if (result.status === 'pending') {
        this.pending = candidate
        return result
      }

      await this.disposeCandidate(candidate)
      return result
    } catch {
      await this.disposeCandidate(candidate)
      if (this.pending === candidate) this.pending = undefined
      return { status: 'failed', reason: 'activation_failed' }
    }
  }

  async provideService(name: string, value: unknown): Promise<ActivationResult> {
    const candidate = this.pending
    if (!candidate) {
      return { status: 'failed', reason: 'missing_dependency', missing: [name] }
    }

    try {
      const provider = candidate.group.ctx.plugin({
        name: `service:${name}`,
        apply: (ctx: Context) => {
          ctx.provide(this.serviceName(candidate, name), value)
        },
      })
      candidate.plugins.push(provider)
      candidate.providedServices.add(name)

      const result = await this.settleCandidate(candidate)
      if (result.status === 'active') {
        await this.publishCandidate(candidate)
        return result
      }
      if (result.status === 'failed') {
        this.pending = undefined
        await this.disposeCandidate(candidate)
      }
      return result
    } catch {
      this.pending = undefined
      await this.disposeCandidate(candidate)
      return { status: 'failed', reason: 'activation_failed' }
    }
  }

  async deactivate(): Promise<void> {
    await this.disposeCandidate(this.pending)
    await this.disposeCandidate(this.current)
    this.pending = undefined
    this.current = undefined
  }

  async dispose(): Promise<void> {
    await this.deactivate()
    for (const record of [...this.scopes.values()]) {
      await this.scopeHandle(record).dispose()
    }
    await this.root.fiber.dispose()
  }

  currentId(): string | undefined {
    return this.current?.definition.id
  }

  currentVersion(): string | undefined {
    return this.current?.definition.version
  }

  activeEffectCount(): number {
    return this.trackedEffects.size
  }

  async openAgentScope(id: string): Promise<AgentScope> {
    const candidate = this.current
    if (!candidate) throw new Error('cannot open an Agent scope without an active composition')

    const existing = this.scopes.get(id)
    if (existing && !existing.disposed) return this.scopeHandle(existing)

    const record: ScopeRecord = {
      id,
      state: createAgentScopeState(),
      effects: new Set(),
      disposed: false,
      fiber: undefined,
      candidate: undefined,
    }
    this.scopes.set(id, record)
    try {
      await this.attachScope(record, candidate)
      return this.scopeHandle(record)
    } catch (error) {
      this.scopes.delete(id)
      throw error
    }
  }

  private async createCandidate(definition: CompositionDefinition, config: unknown): Promise<Candidate> {
    const servicePrefix = `composition:${definition.id}@${definition.version}:${++this.candidateCounter}:`
    const group = this.root.plugin({
      name: `composition:${definition.id}@${definition.version}`,
      apply: () => undefined,
    })
    await group.await()
    return {
      definition,
      group,
      plugins: [],
      scopes: new Set(),
      missing: new Set(),
      providedServices: new Set(),
      servicePrefix,
      config,
      pluginsStarted: false,
    }
  }

  private async settleCandidate(candidate: Candidate): Promise<ActivationResult> {
    candidate.missing.clear()
    const deferred = new Set(candidate.definition.deferredDependencies ?? [])

    if (!candidate.pluginsStarted) {
      for (const definition of candidate.definition.plugins) {
        for (const dependency of definition.requires ?? []) {
          if (!candidate.providedServices.has(dependency)) candidate.missing.add(dependency)
        }
      }

      const permanent = [...candidate.missing].filter((dependency) => !deferred.has(dependency))
      if (permanent.length > 0) {
        return { status: 'failed', reason: 'missing_dependency', missing: permanent }
      }
      if (candidate.missing.size > 0) {
        return { status: 'pending', missing: [...candidate.missing] }
      }

      for (const definition of candidate.definition.plugins) {
        const fiber = candidate.group.ctx.plugin({
          name: definition.id,
          inject: (definition.requires ?? []).map((dependency) => this.serviceName(candidate, dependency)),
          apply: (ctx: Context) => {
            const pluginContext: PluginContext = {
              compositionId: candidate.definition.id,
              config: candidate.config,
              effect: (label: string): void => this.trackEffect(ctx, label),
              getService: <T>(name: string): T | undefined =>
                ctx.get(this.serviceName(candidate, name), false) as T | undefined,
              requireService: <T>(name: string): T => {
                const value = ctx.get(this.serviceName(candidate, name), false) as T | undefined
                if (value === undefined) throw new Error(`required service "${name}" is unavailable`)
                return value
              },
            }
            return definition.setup?.(pluginContext)
          },
        })
        candidate.plugins.push(fiber)
      }
      candidate.pluginsStarted = true
    }

    await Promise.all(candidate.plugins.map((fiber) => fiber.await().catch(() => undefined)))
    let hasPending = false
    for (const [index, fiber] of candidate.plugins.entries()) {
      if (fiber.state === PENDING) {
        hasPending = true
        const definition = candidate.definition.plugins[index]
        for (const dependency of definition?.requires ?? []) {
          if (fiber.ctx.get(this.serviceName(candidate, dependency), false) === undefined) {
            candidate.missing.add(dependency)
          }
        }
        continue
      }
      if (fiber.state !== ACTIVE) return { status: 'failed', reason: 'activation_failed' }
    }

    const unresolved = [...candidate.missing]
    const permanent = unresolved.filter((dependency) => !deferred.has(dependency))
    if (permanent.length > 0) {
      return { status: 'failed', reason: 'missing_dependency', missing: permanent }
    }
    if (hasPending) return { status: 'pending', missing: unresolved }
    return { status: 'active' }
  }

  private async publishCandidate(candidate: Candidate): Promise<void> {
    const attachments: Array<{ readonly record: ScopeRecord; readonly fiber: Fiber }> = []
    try {
      for (const record of this.scopes.values()) {
        if (!record.disposed) attachments.push({ record, fiber: await this.createScopeFiber(record, candidate) })
      }
    } catch (error) {
      await Promise.all(attachments.map(({ fiber }) => fiber.dispose()))
      throw error
    }
    for (const { record, fiber } of attachments) {
      record.fiber = fiber
      record.candidate = candidate
      candidate.scopes.add(fiber)
    }
    this.pending = undefined
    const previous = this.current
    this.current = candidate
    await this.disposeCandidate(previous)
  }

  private async attachScope(record: ScopeRecord, candidate: Candidate): Promise<void> {
    const fiber = await this.createScopeFiber(record, candidate)
    record.fiber = fiber
    record.candidate = candidate
    candidate.scopes.add(fiber)
  }

  private async createScopeFiber(record: ScopeRecord, candidate: Candidate): Promise<Fiber> {
    const context = candidate.group.ctx.isolate('agent-state', Symbol(record.id))
    const fiber = context.plugin({
      name: `agent:${record.id}`,
      apply: (ctx: Context) => {
        ctx.provide('agent-state', record.state)
      },
    })
    await fiber.await()
    return fiber
  }

  private scopeHandle(record: ScopeRecord): AgentScope {
    return {
      id: record.id,
      set: <T>(key: string, value: T): void => {
        this.assertScopeUsable(record)
        this.scopeState(record).set(key, value)
      },
      get: <T>(key: string): T | undefined => {
        if (record.disposed) throw new Error(`Agent scope "${record.id}" is disposed`)
        return this.scopeState(record).get(key)
      },
      effect: (label: string): void => {
        this.assertScopeUsable(record)
        const fiber = record.fiber
        if (!fiber) throw new Error(`Agent scope "${record.id}" is not attached`)
        const token = Symbol(label)
        record.effects.add(token)
        try {
          this.trackEffect(fiber.ctx, label, () => record.effects.delete(token))
        } catch (error) {
          record.effects.delete(token)
          throw error
        }
      },
      effectCount: (): number => record.effects.size,
      dispose: async (): Promise<void> => {
        if (record.disposed) return
        record.disposed = true
        record.state.clear()
        record.effects.clear()
        const fiber = record.fiber
        record.fiber = undefined
        if (fiber && record.candidate) record.candidate.scopes.delete(fiber)
        record.candidate = undefined
        this.scopes.delete(record.id)
        await fiber?.dispose()
      },
    }
  }

  private assertScopeUsable(record: ScopeRecord): void {
    if (record.disposed) throw new Error(`Agent scope "${record.id}" is disposed`)
    if (!record.fiber || record.fiber.state !== ACTIVE) {
      throw new Error(`Agent scope "${record.id}" is not attached`)
    }
  }

  private scopeState(record: ScopeRecord): AgentScopeState {
    const state = record.fiber?.ctx.get('agent-state', false) as AgentScopeState | undefined
    return state ?? record.state
  }

  private serviceName(candidate: Candidate, name: string): string {
    return `${candidate.servicePrefix}${name}`
  }

  private trackEffect(ctx: Context, label: string, onDispose?: () => void): void {
    const token = Symbol(label)
    this.trackedEffects.add(token)
    try {
      ctx.effect(() => async () => {
        onDispose?.()
        this.trackedEffects.delete(token)
      }, label)
    } catch (error) {
      onDispose?.()
      this.trackedEffects.delete(token)
      throw error
    }
  }

  private async disposeCandidate(candidate: Candidate | undefined): Promise<void> {
    if (!candidate) return
    for (const fiber of candidate.scopes) {
      for (const record of this.scopes.values()) {
        if (record.fiber === fiber) {
          record.fiber = undefined
          record.candidate = undefined
        }
      }
    }
    await candidate.group.dispose()
  }
}

function createAgentScopeState(): AgentScopeState {
  const values = new Map<string, unknown>()
  return {
    set: <T>(key: string, value: T): void => {
      values.set(key, value)
    },
    get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
    clear: (): void => values.clear(),
  }
}
