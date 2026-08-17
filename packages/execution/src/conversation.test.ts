import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeterministicFakeModel } from '@ev-agent/model'
import { ConversationalRunService, PermissionPolicy, ToolRegistry, invalidToolInput, invalidToolOutput, validToolInput, validToolOutput } from './index.js'

const composition = { id: 'chat', version: '1.0.0', plugins: [] as const }

describe('ConversationalRunService', () => {
  const directories: string[] = []
  const services: ConversationalRunService[] = []

  afterEach(async () => {
    for (const service of services.splice(0)) await service.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('completes a text-only conversation and replays the same summary', async () => {
    const { service, databasePath } = createService(directories, services)
    const model = new DeterministicFakeModel([{ items: [{ type: 'text', text: 'Hello from the Agent.' }] }])
    const tools = new ToolRegistry()

    const result = await service.start({
      runId: 'run-text', composition, model, modelName: 'fake-model', messages: [{ role: 'user', content: 'Hello' }], tools,
    })

    expect(result.status).toBe('completed')
    expect(result.summary.response).toBe('Hello from the Agent.')
    expect(service.replay('run-text')).toEqual(result.summary)
    expect(service.listEvents('run-text').map((event) => event.type)).toEqual([
      'conversation.started', 'conversation.model.text.delta', 'conversation.model.completed', 'conversation.completed',
    ])
    expect(databasePath).toContain('ev-agent-conversation')
  })

  it('persists budget exhaustion so a fresh runtime can replay the checkpoint', async () => {
    const { service, databasePath } = createService(directories, services)
    const result = await service.start({
      runId: 'run-budget', composition, model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'never called' }] }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Use no turns' }], tools: new ToolRegistry(),
      budget: { maxModelTurns: 0, maxToolCalls: 1 },
    })

    expect(result.status).toBe('resumable')
    expect(result.summary.error).toBe('budget_exhausted:maxModelTurns')
    expect(service.listEvents('run-budget')).toContainEqual(expect.objectContaining({ type: 'conversation.budget_exhausted' }))
    await service.close()

    const recovered = new ConversationalRunService({ databasePath })
    services.push(recovered)
    const replayed = await recovered.start({
      runId: 'run-budget', composition, model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'still not called' }] }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Use no turns' }], tools: new ToolRegistry(),
      budget: { maxModelTurns: 0, maxToolCalls: 1 },
    })
    expect(replayed.summary.error).toBe('budget_exhausted:maxModelTurns')
    expect(recovered.listEvents('run-budget').filter((event) => event.type === 'conversation.budget_exhausted')).toHaveLength(1)
  })

  it('matches standing grants against the tool resource input', () => {
    const policy = new PermissionPolicy({ grants: [{ toolName: 'send_message', permission: 'message.send', matchesInput: (input) => (input as { recipient?: string }).recipient === 'approved-user' }] })

    expect(policy.decide({ runId: 'run', toolCallId: 'call', toolName: 'send_message', effectClass: 'external', requiredPermission: 'message.send', input: { recipient: 'approved-user' } })).toEqual({ status: 'allow' })
    expect(policy.decide({ runId: 'run', toolCallId: 'call', toolName: 'send_message', effectClass: 'external', requiredPermission: 'message.send', input: { recipient: 'other-user' } })).toEqual({ status: 'requires_approval', reason: 'external_effect_requires_approval' })
  })

  it('attaches a structured Evidence Bundle to the replayed response', async () => {
    const { service } = createService(directories, services)
    const evidenceBundle = {
      bundleId: 'evidence-1',
      runId: 'run-evidence',
      createdAt: 100,
      items: [{ itemId: 'item-1', referenceType: 'event' as const, referenceId: 'source-1', source: 'tool:read_status', applicability: 'status answer', confidence: 0.9 }],
    }

    const result = await service.start({
      runId: 'run-evidence', composition, model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'Ready.' }] }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Status?' }], tools: new ToolRegistry(), evidenceBundle,
    })

    expect(result.summary.evidenceBundle).toEqual(evidenceBundle)
    expect(service.replay('run-evidence').evidenceBundle).toEqual(evidenceBundle)
    expect(service.listEvents('run-evidence').map((event) => event.type)).toContain('conversation.evidence.attached')
  })

  it('executes a registered read tool and continues to a final response', async () => {
    const { service } = createService(directories, services)
    const read = vi.fn(() => ({ status: 'ready' }))
    const tools = new ToolRegistry()
    tools.register({
      name: 'read_status',
      description: 'Read status',
      inputSchema: { type: 'object', properties: {} },
      effectClass: 'read',
      validateInput: (input) => input !== null && typeof input === 'object' ? validToolInput() : invalidToolInput('object required'),
      validateOutput: () => validToolOutput(),
      execute: read,
    })
    const model = new DeterministicFakeModel([
      { items: [{ type: 'tool_call', id: 'call-1', name: 'read_status', arguments: {} }] },
      { items: [{ type: 'text', text: 'Status is ready.' }] },
    ])

    const result = await service.start({
      runId: 'run-tool', composition, model, modelName: 'fake-model', messages: [{ role: 'user', content: 'Check status' }], tools,
    })

    expect(result.status).toBe('completed')
    expect(result.summary.response).toBe('Status is ready.')
    expect(result.summary.toolCalls).toEqual([{ callId: 'call-1', name: 'read_status', output: { status: 'ready' } }])
    expect(read).toHaveBeenCalledWith({}, { runId: 'run-tool', toolCallId: 'call-1', idempotencyKey: 'run-tool:read_status:call-1' })
  })

  it('fails without invoking a tool when input validation fails', async () => {
    const { service } = createService(directories, services)
    const execute = vi.fn()
    const tools = new ToolRegistry()
    tools.register({
      name: 'read_status',
      description: 'Read status',
      inputSchema: { type: 'object' },
      effectClass: 'read',
      validateInput: () => invalidToolInput('scope is required'),
      validateOutput: () => validToolOutput(),
      execute,
    })
    const model = new DeterministicFakeModel([{ items: [{ type: 'tool_call', id: 'call-1', name: 'read_status', arguments: {} }] }])

    const result = await service.start({
      runId: 'run-invalid-tool', composition, model, modelName: 'fake-model', messages: [{ role: 'user', content: 'Check status' }], tools,
    })

    expect(result.status).toBe('failed')
    expect(result.summary.error).toContain('invalid input')
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails after tool execution when output validation fails', async () => {
    const { service } = createService(directories, services)
    const execute = vi.fn(() => ({ unsafe: true }))
    const tools = new ToolRegistry()
    tools.register({
      name: 'read_status', description: 'Read status', inputSchema: { type: 'object' }, effectClass: 'read',
      validateInput: () => validToolInput(), validateOutput: () => invalidToolOutput('status is required'), execute,
    })
    const result = await service.start({
      runId: 'run-invalid-output', composition,
      model: new DeterministicFakeModel([{ items: [{ type: 'tool_call', id: 'call-1', name: 'read_status', arguments: {} }] }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Check status' }], tools,
    })

    expect(result.status).toBe('failed')
    expect(result.summary.error).toContain('invalid output')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('checkpoints a controlled model interruption and resumes on retry', async () => {
    const { service } = createService(directories, services)
    const model = new DeterministicFakeModel([
      { interrupt: 'provider paused the request' },
      { items: [{ type: 'text', text: 'Resumed.' }] },
    ])
    const input = { runId: 'run-interrupted', composition, model, modelName: 'fake-model', messages: [{ role: 'user' as const, content: 'Continue' }], tools: new ToolRegistry() }

    const paused = await service.start(input)
    const resumed = await service.start(input)

    expect(paused.status).toBe('resumable')
    expect(paused.summary.error).toContain('interrupted:')
    expect(resumed.status).toBe('completed')
    expect(resumed.summary.response).toBe('Resumed.')
    expect(service.listEvents('run-interrupted').filter((event) => event.type === 'conversation.interrupted')).toHaveLength(1)
  })

  it('does not treat a length finish as a completed response', async () => {
    const { service } = createService(directories, services)
    const result = await service.start({
      runId: 'run-length', composition,
      model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'partial' }], finishReason: 'length' }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Long answer' }], tools: new ToolRegistry(),
    })

    expect(result.status).toBe('resumable')
    expect(result.summary.error).toBe('budget_exhausted:model_length')
    expect(result.summary.response).toBe('')
  })

  it('fails unknown tool calls and retains a diagnostic event', async () => {
    const { service } = createService(directories, services)
    const model = new DeterministicFakeModel([{ items: [{ type: 'tool_call', id: 'call-1', name: 'missing', arguments: {} }] }])

    const result = await service.start({
      runId: 'run-unknown-tool', composition, model, modelName: 'fake-model', messages: [{ role: 'user', content: 'Do it' }], tools: new ToolRegistry(),
    })

    expect(result.status).toBe('failed')
    expect(result.summary.error).toContain('unknown tool')
    expect(service.listEvents('run-unknown-tool').at(-1)?.type).toBe('conversation.failed')
  })

  it('pauses before an external effect and resumes after approval', async () => {
    const { service } = createService(directories, services)
    const send = vi.fn((_input: unknown, _context: unknown) => ({ sent: true }))
    const tools = externalTools(send)
    const firstModel = new DeterministicFakeModel([{ items: [{ type: 'tool_call', id: 'call-send', name: 'send_message', arguments: { text: 'hello' } }] }])

    const pending = await service.start({
      runId: 'run-approval', composition, model: firstModel, modelName: 'fake-model', messages: [{ role: 'user', content: 'Send hello' }], tools,
    })

    expect(pending.status).toBe('resumable')
    expect(pending.summary.pendingApproval).toMatchObject({ approvalId: 'run-approval:approval:call-send', name: 'send_message' })
    expect(send).not.toHaveBeenCalled()

    const completed = await service.decide({
      runId: 'run-approval', approvalId: 'run-approval:approval:call-send', decision: 'approved', reason: 'confirmed',
      composition, model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'Sent.' }] }]), modelName: 'fake-model',
      messages: [{ role: 'user', content: 'Send hello' }], tools,
    })

    expect(completed.status).toBe('completed')
    expect(completed.summary.response).toBe('Sent.')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ idempotencyKey: 'run-approval:send_message:call-send' }))
    expect(service.listEvents('run-approval').map((event) => event.type)).toContain('conversation.approval.decided')
  })

  it('records a denial and continues without invoking the external effect', async () => {
    const { service } = createService(directories, services)
    const send = vi.fn(() => ({ sent: true }))
    const tools = externalTools(send)
    const pending = await service.start({
      runId: 'run-denied', composition, model: new DeterministicFakeModel([{ items: [{ type: 'tool_call', id: 'call-denied', name: 'send_message', arguments: { text: 'no' } }] }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Send it' }], tools,
    })

    expect(pending.summary.pendingApproval).toBeDefined()
    const result = await service.decide({
      runId: 'run-denied', approvalId: 'run-denied:approval:call-denied', decision: 'denied', reason: 'not now',
      composition, model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'I did not send it.' }] }]), modelName: 'fake-model',
      messages: [{ role: 'user', content: 'Send it' }], tools,
    })

    expect(result.status).toBe('completed')
    expect(result.summary.toolCalls).toEqual([{ callId: 'call-denied', name: 'send_message', error: 'not now' }])
    expect(send).not.toHaveBeenCalled()
  })

  it('recovers a pending approval from a fresh service instance', async () => {
    const { service, databasePath } = createService(directories, services)
    const send = vi.fn(() => ({ sent: true }))
    const tools = externalTools(send)
    await service.start({
      runId: 'run-restart-approval', composition, model: new DeterministicFakeModel([{ items: [{ type: 'tool_call', id: 'call-restart', name: 'send_message', arguments: { text: 'restart' } }] }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Send it' }], tools,
    })
    await service.close()

    const recovered = new ConversationalRunService({ databasePath })
    services.push(recovered)
    const stillPending = await recovered.start({
      runId: 'run-restart-approval', composition, model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'unexpected' }] }]),
      modelName: 'fake-model', messages: [{ role: 'user', content: 'Send it' }], tools,
    })
    expect(stillPending.summary.pendingApproval).toBeDefined()

    const result = await recovered.decide({
      runId: 'run-restart-approval', approvalId: 'run-restart-approval:approval:call-restart', decision: 'approved',
      composition, model: new DeterministicFakeModel([{ items: [{ type: 'text', text: 'Recovered and sent.' }] }]), modelName: 'fake-model',
      messages: [{ role: 'user', content: 'Send it' }], tools,
    })
    expect(result.status).toBe('completed')
    expect(send).toHaveBeenCalledTimes(1)
  })
})

function createService(directories: string[], services: ConversationalRunService[]): { service: ConversationalRunService; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'ev-agent-conversation-'))
  directories.push(directory)
  const databasePath = join(directory, 'runtime.sqlite')
  const service = new ConversationalRunService({ databasePath })
  services.push(service)
  return { service, databasePath }
}

function externalTools(execute: (input: unknown, context: unknown) => unknown): ToolRegistry {
  const tools = new ToolRegistry()
  tools.register({
    name: 'send_message',
    description: 'Send a message',
    inputSchema: { type: 'object', required: ['text'] },
    effectClass: 'external',
    requiredPermission: 'message.send',
    validateInput: (input) => input !== null && typeof input === 'object' ? validToolInput() : invalidToolInput('object required'),
    validateOutput: () => validToolOutput(),
    execute,
  })
  return tools
}
