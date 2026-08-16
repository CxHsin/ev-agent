import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HeadlessRunRuntime, type HeadlessRunInput, type HeadlessRunRuntimeOptions } from './index.js'
import type { CompositionDefinition, PluginContext } from '@ev-agent/plugin-sdk'

describe('durable headless Run', () => {
  const runtimes: HeadlessRunRuntime[] = []
  const directories: string[] = []

  afterEach(async () => {
    for (const runtime of runtimes.splice(0).reverse()) await runtime.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('completes a deterministic Run and replays the same summary', async () => {
    const runtime = open('worker-a', () => 100)
    const input = runInput('run-complete', [
      { text: 'hello ' },
      { text: 'world', effect: { idempotencyKey: 'effect-complete', type: 'write', result: { accepted: true } } },
    ])

    const result = await runtime.start(input)

    expect(result.status).toBe('completed')
    expect(result.summary).toEqual(expect.objectContaining({ status: 'completed', output: 'hello world', nextStep: 2 }))
    expect(runtime.replayRun('run-complete')).toEqual(result.summary)
    expect(runtime.listEvents('run-complete').map((event) => event.type)).toEqual([
      'run.started',
      'run.step.generated',
      'run.step.completed',
      'run.step.generated',
      'run.step.completed',
      'run.completed',
    ])
  })

  it('does not create executable state when configuration validation fails', async () => {
    const runtime = open('worker-a', () => 100)
    const input: HeadlessRunInput = {
      ...runInput('run-invalid', [{ text: 'never runs' }]),
      composition: {
        ...runInput('run-invalid', []).composition,
        validateConfig: (config) => {
          if (config !== 'approved') throw new Error('rejected')
        },
      },
      config: 'rejected',
    }

    const result = await runtime.start(input)

    expect(result).toEqual(expect.objectContaining({ status: 'failed', summary: expect.objectContaining({ error: 'invalid_configuration' }) }))
    expect(runtime.getRunJob('run-invalid')).toBeUndefined()
    expect(runtime.listEvents('run-invalid')).toHaveLength(0)
  })

  it('resumes after interruption after an effect without duplicating that effect', async () => {
    let now = 100
    const path = databasePath()
    let appliedEffects = 0
    const appliedResults = new Map<string, unknown>()
    const effectExecutor = ({ idempotencyKey, requestedResult }: { idempotencyKey: string; requestedResult: unknown }): unknown => {
      if (!appliedResults.has(idempotencyKey)) {
        appliedEffects += 1
        appliedResults.set(idempotencyKey, requestedResult)
      }
      return appliedResults.get(idempotencyKey)
    }
    const first = open('worker-a', () => now, path, {
      effectExecutor,
      interruptAfter: { runId: 'run-recover', step: 0, point: 'effect' },
    })
    const input = runInput('run-recover', [
      {
        text: 'once ',
        effect: { idempotencyKey: 'effect-recover', type: 'external-write', result: { count: 1 } },
      },
      { text: 'done' },
    ])

    const interrupted = await first.start(input)

    expect(interrupted.status).toBe('resumable')
    expect(interrupted.summary.nextStep).toBe(0)
    expect(appliedEffects).toBe(1)
    expect(first.getEffect('effect-recover')).toBeUndefined()
    expect(first.listEvents('run-recover').map((event) => event.type)).toEqual([
      'run.started',
      'run.step.generated',
    ])
    await first.close()
    runtimes.splice(runtimes.indexOf(first), 1)

    now = 111
    const second = open('worker-b', () => now, path, { effectExecutor })
    const resumed = await second.resume({ runId: input.runId, composition: input.composition })

    expect(resumed.status).toBe('completed')
    expect(resumed.summary).toEqual(expect.objectContaining({ output: 'once done', nextStep: 2, status: 'completed' }))
    expect(appliedEffects).toBe(1)
    expect(second.getEffect('effect-recover')).toEqual(expect.objectContaining({ created: false, result: { count: 1 } }))
    expect(second.listEvents('run-recover').filter((event) => event.type === 'run.step.completed')).toHaveLength(2)
    expect(second.replayRun('run-recover')).toEqual(resumed.summary)
  })

  it('records controlled model failure as terminal Run state', async () => {
    const runtime = open('worker-a', () => 100)

    const result = await runtime.start(runInput('run-failed', [
      { text: 'before ' },
      { text: '', failure: 'model unavailable' },
    ]))

    expect(result.status).toBe('failed')
    expect(result.summary).toEqual(expect.objectContaining({ status: 'failed', output: 'before ', error: 'model unavailable' }))
    expect(runtime.getRunJob('run-failed')).toEqual(expect.objectContaining({ status: 'failed', attempts: 1 }))
  })

  it('recovers from generated and completed-step checkpoints', async () => {
    let now = 100
    const generatedPath = databasePath()
    const generatedFirst = open('worker-a', () => now, generatedPath, {
      interruptAfter: { runId: 'run-generated', step: 0, point: 'generated' },
    })
    const generatedInput = runInput('run-generated', [{ text: 'one' }])
    expect((await generatedFirst.start(generatedInput)).status).toBe('resumable')
    await generatedFirst.close()
    runtimes.splice(runtimes.indexOf(generatedFirst), 1)
    now = 111
    const generatedSecond = open('worker-b', () => now, generatedPath)
    expect((await generatedSecond.resume({ runId: generatedInput.runId, composition: generatedInput.composition })).status).toBe('completed')

    const checkpointPath = databasePath()
    const checkpointFirst = open('worker-a', () => now, checkpointPath, {
      interruptAfter: { runId: 'run-checkpoint', step: 0, point: 'checkpoint' },
    })
    const checkpointInput = runInput('run-checkpoint', [{ text: 'one' }, { text: 'two' }])
    expect((await checkpointFirst.start(checkpointInput)).status).toBe('resumable')
    await checkpointFirst.close()
    runtimes.splice(runtimes.indexOf(checkpointFirst), 1)
    const checkpointSecond = open('worker-b', () => now + 20, checkpointPath)
    expect((await checkpointSecond.resume({ runId: checkpointInput.runId, composition: checkpointInput.composition })).status).toBe('completed')
  })

  it('discovers recoverable Runs and preserves their persisted definition', async () => {
    let now = 100
    const path = databasePath()
    const first = open('worker-a', () => now, path, {
      interruptAfter: { runId: 'run-discover', step: 0, point: 'generated' },
    })
    const input = runInput('run-discover', [{ text: 'persisted' }])
    await first.start(input)
    await first.close()
    runtimes.splice(runtimes.indexOf(first), 1)

    now = 111
    const second = open('worker-b', () => now, path)
    expect(second.listRecoverableRuns()).toEqual([expect.objectContaining({ runId: 'run-discover' })])
    const resumed = await second.resume({ runId: input.runId, composition: input.composition })

    expect(resumed.summary.output).toBe('persisted')
    expect(resumed.status).toBe('completed')
  })

  it('checkpoints a resumable budget exhaustion outcome', async () => {
    const runtime = open('worker-a', () => 100)

    const result = await runtime.start({
      ...runInput('run-budget', [{ text: 'one' }, { text: 'two' }]),
      budget: { maxSteps: 1, maxEffects: 1 },
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'resumable',
      summary: expect.objectContaining({ status: 'budget_exhausted', nextStep: 1 }),
    }))
    expect(runtime.listEvents('run-budget').at(-1)).toEqual(expect.objectContaining({ type: 'run.budget_exhausted' }))
  })

  it('persists a pending composition as recoverable work', async () => {
    const runtime = open('worker-a', () => 100)
    const input = runInput('run-pending', [{ text: 'waits' }])
    const pendingComposition: CompositionDefinition = {
      ...input.composition,
      plugins: input.composition.plugins.map((plugin) => ({ ...plugin, requires: ['clock'] })),
      deferredDependencies: ['clock'],
    }
    const pending = await runtime.start({
      ...input,
      composition: pendingComposition,
    })

    expect(pending.status).toBe('resumable')
    expect(runtime.getRunJob('run-pending')).toEqual(expect.objectContaining({ status: 'pending' }))
    expect(runtime.listRecoverableRuns()).toEqual([expect.objectContaining({ runId: 'run-pending' })])
  })

  it('resumes budget exhaustion with an explicitly increased budget', async () => {
    let now = 100
    const path = databasePath()
    const first = open('worker-a', () => now, path)
    const input = { ...runInput('run-budget-resume', [{ text: 'one' }, { text: 'two' }]), budget: { maxSteps: 1, maxEffects: 1 } }

    expect((await first.start(input)).summary.status).toBe('budget_exhausted')
    await first.close()
    runtimes.splice(runtimes.indexOf(first), 1)

    now = 111
    const second = open('worker-b', () => now, path)
    const resumed = await second.resume({
      runId: input.runId,
      composition: input.composition,
      budget: { maxSteps: 2, maxEffects: 1 },
    })

    expect(resumed.status).toBe('completed')
    expect(resumed.summary.output).toBe('onetwo')
  })

  it('rejects a changed Composition definition with the same identity', async () => {
    let now = 100
    const path = databasePath()
    const first = open('worker-a', () => now, path, {
      interruptAfter: { runId: 'run-definition', step: 0, point: 'generated' },
    })
    const input = runInput('run-definition', [{ text: 'stable' }])
    await first.start(input)
    await first.close()
    runtimes.splice(runtimes.indexOf(first), 1)

    now = 111
    const second = open('worker-b', () => now, path)
    const changed: CompositionDefinition = {
      ...input.composition,
      plugins: [{ id: 'changed-plugin', setup: (context: PluginContext) => context.effect('changed') }],
    }

    expect(await second.resume({ runId: input.runId, composition: changed })).toEqual(expect.objectContaining({
      status: 'failed',
      summary: expect.objectContaining({ error: 'run_definition_mismatch' }),
    }))
  })

  it('rejects non-finite or negative execution budgets before creating a job', async () => {
    const runtime = open('worker-a', () => 100)

    const result = await runtime.start({
      ...runInput('run-invalid-budget', [{ text: 'never' }]),
      budget: { maxSteps: Number.POSITIVE_INFINITY, maxEffects: -1 },
    })

    expect(result.summary.error).toBe('invalid_execution_budget')
    expect(runtime.getRunJob('run-invalid-budget')).toBeUndefined()
  })

  it('keeps payload loss explicit during replay', async () => {
    const runtime = open('worker-a', () => 100)
    const input = runInput('run-payload-gap', [{ text: 'result' }])
    await runtime.start(input)

    runtime.eraseEventPayload('run-payload-gap:completed')

    expect(runtime.replayRun('run-payload-gap')).toEqual(expect.objectContaining({
      status: 'completed',
      payloadGaps: ['run-payload-gap:completed'],
    }))
  })

  function open(
    workerId: string,
    clock: () => number,
    path = databasePath(),
    options: Pick<HeadlessRunRuntimeOptions, 'effectExecutor' | 'interruptAfter'> = {},
  ): HeadlessRunRuntime {
    const runtime = new HeadlessRunRuntime({ databasePath: path, workerId, now: clock, leaseMs: 10, ...options })
    runtimes.push(runtime)
    return runtime
  }

  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'ev-agent-run-'))
    directories.push(directory)
    return join(directory, 'runtime.sqlite')
  }

  function runInput(runId: string, model: HeadlessRunInput['model']): HeadlessRunInput {
    return {
      runId,
      composition: composition(runId),
      model,
    }
  }
})

function composition(id: string): CompositionDefinition {
  return {
    id: `composition-${id}`,
    version: '1',
    plugins: [{ id: `plugin-${id}`, setup: (context) => context.effect(`runtime:${id}`) }],
  }
}
