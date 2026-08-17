import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@ev-agent/durability'
import { createChatApi, type ChatApiHandlers } from './index.js'

describe('Fastify/SSE Chat API', () => {
  const apps: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close()
  })

  it('exposes Session and message domain handlers with validation', async () => {
    const submitMessage = vi.fn(async (input) => ({ runId: input.runId, status: 'completed', summary: { response: 'ok' } }))
    const handlers = createHandlers({ submitMessage })
    const app = await createChatApi({ handlers })
    apps.push(app)

    const created = await app.inject({ method: 'POST', url: '/sessions', payload: {
      sessionId: 'session-1', agentDefinitionId: 'agent', agentDefinitionVersion: '1.0.0', agentDefinitionFingerprint: 'fp-1',
    } })
    const result = await app.inject({ method: 'POST', url: '/sessions/session-1/messages', payload: { runId: 'run-1', message: 'hello' } })
    const invalid = await app.inject({ method: 'POST', url: '/sessions/session-1/messages', payload: { runId: '', message: '' } })

    expect(created.statusCode).toBe(201)
    expect(result.statusCode).toBe(202)
    expect(result.json()).toEqual({ runId: 'run-1', status: 'completed', summary: { response: 'ok' } })
    expect(submitMessage).toHaveBeenCalledWith({ sessionId: 'session-1', runId: 'run-1', message: 'hello' })
    expect(invalid.statusCode).toBe(400)
  })

  it('streams durable events after a cursor and delegates approval decisions', async () => {
    const decideApproval = vi.fn(async () => ({ status: 'completed' }))
    const handlers = createHandlers({ decideApproval, listRunEvents: async (): Promise<readonly AgentEvent[]> => [
      { eventId: 'event-1', runId: 'run-1', sequence: 1, type: 'started', occurredAt: 1, payloadStatus: 'missing', payload: undefined },
      { eventId: 'event-2', runId: 'run-1', sequence: 2, type: 'completed', occurredAt: 2, payloadStatus: 'present', payload: { ok: true } },
    ] })
    const app = await createChatApi({ handlers })
    apps.push(app)

    const stream = await app.inject({ method: 'GET', url: '/runs/run-1/events?after=1' })
    const reconnected = await app.inject({ method: 'GET', url: '/runs/run-1/events', headers: { 'last-event-id': '1' } })
    const approval = await app.inject({ method: 'POST', url: '/approvals/approval-1', payload: { runId: 'run-1', decision: 'approved', reason: 'yes' } })

    expect(stream.statusCode).toBe(200)
    expect(stream.headers['content-type']).toContain('text/event-stream')
    expect(stream.body).toContain('id: 2')
    expect(stream.body).toContain('event: completed')
    expect(stream.body).not.toContain('id: 1')
    expect(reconnected.body).toContain('id: 2')
    expect(reconnected.body).not.toContain('id: 1')
    expect(approval.statusCode).toBe(200)
    expect(decideApproval).toHaveBeenCalledWith({ approvalId: 'approval-1', runId: 'run-1', decision: 'approved', reason: 'yes' })
  })

  it('returns 404 when a streaming handler has no events for the Run', async () => {
    const handlers = createHandlers({ streamRunEvents: async function* () { return } })
    const app = await createChatApi({ handlers })
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/runs/missing/events' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'run_not_found' })
  })
})

function createHandlers(overrides: Partial<ChatApiHandlers> = {}): ChatApiHandlers {
  return {
    createSession: async (input) => input,
    getSession: async () => ({ sessionId: 'session-1' }),
    listSessionMessages: async () => [],
    submitMessage: async () => ({ status: 'completed' }),
    getRun: async () => ({ status: 'completed' }),
    decideApproval: async () => ({ status: 'approved' }),
    listRunEvents: async () => [],
    ...overrides,
  }
}
