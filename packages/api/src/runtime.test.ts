import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeterministicFakeModel } from '@ev-agent/model'
import { SessionService } from '@ev-agent/session'
import { ToolRegistry } from '@ev-agent/execution'
import { createSessionChatHandlers } from './index.js'

describe('wired Session Chat runtime', () => {
  const directories: string[] = []
  const sessions: SessionService[] = []

  afterEach(() => {
    for (const session of sessions.splice(0)) session.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('runs a Session message through the durable conversational runtime', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-agent-api-runtime-'))
    directories.push(directory)
    const databasePath = join(directory, 'runtime.sqlite')
    const sessionService = new SessionService({ databasePath })
    sessions.push(sessionService)
    const definition = { id: 'agent', version: '1.0.0', fingerprint: 'fp-1' }
    const handlers = createSessionChatHandlers({
      databasePath,
      sessionService,
      agentDefinition: definition,
      composition: { id: 'agent', version: '1.0.0', plugins: [] },
      model: () => new DeterministicFakeModel([{ items: [{ type: 'text', text: 'Connected.' }] }]),
      modelName: 'fake-model',
      tools: () => new ToolRegistry(),
    })

    await handlers.createSession({ sessionId: 'session-1', agentDefinitionId: 'agent', agentDefinitionVersion: '1.0.0', agentDefinitionFingerprint: 'fp-1' })
    const result = await handlers.submitMessage({ sessionId: 'session-1', runId: 'run-1', message: 'Hello' }) as { status: string; summary: { response: string } }
    const run = await handlers.getRun('run-1') as { summary: { response: string } }
    const events = await handlers.listRunEvents('run-1')

    expect(result).toMatchObject({ status: 'completed', summary: { response: 'Connected.' } })
    expect(run.summary.response).toBe('Connected.')
    expect(events[0]).toMatchObject({ type: 'conversation.started', payload: { sessionId: 'session-1' } })
  })
})
