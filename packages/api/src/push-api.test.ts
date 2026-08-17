import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PushSubscriptionService } from '@ev-agent/push'
import { createPushSubscriptionApi } from './index.js'

describe('Push Subscription API', () => {
  const directories: string[] = []
  const services: PushSubscriptionService[] = []
  const apps: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close()
    for (const service of services.splice(0)) service.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('keeps candidate review separate from explicit confirmation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-agent-push-api-'))
    directories.push(directory)
    const service = new PushSubscriptionService({ databasePath: join(directory, 'runtime.sqlite'), now: () => 100 })
    services.push(service)
    const app = await createPushSubscriptionApi(service)
    apps.push(app)

    const proposed = await app.inject({ method: 'POST', url: '/push/candidates', payload: { candidateId: 'candidate-api', userScopeId: 'user-1', requestText: 'Watch https://feeds.example.test/ai daily at 20:00.' } })
    const candidate = proposed.json() as { revision: number; scopeFingerprint: string; status: string }
    const before = await app.inject({ method: 'GET', url: '/push/candidates/candidate-api' })
    const stale = await app.inject({ method: 'POST', url: '/push/candidates/candidate-api/confirm', payload: { subscriptionId: 'sub-api', revision: candidate.revision + 1, scopeFingerprint: candidate.scopeFingerprint } })
    const confirmed = await app.inject({ method: 'POST', url: '/push/candidates/candidate-api/confirm', payload: { subscriptionId: 'sub-api', revision: candidate.revision, scopeFingerprint: candidate.scopeFingerprint } })

    expect(proposed.statusCode).toBe(201)
    expect(candidate.status).toBe('pending')
    expect(before.statusCode).toBe(200)
    expect(stale.statusCode).toBe(409)
    expect(confirmed.statusCode).toBe(201)
    expect(confirmed.json()).toEqual(expect.objectContaining({ subscriptionId: 'sub-api', status: 'active' }))
  })
})
