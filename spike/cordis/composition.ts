import { Context, Fiber, FiberState } from 'cordis'

export type Cleanup = () => void | Promise<void>

export interface PluginContext {
  readonly compositionId: string
  effect(label: string): void
  getService<T>(name: string): T | undefined
  requireService<T>(name: string): T
}

export interface AgentScope {
  readonly id: string
  set<T>(key: string, value: T): void
  get<T>(key: string): T | undefined
  effect(label: string): void
  effectCount(): number
  dispose(): Promise<void>
}

export interface PluginDefinition {
  readonly id: string
  readonly requires?: readonly string[]
  readonly setup?: (context: PluginContext) => void | Cleanup
}

export interface CompositionDefinition {
  readonly id: string
  readonly plugins: readonly PluginDefinition[]
  /** Dependencies that are expected to be supplied after initial activation. */
  readonly deferredDependencies?: readonly string[]
}

export type ActivationResult =
  | { readonly status: 'active' }
  | { readonly status: 'pending'; readonly missing: readonly string[] }
  | { readonly status: 'failed'; readonly reason: 'invalid_configuration' | 'missing_dependency' | 'activation_failed' }

export interface CompositionRuntime {
  activate(definition: CompositionDefinition, config?: { readonly valid?: boolean }): Promise<ActivationResult>
  provideService(name: string, value: unknown): Promise<ActivationResult>
  deactivate(): Promise<void>
  dispose(): Promise<void>
  currentId(): string | undefined
  activeEffectCount(): number
  openAgentScope(id: string): AgentScope
}

interface Candidate {
  readonly definition: CompositionDefinition
  readonly group: Fiber
  readonly plugins: Fiber[]
  readonly scopes: Set<Fiber>
  readonly missing: Set<string>
}

const ACTIVE = FiberState.ACTIVE
const PENDING = FiberState.PENDING

export function createCompositionRuntime(): CompositionRuntime {
  return new CordisCompositionRuntime()
}

class CordisCompositionRuntime implements CompositionRuntime {
  private readonly root = new Context()
  private readonly trackedEffects = new Set<symbol>()
  private current: Candidate | undefined
  private pending: Candidate | undefined

  async activate(definition: CompositionDefinition, config: { readonly valid?: boolean } = {}): Promise<ActivationResult> {
    await this.disposeCandidate(this.pending)
    this.pending = undefined

    if (config.valid === false) {
      return { status: 'failed', reason: 'invalid_configuration' }
    }

    const candidate = await this.createCandidate(definition)
    const result = await this.settleCandidate(candidate)
    if (result.status === 'active') {
      const previous = this.current
      this.current = candidate
      await this.disposeCandidate(previous)
      return result
    }
    if (result.status === 'pending') {
      this.pending = candidate
      return result
    }

    await this.disposeCandidate(candidate)
    return result
  }

  async provideService(name: string, value: unknown): Promise<ActivationResult> {
    const candidate = this.pending
    if (!candidate) {
      return { status: 'failed', reason: 'missing_dependency' }
    }

    const provider = candidate.group.ctx.plugin({
      name: `service:${name}`,
      apply: (ctx: Context) => {
        ctx.provide(name, value)
      },
    })
    candidate.plugins.push(provider)

    const result = await this.settleCandidate(candidate)
    if (result.status === 'active') {
      this.pending = undefined
      const previous = this.current
      this.current = candidate
      await this.disposeCandidate(previous)
      return result
    }
    if (result.status === 'failed') {
      this.pending = undefined
      await this.disposeCandidate(candidate)
    }
    return result
  }

  async deactivate(): Promise<void> {
    await this.disposeCandidate(this.pending)
    await this.disposeCandidate(this.current)
    this.pending = undefined
    this.current = undefined
  }

  async dispose(): Promise<void> {
    await this.deactivate()
    await this.root.fiber.dispose()
  }

  currentId(): string | undefined {
    return this.current?.definition.id
  }

  activeEffectCount(): number {
    return this.trackedEffects.size
  }

  openAgentScope(id: string): AgentScope {
    const candidate = this.current
    if (!candidate) throw new Error('cannot open an Agent scope without an active composition')

    const context = candidate.group.ctx.isolate('agent', Symbol(id))
    const fiber = context.plugin({
      name: `agent:${id}`,
      apply: () => undefined,
    })
    candidate.scopes.add(fiber)
    const values = new Map<string, unknown>()
    const scopeEffects = new Set<symbol>()
    let disposed = false

    return {
      id,
      set<T>(key: string, value: T): void {
        if (disposed) throw new Error(`Agent scope "${id}" is disposed`)
        values.set(key, value)
      },
      get<T>(key: string): T | undefined {
        return values.get(key) as T | undefined
      },
      effect: (label: string): void => {
        if (disposed) throw new Error(`Agent scope "${id}" is disposed`)
        const token = Symbol(label)
        scopeEffects.add(token)
        this.trackEffect(fiber.ctx, label, () => scopeEffects.delete(token))
      },
      effectCount: (): number => scopeEffects.size,
      dispose: async (): Promise<void> => {
        if (disposed) return
        disposed = true
        candidate.scopes.delete(fiber)
        values.clear()
        await fiber.dispose()
        scopeEffects.clear()
      },
    }
  }

  private async createCandidate(definition: CompositionDefinition): Promise<Candidate> {
    const group = this.root.plugin({
      name: `composition:${definition.id}`,
      apply: () => undefined,
    })
    await group.await()
    return {
      definition,
      group,
      plugins: [],
      scopes: new Set(),
      missing: new Set(),
    }
  }

  private async settleCandidate(candidate: Candidate): Promise<ActivationResult> {
    candidate.missing.clear()
    const deferred = new Set(candidate.definition.deferredDependencies ?? [])

    if (candidate.plugins.length === 0) {
      for (const definition of candidate.definition.plugins) {
        const fiber = candidate.group.ctx.plugin({
          name: definition.id,
          inject: definition.requires ?? [],
          apply: (ctx: Context) => {
            const pluginContext: PluginContext = {
              compositionId: candidate.definition.id,
              effect: (label: string): void => this.trackEffect(ctx, label),
              getService: <T>(name: string): T | undefined => ctx.get(name, false) as T | undefined,
              requireService: <T>(name: string): T => {
                const value = ctx.get(name, false) as T | undefined
                if (value === undefined) throw new Error(`required service "${name}" is unavailable`)
                return value
              },
            }
            return definition.setup?.(pluginContext)
          },
        })
        candidate.plugins.push(fiber)
      }
    }

    await Promise.all(candidate.plugins.map((fiber) => fiber.await().catch(() => undefined)))
    for (const [index, definition] of candidate.definition.plugins.entries()) {
      const fiber = candidate.plugins[index]
      if (!fiber) continue
      if (fiber.state === PENDING) {
        for (const dependency of definition.requires ?? []) {
          if (fiber.ctx.get(dependency, false) === undefined) candidate.missing.add(dependency)
        }
      }
      if (fiber.state === FiberState.FAILED) {
        return { status: 'failed', reason: 'activation_failed' }
      }
    }

    const unresolved = [...candidate.missing]
    if (unresolved.length > 0) {
      const permanent = unresolved.filter((dependency) => !deferred.has(dependency))
      if (permanent.length > 0) return { status: 'failed', reason: 'missing_dependency' }
      return { status: 'pending', missing: unresolved }
    }
    return { status: 'active' }
  }

  private trackEffect(ctx: Context, label: string, onDispose?: () => void): void {
    const token = Symbol(label)
    this.trackedEffects.add(token)
    ctx.effect(() => async () => {
      onDispose?.()
      this.trackedEffects.delete(token)
    }, label)
  }

  private async disposeCandidate(candidate: Candidate | undefined): Promise<void> {
    if (!candidate) return
    await Promise.all([...candidate.scopes].map((scope) => scope.dispose()))
    await candidate.group.dispose()
  }
}
