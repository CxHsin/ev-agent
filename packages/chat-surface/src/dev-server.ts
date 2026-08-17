import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionChatApi } from '@ev-agent/api'
import { ToolRegistry, validToolInput, validToolOutput } from '@ev-agent/execution'
import { DeterministicFakeModel } from '@ev-agent/model'
import { SessionService } from '@ev-agent/session'

const agentDefinition = { id: 'personal-agent', version: '1.0.0', fingerprint: 'local-config' }
const directory = mkdtempSync(join(tmpdir(), 'ev-agent-chat-surface-'))
const databasePath = join(directory, 'runtime.sqlite')
const sessionService = new SessionService({ databasePath })
const tools = new ToolRegistry()
tools.register({
  name: 'read_status',
  description: 'Read local harness status',
  inputSchema: { type: 'object' },
  effectClass: 'read',
  validateInput: () => validToolInput(),
  validateOutput: () => validToolOutput(),
  execute: () => ({ status: 'ready', source: 'local development runtime' }),
})

const api = await createSessionChatApi({
  databasePath,
  sessionService,
  agentDefinition,
  composition: { id: agentDefinition.id, version: agentDefinition.version, plugins: [] },
  model: () => new DeterministicFakeModel([{ items: [{ type: 'text', text: 'This deterministic local Run is ready. Connect a DeepSeek Adapter to use a real provider.' }] }]),
  modelName: 'fake-model',
  tools,
})

await api.listen({ host: '127.0.0.1', port: 4175 })
console.log('Local Chat API: http://127.0.0.1:4175')

const close = async (): Promise<void> => {
  await api.close()
  sessionService.close()
}
process.once('SIGINT', () => { void close() })
process.once('SIGTERM', () => { void close() })
