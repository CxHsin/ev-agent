import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeterministicFakeModel } from '@ev-agent/model'
import { ToolRegistry } from '@ev-agent/execution'
import { SessionDefinitionMismatchError, SessionService } from './index.js'

const definition = { id: 'agent', version: '1.0.0', fingerprint: 'agent-v1' }
const composition = { id: 'agent', version: '1.0.0', plugins: [] as const }

describe('version-bound Session', () => {
  const directories: string[] = []
  const services: SessionService[] = []

  afterEach(() => {
    for (const service of services.splice(0)) service.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('persists its Agent Definition binding and rejects a changed version', () => {
    const { service, databasePath } = createService(directories, services)
    expect(service.create({ sessionId: 'session-1', ...definition })).toEqual(expect.objectContaining({
      sessionId: 'session-1', agentDefinitionId: 'agent', agentDefinitionVersion: '1.0.0', agentDefinitionFingerprint: 'agent-v1',
    }))
    service.close()

    const recovered = openService(databasePath, services)
    expect(recovered.get('session-1')).toEqual(expect.objectContaining({ agentDefinitionVersion: '1.0.0' }))
    expect(() => recovered.assertDefinition('session-1', { ...definition, version: '2.0.0', fingerprint: 'agent-v2' })).toThrow(SessionDefinitionMismatchError)
    expect(recovered.assertDefinition('session-1', definition).sessionId).toBe('session-1')
  })

  it('creates a durable message Run and restores its session messages', async () => {
    const { service } = createService(directories, services)
    service.create({ sessionId: 'session-chat', ...definition })

    const result = await service.runMessage({
      sessionId: 'session-chat',
      runId: 'run-1',
      message: 'Hello',
      agentDefinition: definition,
      composition,
      model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'Hello back.' }] }]),
      modelName: 'fake-model',
      tools: new ToolRegistry(),
    })

    expect(result.status).toBe('completed')
    expect(service.listMessages('session-chat')).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello', runId: 'run-1', sequence: 1 }),
      expect.objectContaining({ role: 'assistant', content: 'Hello back.', runId: 'run-1', sequence: 2 }),
    ])
    service.eraseMessage('session-chat', 'run-1:session:user')
    expect(service.listMessages('session-chat')[0]?.content).toBe('[erased]')
  })

  it('keeps a Session unchanged when the composition version changes', async () => {
    const { service } = createService(directories, services)
    service.create({ sessionId: 'session-stable', ...definition })

    await expect(service.runMessage({
      sessionId: 'session-stable',
      runId: 'run-mismatch',
      message: 'Should fail',
      agentDefinition: { ...definition, version: '2.0.0', fingerprint: 'agent-v2' },
      composition: { ...composition, version: '2.0.0' },
      model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'must not run' }] }]),
      modelName: 'fake-model',
      tools: new ToolRegistry(),
    })).rejects.toBeInstanceOf(SessionDefinitionMismatchError)
    expect(service.listMessages('session-stable')).toHaveLength(0)
  })
})

function createService(directories: string[], services: SessionService[]): { service: SessionService; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'ev-agent-session-'))
  directories.push(directory)
  const databasePath = join(directory, 'runtime.sqlite')
  return { service: openService(databasePath, services), databasePath }
}

function openService(databasePath: string, services: SessionService[]): SessionService {
  const service = new SessionService({ databasePath })
  services.push(service)
  return service
}
