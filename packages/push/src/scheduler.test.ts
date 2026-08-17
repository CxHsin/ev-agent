import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PushScheduleRunner, PushSubscriptionService } from './index.js'

describe('Push Schedule Runner', () => {
  const directories: string[] = []
  const closers: Array<() => void> = []

  afterEach(() => {
    for (const close of closers.splice(0)) close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('persists a daily occurrence, recovers it after restart, and allows only one active claim', () => {
    const databasePath = databasePathFor(directories)
    const subscriptionService = new PushSubscriptionService({ databasePath, now: () => utc('2026-08-16T11:00:00Z') })
    closers.push(() => subscriptionService.close())
    const candidate = subscriptionService.propose({
      candidateId: 'candidate-schedule',
      userScopeId: 'user-1',
      requestText: 'Watch https://feeds.example.test/ai daily at 20:00.',
    })
    const subscription = subscriptionService.confirm({
      candidateId: candidate.candidateId,
      subscriptionId: 'subscription-schedule',
      revision: candidate.revision,
      scopeFingerprint: candidate.scopeFingerprint,
    })
    const first = new PushScheduleRunner({ databasePath, workerId: 'worker-a', now: () => utc('2026-08-16T12:00:00Z') })
    closers.push(() => first.close())

    expect(first.getSchedule(subscription.subscriptionId)).toEqual(expect.objectContaining({
      scheduleId: subscription.subscriptionId,
      schedule: 'daily@20:00',
      status: 'active',
    }))
    expect(first.reconcile(subscription.subscriptionId)).toHaveLength(0)

    const due = first.reconcile(subscription.subscriptionId, utc('2026-08-16T12:00:00Z') + 8 * 60 * 60 * 1000)
    expect(due).toHaveLength(1)
    expect(due[0]).toEqual(expect.objectContaining({
      occurrenceId: 'subscription-schedule:2026-08-16',
      intendedLocalDate: '2026-08-16',
      intendedAt: utc('2026-08-16T12:00:00Z') + 8 * 60 * 60 * 1000,
      status: 'pending',
    }))

    const claimed = first.claimDue(subscription.subscriptionId, utc('2026-08-16T20:00:00Z'))
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toEqual(expect.objectContaining({ status: 'running', claimOwner: 'worker-a' }))

    const recovered = new PushScheduleRunner({ databasePath, workerId: 'worker-b', now: () => utc('2026-08-16T20:01:00Z') })
    closers.push(() => recovered.close())
    expect(recovered.claimDue(subscription.subscriptionId)).toHaveLength(0)
    expect(first.claimDue(subscription.subscriptionId, utc('2026-08-16T20:01:00Z'))).toHaveLength(0)
    expect(recovered.listOccurrences(subscription.subscriptionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ occurrenceId: 'subscription-schedule:2026-08-16', status: 'running' }),
    ]))
  })

  it('reconciles missed daily occurrences according to the all and skip policies', () => {
    const databasePath = databasePathFor(directories)
    const service = new PushSubscriptionService({ databasePath, now: () => utc('2026-08-16T19:00:00Z') })
    closers.push(() => service.close())
    const candidate = service.propose({ candidateId: 'candidate-catch-up', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00 all.' })
    const subscription = service.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-catch-up', revision: 1, scopeFingerprint: candidate.scopeFingerprint })
    const runner = new PushScheduleRunner({ databasePath, workerId: 'worker-a', now: () => utc('2026-08-18T21:00:00Z') })
    closers.push(() => runner.close())

    const latest = runner.reconcile(subscription.subscriptionId, utc('2026-08-18T21:00:00Z'))
    expect(latest.map((occurrence) => [occurrence.intendedLocalDate, occurrence.status])).toEqual([
      ['2026-08-16', 'pending'],
      ['2026-08-17', 'pending'],
      ['2026-08-18', 'pending'],
    ])

    const skipDatabasePath = databasePathFor(directories)
    const skipService = new PushSubscriptionService({ databasePath: skipDatabasePath, now: () => utc('2026-08-16T19:00:00Z') })
    closers.push(() => skipService.close())
    const skipCandidate = skipService.propose({ candidateId: 'candidate-skip', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00 skip.' })
    const skipSubscription = skipService.confirm({ candidateId: skipCandidate.candidateId, subscriptionId: 'subscription-skip', revision: 1, scopeFingerprint: skipCandidate.scopeFingerprint })
    const skipRunner = new PushScheduleRunner({ databasePath: skipDatabasePath, workerId: 'worker-a', now: () => utc('2026-08-18T21:00:00Z') })
    closers.push(() => skipRunner.close())

    expect(skipRunner.reconcile(skipSubscription.subscriptionId, utc('2026-08-18T21:00:00Z')).every((occurrence) => occurrence.status === 'skipped')).toBe(true)
  })

  it('keeps only the latest missed occurrence and observes a 20:00 local schedule across DST', () => {
    const databasePath = databasePathFor(directories)
    const service = new PushSubscriptionService({ databasePath, defaultTimezone: 'America/New_York', now: () => utc('2026-03-07T23:00:00Z') })
    closers.push(() => service.close())
    const candidate = service.propose({ candidateId: 'candidate-dst', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00.' })
    const subscription = service.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-dst', revision: 1, scopeFingerprint: candidate.scopeFingerprint })
    const runner = new PushScheduleRunner({ databasePath, workerId: 'worker-a', now: () => utc('2026-03-09T01:00:00Z') })
    closers.push(() => runner.close())

    expect(runner.reconcile(subscription.subscriptionId)).toEqual([
      expect.objectContaining({ intendedLocalDate: '2026-03-07', intendedAt: utc('2026-03-08T01:00:00Z'), status: 'skipped', reason: 'catch_up_superseded' }),
      expect.objectContaining({ intendedLocalDate: '2026-03-08', intendedAt: utc('2026-03-09T00:00:00Z'), status: 'pending' }),
    ])
  })

  it('continues all-policy recovery in bounded batches without losing intended occurrences', () => {
    const databasePath = databasePathFor(directories)
    const service = new PushSubscriptionService({ databasePath, now: () => utc('2026-08-01T19:00:00Z') })
    closers.push(() => service.close())
    const candidate = service.propose({ candidateId: 'candidate-batch', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00 all.' })
    const subscription = service.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-batch', revision: 1, scopeFingerprint: candidate.scopeFingerprint })
    const runner = new PushScheduleRunner({ databasePath, workerId: 'worker-a', budget: { maxOccurrences: 2 }, now: () => utc('2026-08-05T21:00:00Z') })
    closers.push(() => runner.close())

    expect(runner.reconcile(subscription.subscriptionId).map((occurrence) => occurrence.intendedLocalDate)).toEqual(['2026-08-01', '2026-08-02'])
    expect(runner.reconcile(subscription.subscriptionId).map((occurrence) => occurrence.intendedLocalDate)).toEqual(['2026-08-03', '2026-08-04'])
    expect(runner.reconcile(subscription.subscriptionId).map((occurrence) => occurrence.intendedLocalDate)).toEqual(['2026-08-05'])
  })

  it('does not create occurrences after pause, revoke, or subscription expiry', () => {
    const databasePath = databasePathFor(directories)
    const service = new PushSubscriptionService({ databasePath, now: () => utc('2026-08-16T19:00:00Z') })
    closers.push(() => service.close())
    const candidate = service.propose({ candidateId: 'candidate-lifecycle', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00.' })
    const subscription = service.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-lifecycle', revision: 1, scopeFingerprint: candidate.scopeFingerprint })
    const runner = new PushScheduleRunner({ databasePath, workerId: 'worker-a', now: () => utc('2026-08-16T21:00:00Z') })
    closers.push(() => runner.close())

    service.pause(subscription.subscriptionId)
    expect(runner.reconcile(subscription.subscriptionId, utc('2026-08-16T21:00:00Z'))).toHaveLength(0)
    service.resume(subscription.subscriptionId)
    expect(runner.reconcile(subscription.subscriptionId, utc('2026-08-16T21:00:00Z'))).toHaveLength(1)
    service.revoke(subscription.subscriptionId)
    expect(runner.reconcile(subscription.subscriptionId, utc('2026-08-17T21:00:00Z'))).toHaveLength(0)
  })

  it('expires a subscription before it can create a later occurrence', () => {
    const databasePath = databasePathFor(directories)
    const service = new PushSubscriptionService({ databasePath, now: () => utc('2026-08-16T19:00:00Z') })
    closers.push(() => service.close())
    const candidate = service.propose({ candidateId: 'candidate-expiry', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00.' })
    const subscription = service.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-expiry', revision: 1, scopeFingerprint: candidate.scopeFingerprint })
    const runner = new PushScheduleRunner({ databasePath, workerId: 'worker-a', now: () => utc('2026-08-16T21:00:00Z') })
    closers.push(() => runner.close())

    service.expire(subscription.subscriptionId)
    expect(runner.reconcile(subscription.subscriptionId)).toHaveLength(0)
    expect(runner.getSchedule(subscription.subscriptionId)).toEqual(expect.objectContaining({ status: 'paused' }))
  })
})

function databasePathFor(directories: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'ev-agent-schedule-'))
  directories.push(directory)
  return join(directory, 'runtime.sqlite')
}

function utc(value: string): number {
  return Date.parse(value)
}
