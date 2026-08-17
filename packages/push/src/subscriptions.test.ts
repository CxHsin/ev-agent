import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PushSubscriptionService, PushSubscriptionValidationError, parseSubscriptionRequest } from './index.js'

describe('Push Subscription Candidate', () => {
  const directories: string[] = []
  const services: PushSubscriptionService[] = []

  afterEach(() => {
    for (const service of services.splice(0)) service.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('parses a bounded request without activating authority', () => {
    const draft = parseSubscriptionRequest('Watch https://feeds.example.test/ai and github.com/CxHsin/ev-agent daily at 20:30, 3 items, Windows notifications.', 'Asia/Shanghai', 100)

    expect(draft).toEqual(expect.objectContaining({
      sources: ['https://feeds.example.test/ai', 'github:CxHsin/ev-agent'],
      schedule: 'daily@20:30', timezone: 'Asia/Shanghai', channel: 'windows', itemBudget: 3,
    }))
  })

  it('requires explicit version-bound confirmation and survives restart', () => {
    const databasePath = databasePathFor(directories)
    const first = new PushSubscriptionService({ databasePath, now: () => 100 })
    services.push(first)
    const candidate = first.propose({ candidateId: 'candidate-1', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00.' })

    expect(candidate.status).toBe('pending')
    expect(first.listSubscriptions('user-1')).toHaveLength(0)
    expect(() => first.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-1', revision: 2, scopeFingerprint: candidate.scopeFingerprint })).toThrow(/changed/)
    const subscription = first.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-1', revision: candidate.revision, scopeFingerprint: candidate.scopeFingerprint })
    first.close()

    const recovered = new PushSubscriptionService({ databasePath, now: () => 200 })
    services.push(recovered)
    expect(recovered.getCandidate('candidate-1')).toEqual(expect.objectContaining({ status: 'confirmed', decisionReason: 'explicit_confirmation' }))
    expect(recovered.getSubscription('subscription-1')).toEqual(subscription)
    expect(() => recovered.confirm({ candidateId: candidate.candidateId, subscriptionId: 'subscription-other', revision: candidate.revision, scopeFingerprint: candidate.scopeFingerprint })).not.toThrow()
    expect(recovered.pause('subscription-1').status).toBe('paused')
    expect(recovered.resume('subscription-1').status).toBe('active')
    expect(recovered.revoke('subscription-1').status).toBe('revoked')
    expect(() => recovered.resume('subscription-1')).toThrow(PushSubscriptionValidationError)
  })

  it('does not let an invalid request create a Candidate', () => {
    expect(() => parseSubscriptionRequest('Send me interesting engineering news.', 'UTC', 100)).toThrow(/source|repository/)
  })
})

function databasePathFor(directories: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'ev-agent-push-'))
  directories.push(directory)
  return join(directory, 'runtime.sqlite')
}
