import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DurabilityStore, type AgentEvent } from './index.js'

describe('SQLite Durability', () => {
  const stores: DurabilityStore[] = []
  const directories: string[] = []

  afterEach(() => {
    for (const store of stores.splice(0)) store.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('persists ordered Agent Events across a fresh store instance', () => {
    const path = databasePath()
    const first = open(path)
    first.appendEvent({ eventId: 'event-1', runId: 'run-1', type: 'started', occurredAt: 10, payload: { step: 0 } })
    first.appendEvent({ eventId: 'event-2', runId: 'run-1', type: 'completed', occurredAt: 11, payload: { result: 'ok' } })
    first.close()

    const second = open(path)
    expect(second.listEvents('run-1')).toEqual([
      expect.objectContaining({ eventId: 'event-1', sequence: 1, payloadStatus: 'present' }),
      expect.objectContaining({ eventId: 'event-2', sequence: 2, payloadStatus: 'present' }),
    ])
  })

  it('separates payload lifecycle from the durable event envelope', () => {
    const store = open(databasePath())
    store.appendEvent({ eventId: 'event-1', runId: 'run-1', type: 'claim', occurredAt: 10, payload: { secret: 'remove-me' } })

    store.eraseEventPayload('event-1')

    expect(store.listEvents('run-1')[0]).toEqual(expect.objectContaining({
      eventId: 'event-1',
      payloadStatus: 'erased',
      payload: undefined,
    }))
  })

  it('rejects a conflicting reuse of an event identity', () => {
    const store = open(databasePath())
    store.appendEvent({ eventId: 'event-1', runId: 'run-1', type: 'claim', occurredAt: 10, payload: { value: 1 } })

    expect(() => store.appendEvent({ eventId: 'event-1', runId: 'run-1', type: 'claim', occurredAt: 11, payload: { value: 2 } })).toThrow(/conflicts/)
    expect(store.listEvents('run-1')).toHaveLength(1)
  })

  it('replays the same summary from the ordered event history', () => {
    const store = open(databasePath())
    store.appendEvent({ eventId: 'event-1', runId: 'run-1', type: 'started', occurredAt: 10, payload: { value: 2 } })
    store.appendEvent({ eventId: 'event-2', runId: 'run-1', type: 'added', occurredAt: 11, payload: { value: 3 } })

    const reducer = (total: number, event: AgentEvent): number => total + (event.payload as { value: number }).value
    expect(store.replay('run-1', 0, reducer)).toBe(5)
  })

  it('commits an effect receipt only once for an idempotency key', () => {
    const store = open(databasePath())

    const first = store.recordEffect({ idempotencyKey: 'effect-1', runId: 'run-1', effectType: 'send', result: { sent: true } })
    const retry = store.recordEffect({ idempotencyKey: 'effect-1', runId: 'run-1', effectType: 'send', result: { sent: false } })

    expect(first.created).toBe(true)
    expect(retry.created).toBe(false)
    expect(retry.result).toEqual({ sent: true })
  })

  it('keeps a started effect intent from being claimed by a retry', () => {
    const store = open(databasePath())
    const first = store.claimEffect({ idempotencyKey: 'effect-intent-1', runId: 'run-1', effectType: 'send' })
    const retry = store.claimEffect({ idempotencyKey: 'effect-intent-1', runId: 'run-1', effectType: 'send' })

    expect(first).toMatchObject({ status: 'started', created: true })
    expect(retry).toMatchObject({ status: 'started', created: false })
  })

  it('persists pending approvals and changes each decision only once', () => {
    const path = databasePath()
    const first = open(path)
    expect(first.createApproval({
      approvalId: 'approval-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: 'send_message',
      effectClass: 'external',
      idempotencyKey: 'run-1:send_message:call-1',
      input: { recipient: 'user-1' },
      requiredPermission: 'message.send',
      createdAt: 100,
    })).toEqual(expect.objectContaining({ status: 'pending' }))
    first.close()

    const second = open(path)
    expect(second.listPendingApprovals('run-1')).toHaveLength(1)
    expect(second.decideApproval('approval-1', 'approved', 'confirmed', 101)).toEqual({
      changed: true,
      approval: expect.objectContaining({ status: 'approved', decisionReason: 'confirmed', decidedAt: 101 }),
    })
    expect(second.decideApproval('approval-1', 'denied', 'late denial', 102)).toEqual({
      changed: false,
      approval: expect.objectContaining({ status: 'approved', decisionReason: 'confirmed', decidedAt: 101 }),
    })
  })

  it('claims, completes, and recovers persistent jobs after a lease expires', () => {
    const path = databasePath()
    const first = open(path)
    const created = first.createJob({ jobId: 'job-1', runId: 'run-1', kind: 'run', idempotencyKey: 'run-1', input: { goal: 'test' } })
    expect(created.status).toBe('pending')
    expect(first.claimJobForRun('run-1', 'worker-a', 100, 50)).toEqual(expect.objectContaining({ status: 'running', attempts: 1 }))
    first.close()

    const second = open(path)
    const recovered = second.claimJobForRun('run-1', 'worker-b', 151, 50)
    expect(recovered).toEqual(expect.objectContaining({ jobId: 'job-1', status: 'running', attempts: 2, leaseOwner: 'worker-b' }))
    expect(second.completeJob('job-1', 'worker-b', { done: true })).toEqual(expect.objectContaining({ status: 'completed', result: { done: true } }))
    expect(second.createJob({ jobId: 'job-retry', runId: 'run-1', kind: 'run', idempotencyKey: 'run-1', input: { goal: 'different' } })).toEqual(
      expect.objectContaining({ jobId: 'job-1', input: { goal: 'test' } }),
    )
  })

  it('claims only the requested Run and atomically writes terminal event plus job state', () => {
    const store = open(databasePath())
    store.createJob({ jobId: 'job-a', runId: 'run-a', kind: 'run', idempotencyKey: 'run-a' })
    store.createJob({ jobId: 'job-b', runId: 'run-b', kind: 'run', idempotencyKey: 'run-b' })

    expect(store.claimJobForRun('run-b', 'worker-b', 100, 50)).toEqual(expect.objectContaining({ jobId: 'job-b' }))
    expect(store.completeJobWithEvent('job-b', 'worker-b', {
      eventId: 'run-b:completed',
      runId: 'run-b',
      type: 'run.completed',
      occurredAt: 101,
      payload: { ok: true },
    }, { ok: true })).toEqual(expect.objectContaining({ status: 'completed' }))
    expect(store.listEvents('run-b')).toEqual([expect.objectContaining({ type: 'run.completed', payload: { ok: true } })])
  })

  it('renews a lease so another worker cannot reclaim active work', () => {
    const store = open(databasePath())
    store.createJob({ jobId: 'job-1', runId: 'run-1', kind: 'run', idempotencyKey: 'run-1' })
    expect(store.claimJobForRun('run-1', 'worker-a', 100, 10)).toBeDefined()
    expect(store.renewJobLease('job-1', 'worker-a', 200)).toEqual(expect.objectContaining({ leaseUntil: 200 }))

    expect(store.claimJobForRun('run-1', 'worker-b', 150, 10)).toBeUndefined()
    expect(store.claimJobForRun('run-1', 'worker-b', 201, 10)).toEqual(expect.objectContaining({ leaseOwner: 'worker-b' }))
  })

  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'ev-agent-durable-'))
    directories.push(directory)
    return join(directory, 'runtime.sqlite')
  }

  function open(path: string): DurabilityStore {
    const store = new DurabilityStore(path)
    stores.push(store)
    return store
  }
})
