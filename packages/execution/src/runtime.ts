import {
  createCompositionRuntime,
  type CompositionDefinition,
  type CompositionRuntime,
} from '@ev-agent/composition'
import {
  DurabilityStore,
  type AgentEvent,
  type PersistentJob,
} from '@ev-agent/durability'
import type { AgentScope } from '@ev-agent/plugin-sdk'
import { ScriptedFakeModel, type FakeModelStep } from './model.js'

export interface HeadlessRunInput {
  readonly runId: string
  readonly composition: CompositionDefinition
  readonly config?: unknown
  readonly model: readonly FakeModelStep[]
  readonly budget?: ExecutionBudget
}

export interface HeadlessRunResumeInput {
  readonly runId: string
  readonly composition: CompositionDefinition
  readonly budget?: ExecutionBudget
}

export interface ExecutionBudget {
  readonly maxSteps: number
  readonly maxEffects: number
}

export type RunResultStatus = 'resumable' | 'completed' | 'failed'

export interface RunStateSummary {
  readonly status: 'running' | 'budget_exhausted' | 'completed' | 'failed'
  readonly nextStep: number
  readonly output: string
  readonly completedSteps: readonly number[]
  readonly effectKeys: readonly string[]
  readonly payloadGaps: readonly string[]
  readonly error: string | undefined
}

export interface RunResult {
  readonly runId: string
  readonly status: RunResultStatus
  readonly summary: RunStateSummary
}

export interface HeadlessRunRuntimeOptions {
  readonly databasePath: string
  readonly workerId: string
  readonly now?: () => number
  readonly leaseMs?: number
  readonly effectExecutor?: (effect: ExternalEffectRequest) => unknown
  readonly interruptAfter?: {
    readonly runId: string
    readonly step: number
    readonly point: 'generated' | 'effect' | 'checkpoint' | 'before-terminal'
  }
}

export interface ExternalEffectRequest {
  readonly idempotencyKey: string
  readonly type: string
  readonly requestedResult: unknown
}

interface PersistedRunInput {
  readonly compositionId: string
  readonly compositionVersion: string
  readonly compositionFingerprint: string
  readonly config?: unknown
  readonly model: readonly FakeModelStep[]
  readonly budget: ExecutionBudget
}

const DEFAULT_BUDGET: ExecutionBudget = { maxSteps: 1000, maxEffects: 100 }

export class HeadlessRunRuntime {
  private readonly store: DurabilityStore
  private readonly composition: CompositionRuntime
  private readonly workerId: string
  private readonly now: () => number
  private readonly leaseMs: number
  private readonly effectExecutor: (effect: ExternalEffectRequest) => unknown
  private readonly interruptAfter: HeadlessRunRuntimeOptions['interruptAfter']

  constructor(options: HeadlessRunRuntimeOptions) {
    this.store = new DurabilityStore(options.databasePath)
    this.composition = createCompositionRuntime()
    this.workerId = options.workerId
    this.now = options.now ?? (() => Date.now())
    this.leaseMs = options.leaseMs ?? 30_000
    this.effectExecutor = options.effectExecutor ?? ((effect) => effect.requestedResult)
    this.interruptAfter = options.interruptAfter
  }

  async start(input: HeadlessRunInput): Promise<RunResult> {
    return this.executeStart(input)
  }

  async resume(input: HeadlessRunResumeInput): Promise<RunResult> {
    const job = this.store.getJobForRun(input.runId)
    if (!job) return this.failedResult(input.runId, 'run_not_found')
    const persisted = decodePersistedRunInput(job.input)
    if (!persisted) return this.failedResult(input.runId, 'run_definition_missing')
    if (persisted.compositionId !== input.composition.id
      || persisted.compositionVersion !== input.composition.version
      || persisted.compositionFingerprint !== compositionFingerprint(input.composition)) {
      return this.failedResult(input.runId, 'run_definition_mismatch')
    }
    try {
      const budget = input.budget === undefined ? persisted.budget : normalizeBudget(input.budget)
      return this.execute(input.runId, input.composition, { ...persisted, budget }, job)
    } catch {
      return this.failedResult(input.runId, 'invalid_execution_budget')
    }
  }

  listEvents(runId: string): readonly AgentEvent[] {
    return this.store.listEvents(runId)
  }

  replayRun(runId: string): RunStateSummary {
    return this.store.replay(runId, emptySummary(), reduceRunEvent)
  }

  getRunJob(runId: string): PersistentJob | undefined {
    return this.store.getJobForRun(runId)
  }

  listRecoverableRuns(): readonly PersistentJob[] {
    return this.store.listRecoverableJobs(this.now())
  }

  getEffect(idempotencyKey: string) {
    return this.store.getEffect(idempotencyKey)
  }

  async openAgentScope(id: string): Promise<AgentScope> {
    return this.composition.openAgentScope(id)
  }

  eraseEventPayload(eventId: string): void {
    this.store.eraseEventPayload(eventId)
  }

  async close(): Promise<void> {
    await this.composition.dispose()
    this.store.close()
  }

  private async executeStart(input: HeadlessRunInput): Promise<RunResult> {
    let persisted: PersistedRunInput
    try {
      persisted = toPersistedRunInput(input)
    } catch {
      return this.failedResult(input.runId, 'invalid_execution_budget')
    }
    const existingJob = this.store.getJobForRun(input.runId)
    if (existingJob) {
      const stored = decodePersistedRunInput(existingJob.input)
      if (!stored || canonicalJson(stored) !== canonicalJson(persisted)) {
        return this.failedResult(input.runId, 'run_definition_mismatch')
      }
      return this.execute(input.runId, input.composition, stored, existingJob)
    }
    return this.execute(input.runId, input.composition, persisted)
  }

  private async execute(
    runId: string,
    composition: CompositionDefinition,
    persisted: PersistedRunInput,
    existingJob?: PersistentJob,
  ): Promise<RunResult> {
    const activation = await this.composition.activate(composition, persisted.config)
    if (activation.status === 'failed') {
      return {
        runId,
        status: 'failed',
        summary: {
          ...emptySummary(),
          status: 'failed',
          error: activation.reason,
        },
      }
    }

    const job = existingJob ?? this.store.createJob({
      jobId: `job:${runId}`,
      runId,
      kind: 'headless-run',
      idempotencyKey: `run:${runId}`,
      input: persisted,
    })
    const current = this.replayRun(runId)
    if (job.status === 'completed') return this.result(runId, 'completed', current)
    if (job.status === 'failed') return this.result(runId, 'failed', current)

    if (activation.status === 'pending') {
      return {
        runId,
        status: 'resumable',
        summary: { ...current, status: 'running', error: `missing:${activation.missing.join(',')}` },
      }
    }

    if (current.status === 'completed') {
      return this.result(runId, 'completed', current)
    }
    if (current.status === 'failed') {
      return this.result(runId, 'failed', current)
    }
    if (this.listEvents(runId).length === 0) {
      this.store.appendEvent({
        eventId: `${runId}:started`,
        runId,
        type: 'run.started',
        occurredAt: this.now(),
      })
    }

    const claimed = this.store.claimJobForRun(runId, this.workerId, this.now(), this.leaseMs)
    if (!claimed) return this.result(runId, 'resumable', { ...this.replayRun(runId), status: 'running' })
    if (claimed.status !== 'running') return this.resultForJob(runId, claimed, this.replayRun(runId))

    if (canonicalJson(decodePersistedRunInput(claimed.input)) !== canonicalJson(persisted)) {
      this.store.updateJobInput(claimed.jobId, this.workerId, persisted)
    }

    return this.runSteps(runId, claimed.jobId, new ScriptedFakeModel(persisted.model), persisted.budget)
  }

  private async runSteps(
    runId: string,
    jobId: string,
    model: ScriptedFakeModel,
    budget: ExecutionBudget,
  ): Promise<RunResult> {
    let summary = this.replayRun(runId)
    while (true) {
      this.store.renewJobLease(jobId, this.workerId, this.now() + this.leaseMs)
      const step = model.step(summary.nextStep)
      if (!step) {
        const completedEvent = {
          eventId: `${runId}:completed`,
          runId,
          type: 'run.completed',
          occurredAt: this.now(),
          payload: { output: summary.output },
        }
        if (this.shouldInterrupt(runId, summary.nextStep, 'before-terminal')) {
          return this.result(runId, 'resumable', { ...summary, status: 'running' })
        }
        const job = this.store.completeJobWithEvent(jobId, this.workerId, completedEvent, { output: summary.output })
        return this.resultForJob(runId, job, this.replayRun(runId))
      }

      const stepIndex = summary.nextStep
      if (summary.completedSteps.length >= budget.maxSteps) {
        return this.budgetExhausted(runId, summary, 'max_steps')
      }
      this.store.appendEvent({
        eventId: `${runId}:step:${stepIndex}:generated`,
        runId,
        type: 'run.step.generated',
        occurredAt: this.now(),
        payload: { step: stepIndex, text: step.text },
      })

      if (this.shouldInterrupt(runId, stepIndex, 'generated')) {
        return this.result(runId, 'resumable', { ...this.replayRun(runId), status: 'running' })
      }

      if (step.failure !== undefined) {
        const failedEvent = {
          eventId: `${runId}:failed`,
          runId,
          type: 'run.failed',
          occurredAt: this.now(),
          payload: { error: step.failure, step: stepIndex },
        }
        if (this.shouldInterrupt(runId, stepIndex, 'before-terminal')) {
          return this.result(runId, 'resumable', { ...this.replayRun(runId), status: 'running' })
        }
        const job = this.store.failJobWithEvent(jobId, this.workerId, failedEvent, step.failure)
        return this.resultForJob(runId, job, this.replayRun(runId))
      }

      let effectReplayed = false
      let effectKey: string | undefined
      if (step.effect) {
        const existingReceipt = this.store.getEffect(step.effect.idempotencyKey)
        if (!existingReceipt && summary.effectKeys.length >= budget.maxEffects) {
          return this.budgetExhausted(runId, summary, 'max_effects')
        }
        let receipt = existingReceipt
        if (!receipt) {
          const result = this.effectExecutor({
            idempotencyKey: step.effect.idempotencyKey,
            type: step.effect.type,
            requestedResult: step.effect.result,
          })
          if (this.shouldInterrupt(runId, stepIndex, 'effect')) {
            return this.result(runId, 'resumable', { ...this.replayRun(runId), status: 'running' })
          }
          receipt = this.store.recordEffect({
            idempotencyKey: step.effect.idempotencyKey,
            runId,
            effectType: step.effect.type,
            result,
          })
        }
        effectReplayed = existingReceipt !== undefined
        effectKey = receipt.idempotencyKey
      }

      this.store.appendEvent({
        eventId: `${runId}:step:${stepIndex}:completed`,
        runId,
        type: 'run.step.completed',
        occurredAt: this.now(),
        payload: {
          step: stepIndex,
          text: step.text,
          effectKey,
          effectReplayed,
        },
      })
      if (this.shouldInterrupt(runId, stepIndex, 'checkpoint')) {
        return this.result(runId, 'resumable', { ...this.replayRun(runId), status: 'running' })
      }
      summary = this.replayRun(runId)
    }
  }

  private shouldInterrupt(runId: string, step: number, point: NonNullable<HeadlessRunRuntimeOptions['interruptAfter']>['point']): boolean {
    return this.interruptAfter?.runId === runId
      && this.interruptAfter.step === step
      && this.interruptAfter.point === point
  }

  private budgetExhausted(runId: string, summary: RunStateSummary, reason: string): RunResult {
    this.store.appendEvent({
      eventId: `${runId}:budget:${reason}:${summary.nextStep}`,
      runId,
      type: 'run.budget_exhausted',
      occurredAt: this.now(),
      payload: { reason, nextStep: summary.nextStep },
    })
    return this.result(runId, 'resumable', { ...this.replayRun(runId), status: 'budget_exhausted' })
  }

  private failedResult(runId: string, error: string): RunResult {
    return {
      runId,
      status: 'failed',
      summary: { ...emptySummary(), status: 'failed', error },
    }
  }

  private result(runId: string, status: RunResultStatus, summary: RunStateSummary): RunResult {
    return { runId, status, summary }
  }

  private resultForJob(runId: string, job: PersistentJob, summary: RunStateSummary): RunResult {
    if (job.status === 'completed') return this.result(runId, 'completed', summary)
    if (job.status === 'failed') return this.result(runId, 'failed', summary)
    return this.result(runId, 'resumable', { ...summary, status: 'running' })
  }
}

function emptySummary(): RunStateSummary {
  return {
    status: 'running',
    nextStep: 0,
    output: '',
    completedSteps: [],
    effectKeys: [],
    payloadGaps: [],
    error: undefined,
  }
}

function reduceRunEvent(summary: RunStateSummary, event: AgentEvent): RunStateSummary {
  if (event.payloadStatus !== 'present' && requiresPayload(event.type)) {
    const payloadGaps = [...summary.payloadGaps, event.eventId]
    if (event.type === 'run.completed') return { ...summary, status: 'completed', payloadGaps }
    if (event.type === 'run.failed') return { ...summary, status: 'failed', error: 'payload_unavailable', payloadGaps }
    if (event.type === 'run.budget_exhausted') return { ...summary, status: 'budget_exhausted', error: 'payload_unavailable', payloadGaps }
    return { ...summary, payloadGaps }
  }
  if (event.type === 'run.step.completed') {
    const payload = event.payload as { step: number; text: string; effectKey?: string }
    const completedSteps = [...summary.completedSteps, payload.step].sort((left, right) => left - right)
    const effectKeys = payload.effectKey === undefined
      ? summary.effectKeys
      : [...summary.effectKeys, payload.effectKey]
    return {
      ...summary,
      status: 'running',
      nextStep: firstMissing(completedSteps),
      output: summary.output + payload.text,
      completedSteps,
      effectKeys,
    }
  }
  if (event.type === 'run.budget_exhausted') {
    const payload = event.payload as { reason: string }
    return { ...summary, status: 'budget_exhausted', error: `budget_exhausted:${payload.reason}` }
  }
  if (event.type === 'run.completed') {
    return { ...summary, status: 'completed' }
  }
  if (event.type === 'run.failed') {
    const payload = event.payload as { error: string }
    return { ...summary, status: 'failed', error: payload.error }
  }
  return summary
}

function requiresPayload(type: string): boolean {
  return type === 'run.step.completed'
    || type === 'run.completed'
    || type === 'run.failed'
    || type === 'run.budget_exhausted'
}

function firstMissing(values: readonly number[]): number {
  const seen = new Set(values)
  let index = 0
  while (seen.has(index)) index += 1
  return index
}

function toPersistedRunInput(input: HeadlessRunInput): PersistedRunInput {
  const budget = normalizeBudget(input.budget)
  return {
    compositionId: input.composition.id,
    compositionVersion: input.composition.version,
    compositionFingerprint: compositionFingerprint(input.composition),
    ...(input.config === undefined ? {} : { config: input.config }),
    model: input.model,
    budget,
  }
}

function decodePersistedRunInput(value: unknown): PersistedRunInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<PersistedRunInput>
  if (typeof candidate.compositionId !== 'string'
    || typeof candidate.compositionVersion !== 'string'
    || typeof candidate.compositionFingerprint !== 'string'
    || !Array.isArray(candidate.model)
    || typeof candidate.budget !== 'object'
    || candidate.budget === null
    || typeof candidate.budget.maxSteps !== 'number'
    || typeof candidate.budget.maxEffects !== 'number') return undefined
  let budget: ExecutionBudget
  try {
    budget = normalizeBudget(candidate.budget)
  } catch {
    return undefined
  }
  return {
    compositionId: candidate.compositionId,
    compositionVersion: candidate.compositionVersion,
    compositionFingerprint: candidate.compositionFingerprint,
    ...(candidate.config === undefined ? {} : { config: candidate.config }),
    model: candidate.model as readonly FakeModelStep[],
    budget,
  }
}

function normalizeBudget(budget: ExecutionBudget | undefined): ExecutionBudget {
  const value = budget ?? DEFAULT_BUDGET
  if (!Number.isSafeInteger(value.maxSteps) || value.maxSteps < 0
    || !Number.isSafeInteger(value.maxEffects) || value.maxEffects < 0) {
    throw new Error('ExecutionBudget values must be finite non-negative integers')
  }
  return { maxSteps: value.maxSteps, maxEffects: value.maxEffects }
}

function compositionFingerprint(definition: CompositionDefinition): string {
  return canonicalJson({
    id: definition.id,
    version: definition.version,
    deferredDependencies: definition.deferredDependencies ?? [],
    validateConfig: definition.validateConfig?.toString(),
    plugins: definition.plugins.map((plugin) => ({
      id: plugin.id,
      requires: plugin.requires ?? [],
      setup: plugin.setup?.toString(),
    })),
  })
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested
    return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
  })
}
