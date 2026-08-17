import {
  ModelError,
  type ModelAdapter,
  type ModelCapability,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelResponseItem,
  type ModelStreamEvent,
  type ModelTool,
  type ModelUsage,
  type SecretRef,
} from './model.js'

const DEEPSEEK_CAPABILITIES = ['text', 'reasoning', 'tool_calls', 'streaming'] as const

export interface DeepSeekHttpRequest {
  readonly endpoint: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Readonly<Record<string, unknown>>
}

export interface DeepSeekTransport {
  complete(request: DeepSeekHttpRequest): Promise<unknown>
  stream(request: DeepSeekHttpRequest): AsyncIterable<unknown>
}

export interface DeepSeekAdapterOptions {
  readonly apiKey: SecretRef
  readonly resolveSecret: (reference: SecretRef) => string
  readonly endpoint?: string
  readonly transport?: DeepSeekTransport
}

export interface DeepSeekModelRequest extends ModelRequest {
  readonly previousResponseId?: string
  readonly conversation?: string
  readonly store?: boolean
  readonly background?: boolean
  readonly metadata?: Readonly<Record<string, string>>
  readonly imageInputs?: readonly unknown[]
  readonly fileInputs?: readonly unknown[]
  readonly builtInTools?: readonly string[]
  readonly maxToolCalls?: number
  readonly parallelToolCalls?: boolean
}

export class DeepSeekModelAdapter implements ModelAdapter {
  readonly provider = 'deepseek'
  readonly capabilities = DEEPSEEK_CAPABILITIES
  private readonly endpoint: string
  private readonly transport: DeepSeekTransport

  constructor(private readonly options: DeepSeekAdapterOptions) {
    this.endpoint = options.endpoint ?? 'https://api.deepseek.com/v1/responses'
    this.transport = options.transport ?? createFetchTransport()
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const deepSeekRequest = request as DeepSeekModelRequest
    validateRequest(deepSeekRequest, this.capabilities)
    const raw = await this.transport.complete(this.httpRequest(deepSeekRequest, false))
    return normalizeResponse(raw, deepSeekRequest)
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const deepSeekRequest = request as DeepSeekModelRequest
    validateRequest(deepSeekRequest, this.capabilities)
    const toolCalls = new Map<string, { id: string; name: string }>()
    const text: string[] = []
    const reasoning: string[] = []
    const argumentsById = new Map<string, { name: string; argumentsText: string }>()
    let completed = false
    for await (const raw of this.transport.stream(this.httpRequest(deepSeekRequest, true))) {
      const events = normalizeStreamEvent(raw, deepSeekRequest, toolCalls)
      if (events === undefined) {
        if (isStreamDone(raw) && !completed) {
          completed = true
          yield { type: 'completed', response: buildStreamResponse(deepSeekRequest, text, reasoning, argumentsById) }
        }
        continue
      }
      for (const event of Array.isArray(events) ? events : [events]) {
        if (event.type === 'text_delta') text.push(event.text)
        if (event.type === 'reasoning_delta') reasoning.push(event.text)
        if (event.type === 'tool_call_delta') {
          const current = argumentsById.get(event.id) ?? { name: event.name, argumentsText: '' }
          argumentsById.set(event.id, { name: event.name === 'unknown' ? current.name : event.name, argumentsText: current.argumentsText + event.argumentsDelta })
        }
        if (event.type === 'completed') completed = true
        yield event
      }
    }
    if (!completed && (text.length > 0 || reasoning.length > 0 || argumentsById.size > 0)) {
      yield { type: 'completed', response: buildStreamResponse(deepSeekRequest, text, reasoning, argumentsById) }
    }
  }

  private httpRequest(request: DeepSeekModelRequest, stream: boolean): DeepSeekHttpRequest {
    const body: Record<string, unknown> = {
      model: request.model,
      input: request.messages.flatMap(toProviderMessages),
      stream,
    }
    if (request.tools !== undefined) body.tools = request.tools.map(toProviderTool)
    return {
      endpoint: this.endpoint,
      headers: {
        authorization: `Bearer ${this.options.resolveSecret(this.options.apiKey)}`,
        'content-type': 'application/json',
      },
      body,
    }
  }
}

function validateRequest(request: DeepSeekModelRequest, capabilities: readonly ModelCapability[]): void {
  if (request.model.length === 0) throw new ModelError('model is required', 'invalid_request')
  const requested = request.capabilities ?? []
  const unsupported = requested.filter((capability) => !capabilities.includes(capability))
  if (unsupported.length > 0) {
    throw new ModelError(`unsupported capability: ${unsupported.join(', ')}`, 'unsupported_capability')
  }
  const unsupportedFields: string[] = []
  if (request.previousResponseId !== undefined) unsupportedFields.push('previousResponseId')
  if (request.conversation !== undefined) unsupportedFields.push('conversation')
  if (request.store !== undefined) unsupportedFields.push('store')
  if (request.background !== undefined) unsupportedFields.push('background')
  if (request.metadata !== undefined) unsupportedFields.push('metadata')
  if (request.imageInputs !== undefined) unsupportedFields.push('imageInputs')
  if (request.fileInputs !== undefined) unsupportedFields.push('fileInputs')
  if (request.builtInTools !== undefined && request.builtInTools.length > 0) unsupportedFields.push('builtInTools')
  if (request.maxToolCalls !== undefined) unsupportedFields.push('maxToolCalls')
  if (request.parallelToolCalls === false) unsupportedFields.push('parallelToolCalls=false')
  if (unsupportedFields.length > 0) {
    throw new ModelError(`unsupported DeepSeek request fields: ${unsupportedFields.join(', ')}`, 'unsupported_capability')
  }
}

function toProviderMessages(message: ModelMessage): readonly Record<string, unknown>[] {
  if (message.role === 'tool') {
    return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }]
  }
  if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return [
      ...(message.content.length === 0 ? [] : [{ role: 'assistant', content: [{ type: 'output_text', text: message.content }] }]),
      ...message.toolCalls.map((toolCall) => ({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.arguments),
      })),
    ]
  }
  return [{
    role: message.role,
    content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
  }]
}

function toProviderTool(tool: ModelTool): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }
}

function normalizeResponse(raw: unknown, request: ModelRequest): ModelResponse {
  const record = asRecord(raw)
  throwIfProviderError(record)
  const items = normalizeItems(record)
  if (items.length === 0 && typeof record.output_text !== 'string' && !hasChoices(record)) {
    throw new ModelError('DeepSeek response has no normalized output', 'invalid_response')
  }
  const usage = normalizeUsage(record.usage)
  const response: ModelResponse = {
    responseId: stringValue(record.id) ?? 'deepseek:response',
    provider: 'deepseek',
    model: stringValue(record.model) ?? request.model,
    items,
    finishReason: finishReason(record, items),
    ...(usage === undefined ? {} : { usage }),
    metadata: {
      ...(stringValue(record.status) === undefined ? {} : { status: stringValue(record.status) as string }),
    },
  }
  return response
}

function normalizeStreamEvent(
  raw: unknown,
  request: ModelRequest,
  toolCalls: Map<string, { id: string; name: string }>,
): ModelStreamEvent | readonly ModelStreamEvent[] | undefined {
  const record = asRecord(raw)
  if (record.type === 'done' || record.data === '[DONE]') return undefined
  if (record.type === 'response.completed') {
    return { type: 'completed', response: normalizeResponse(record.response ?? record, request) }
  }
  if (record.type === 'response.failed' || record.error !== undefined) {
    const message = stringValue(asRecord(record.error).message) ?? stringValue(record.message) ?? 'DeepSeek stream failed'
    return { type: 'failed', error: new ModelError(message, 'provider_error', true) }
  }
  if (record.type === 'response.output_item.added') {
    const item = asRecord(record.item)
    if (item.type === 'function_call') rememberToolCall(item, toolCalls)
    return undefined
  }
  const delta = stringValue(record.delta)
  if (record.type === 'response.output_text.delta' || record.type === 'text_delta') {
    return delta === undefined ? undefined : { type: 'text_delta', text: delta }
  }
  if (record.type === 'response.reasoning_summary_text.delta' || record.type === 'reasoning_delta') {
    return delta === undefined ? undefined : { type: 'reasoning_delta', text: delta }
  }
  if (record.type === 'response.function_call_arguments.delta' || record.type === 'tool_call_delta') {
    const { id, name } = resolveToolCall(record, toolCalls)
    return delta === undefined ? undefined : { type: 'tool_call_delta', id, name, argumentsDelta: delta }
  }
  if (record.choices !== undefined) {
    const choice = asRecord(asArray(record.choices)[0])
    const message = asRecord(choice.delta)
    const events: ModelStreamEvent[] = []
    if (typeof message.content === 'string') events.push({ type: 'text_delta', text: message.content })
    for (const rawTool of asArray(message.tool_calls)) {
      const tool = asRecord(rawTool)
      const functionCall = asRecord(tool.function)
      if (functionCall.name !== undefined || functionCall.arguments !== undefined) {
        const { id, name } = resolveToolCall({ ...tool, ...functionCall }, toolCalls)
        events.push({ type: 'tool_call_delta', id, name, argumentsDelta: stringValue(functionCall.arguments) ?? '' })
      }
    }
    return events.length === 0 ? undefined : events
  }
  return undefined
}

function isStreamDone(raw: unknown): boolean {
  const record = asRecord(raw)
  return record.type === 'done' || record.data === '[DONE]'
}

function buildStreamResponse(
  request: ModelRequest,
  text: readonly string[],
  reasoning: readonly string[],
  argumentsById: ReadonlyMap<string, { name: string; argumentsText: string }>,
): ModelResponse {
  const items: ModelResponseItem[] = []
  if (reasoning.length > 0) items.push({ type: 'reasoning', text: reasoning.join('') })
  for (const [id, value] of argumentsById) items.push({ type: 'tool_call', id, name: value.name, arguments: parseArguments(value.argumentsText) })
  if (text.length > 0) items.push({ type: 'text', text: text.join('') })
  return {
    responseId: 'deepseek:stream',
    provider: 'deepseek',
    model: request.model,
    items,
    finishReason: argumentsById.size > 0 ? 'tool_call' : 'stop',
  }
}

function resolveToolCall(record: Record<string, unknown>, toolCalls: Map<string, { id: string; name: string }>): { id: string; name: string } {
  const itemId = stringValue(record.item_id)
  const callId = stringValue(record.call_id)
  const providerId = callId ?? itemId ?? stringValue(record.id)
  const index = numberValue(record.output_index) ?? numberValue(record.index)
  const key = itemId === undefined
    ? (providerId === undefined ? (index === undefined ? `anonymous:${toolCalls.size}` : `index:${index}`) : `call:${providerId}`)
    : `item:${itemId}`
  const previous = toolCalls.get(key) ?? (callId === undefined ? undefined : toolCalls.get(`call:${callId}`))
  const id = previous?.id ?? providerId ?? `deepseek:tool:${key}`
  const name = stringValue(record.name) ?? previous?.name ?? 'unknown'
  toolCalls.set(key, { id, name })
  if (callId !== undefined) toolCalls.set(`call:${callId}`, { id, name })
  if (itemId !== undefined) toolCalls.set(`item:${itemId}`, { id, name })
  return { id, name }
}

function rememberToolCall(record: Record<string, unknown>, toolCalls: Map<string, { id: string; name: string }>): void {
  resolveToolCall(record, toolCalls)
}

function normalizeItems(record: Record<string, unknown>): ModelResponseItem[] {
  const items: ModelResponseItem[] = []
  for (const item of asArray(record.output)) {
    const value = asRecord(item)
    if (value.type === 'function_call') {
      items.push({
        type: 'tool_call',
        id: stringValue(value.call_id) ?? stringValue(value.id) ?? `deepseek:tool:${items.length}`,
        name: stringValue(value.name) ?? 'unknown',
        arguments: parseArguments(value.arguments),
      })
      continue
    }
    if (value.type === 'reasoning') {
      for (const summary of asArray(value.summary)) {
        const text = stringValue(asRecord(summary).text)
        if (text !== undefined) items.push({ type: 'reasoning', text })
      }
      continue
    }
    if (value.type === 'message') {
      for (const content of asArray(value.content)) {
        const contentRecord = asRecord(content)
        const text = stringValue(contentRecord.text)
        if (text !== undefined) items.push({ type: 'text', text })
      }
      continue
    }
    const text = stringValue(value.text)
    if (text !== undefined) items.push({ type: 'text', text })
  }
  const outputText = stringValue(record.output_text)
  if (outputText !== undefined && !items.some((item) => item.type === 'text')) items.push({ type: 'text', text: outputText })
  for (const choice of asArray(record.choices)) {
    const message = asRecord(asRecord(choice).message)
    const text = stringValue(message.content)
    if (text !== undefined) items.push({ type: 'text', text })
    for (const tool of asArray(message.tool_calls)) {
      const toolRecord = asRecord(tool)
      const functionCall = asRecord(toolRecord.function)
      items.push({
        type: 'tool_call',
        id: stringValue(toolRecord.id) ?? `deepseek:tool:${items.length}`,
        name: stringValue(functionCall.name) ?? 'unknown',
        arguments: parseArguments(functionCall.arguments),
      })
    }
  }
  return items
}

function finishReason(record: Record<string, unknown>, items: readonly ModelResponseItem[]): ModelResponse['finishReason'] {
  if (items.some((item) => item.type === 'tool_call')) return 'tool_call'
  const value = stringValue(record.status) ?? stringValue(asRecord(asArray(record.choices)[0]).finish_reason)
  if (value === 'incomplete' || value === 'length' || value === 'max_output_tokens') return 'length'
  if (value === 'failed' || value === 'error') return 'error'
  return 'stop'
}

function normalizeUsage(value: unknown): ModelUsage | undefined {
  const usage = asRecord(value)
  const inputTokens = numberValue(usage.input_tokens) ?? numberValue(usage.prompt_tokens)
  const outputTokens = numberValue(usage.output_tokens) ?? numberValue(usage.completion_tokens)
  const totalTokens = numberValue(usage.total_tokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  }
}

function throwIfProviderError(record: Record<string, unknown>): void {
  if (record.error === undefined) return
  const error = asRecord(record.error)
  const message = stringValue(error.message) ?? stringValue(record.message) ?? 'DeepSeek request failed'
  throw new ModelError(message, 'provider_error', true)
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {}
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function hasChoices(record: Record<string, unknown>): boolean {
  return Array.isArray(record.choices)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function createFetchTransport(): DeepSeekTransport {
  return {
    async complete(request: DeepSeekHttpRequest): Promise<unknown> {
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
      })
      const payload = await response.json() as unknown
      return response.ok ? payload : { error: payload }
    },
    async *stream(request: DeepSeekHttpRequest): AsyncIterable<unknown> {
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
      })
      if (!response.ok) {
        yield { type: 'response.failed', error: await response.json() as unknown }
        return
      }
      if (response.body === null) {
        yield { type: 'response.failed', message: 'DeepSeek stream has no body' }
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const data = block.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim()
          if (!data) continue
          if (data === '[DONE]') {
            yield { type: 'done' }
            continue
          }
          try {
            yield JSON.parse(data) as unknown
          } catch {
            yield { type: 'response.failed', message: 'DeepSeek returned invalid SSE data' }
          }
        }
        if (chunk.done) break
      }
      if (buffer.trim().length > 0) {
        const data = buffer.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim()
        if (data && data !== '[DONE]') {
          try {
            yield JSON.parse(data) as unknown
          } catch {
            yield { type: 'response.failed', message: 'DeepSeek returned invalid SSE data' }
          }
        }
      }
    },
  }
}
