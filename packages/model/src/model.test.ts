import { describe, expect, it, vi } from 'vitest'
import {
  DeepSeekModelAdapter,
  DeterministicFakeModel,
  ModelError,
  type DeepSeekHttpRequest,
  type DeepSeekTransport,
  type ModelRequest,
  secretRef,
} from './index.js'

const request: ModelRequest = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: 'Find the current status.' }],
  tools: [{ name: 'read_status', description: 'Read status', inputSchema: { type: 'object' } }],
  capabilities: ['text', 'tool_calls'],
}

describe('Model capability contract', () => {
  it('drives a deterministic fake through text and tool-call turns', async () => {
    const model = new DeterministicFakeModel([
      { items: [{ type: 'tool_call', id: 'call-1', name: 'read_status', arguments: {} }] },
      { items: [{ type: 'text', text: 'The status is ready.' }] },
    ])

    const first = await model.complete(request)
    const second = await model.complete({ ...request, messages: [...request.messages, { role: 'tool', toolCallId: 'call-1', toolName: 'read_status', content: 'ready' }] })

    expect(first.finishReason).toBe('tool_call')
    expect(first.items[0]).toEqual({ type: 'tool_call', id: 'call-1', name: 'read_status', arguments: {} })
    expect(second.items).toEqual([{ type: 'text', text: 'The status is ready.' }])
  })

  it('emits normalized stream events from the same fake contract', async () => {
    const model = new DeterministicFakeModel([{ items: [{ type: 'text', text: 'hello' }] }])
    const events = []
    for await (const event of model.stream(request)) events.push(event)

    expect(events).toHaveLength(2)
    expect(events[0]!).toEqual({ type: 'text_delta', text: 'hello' })
    expect(events[1]!.type).toBe('completed')
  })
})

describe('DeepSeekModelAdapter', () => {
  it('rejects unsupported stateful capabilities before transport', async () => {
    const transport = createTransport()
    const adapter = new DeepSeekModelAdapter({ ...deepSeekCredentials(), transport })

    await expect(adapter.complete({ ...request, previousResponseId: 'provider-state' } as never)).rejects.toMatchObject({
      code: 'unsupported_capability',
    })
    expect(transport.complete).not.toHaveBeenCalled()
  })

  it('normalizes text, reasoning, tool calls, and usage', async () => {
    const transport = createTransport({
      id: 'resp-1',
      model: 'deepseek-v4-flash',
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Check the source.' }] },
        { type: 'function_call', call_id: 'call-1', name: 'read_status', arguments: '{"scope":"current"}' },
        { type: 'message', content: [{ type: 'output_text', text: 'I checked it.' }] },
      ],
      usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
    })
    const adapter = new DeepSeekModelAdapter({ ...deepSeekCredentials(), transport })

    const response = await adapter.complete(request)

    expect(response.items).toEqual([
      { type: 'reasoning', text: 'Check the source.' },
      { type: 'tool_call', id: 'call-1', name: 'read_status', arguments: { scope: 'current' } },
      { type: 'text', text: 'I checked it.' },
    ])
    expect(response.usage).toEqual({ inputTokens: 8, outputTokens: 5, totalTokens: 13 })
    expect(transport.complete).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ model: request.model, stream: false }),
    }))
  })

  it('normalizes streaming text and completion events', async () => {
    const transport = createTransport(undefined, [
      { type: 'response.output_text.delta', delta: 'hello' },
      { type: 'response.completed', response: { id: 'resp-2', model: request.model, output_text: 'hello', status: 'completed' } },
    ])
    const adapter = new DeepSeekModelAdapter({ ...deepSeekCredentials(), transport })
    const events = []
    for await (const event of adapter.stream(request)) events.push(event)

    expect(events[0]!).toEqual({ type: 'text_delta', text: 'hello' })
    expect(events[1]!).toMatchObject({ type: 'completed', response: { responseId: 'resp-2' } })
  })

  it('normalizes provider failures without exposing the request secret', async () => {
    const transport = createTransport({ error: { message: 'invalid model' } })
    const adapter = new DeepSeekModelAdapter({ ...deepSeekCredentials('secret-value'), transport })

    const error = await adapter.complete(request).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(ModelError)
    expect(error).toMatchObject({ code: 'provider_error', message: 'invalid model' })
    expect(String(error)).not.toContain('secret-value')
  })

  it('serializes tool history as Responses API input items', async () => {
    const transport = createTransport()
    const adapter = new DeepSeekModelAdapter({ ...deepSeekCredentials(), transport })

    await adapter.complete({
      ...request,
      messages: [
        { role: 'user', content: 'Read status' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'read_status', arguments: { scope: 'current' } }] },
        { role: 'tool', toolCallId: 'call-1', toolName: 'read_status', content: '{"ok":true}' },
      ],
    })

    expect(transport.complete).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        input: [
          expect.objectContaining({ role: 'user' }),
          expect.objectContaining({ type: 'function_call', call_id: 'call-1' }),
          expect.objectContaining({ type: 'function_call_output', call_id: 'call-1' }),
        ],
      }),
    }))
  })

  it('keeps parallel streamed function calls distinct by provider item identity', async () => {
    const transport = createTransport(undefined, [
      { type: 'response.output_item.added', item: { type: 'function_call', item_id: 'item-1', call_id: 'call-1', name: 'read_status' } },
      { type: 'response.output_item.added', item: { type: 'function_call', item_id: 'item-2', call_id: 'call-2', name: 'read_status' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"a":' },
      { type: 'response.function_call_arguments.delta', item_id: 'item-2', delta: '{"b":' },
      { type: 'response.completed', response: { id: 'resp-3', model: request.model, output_text: 'done', status: 'completed' } },
    ])
    const adapter = new DeepSeekModelAdapter({ ...deepSeekCredentials(), transport })
    const events = []
    for await (const event of adapter.stream(request)) events.push(event)

    expect(events.filter((event) => event.type === 'tool_call_delta')).toEqual([
      { type: 'tool_call_delta', id: 'call-1', name: 'read_status', argumentsDelta: '{"a":' },
      { type: 'tool_call_delta', id: 'call-2', name: 'read_status', argumentsDelta: '{"b":' },
    ])
  })
})

function createTransport(response?: unknown, streamEvents: readonly unknown[] = []): DeepSeekTransport & {
  complete: ReturnType<typeof vi.fn>
  stream: ReturnType<typeof vi.fn>
} {
  return {
    complete: vi.fn(async (_request: DeepSeekHttpRequest) => response ?? { output_text: 'ok', status: 'completed' }),
    stream: vi.fn(async function* () {
      for (const event of streamEvents) yield event
    }),
  }
}

function deepSeekCredentials(value = 'secret') {
  return { apiKey: secretRef('deepseek-test'), resolveSecret: () => value }
}
