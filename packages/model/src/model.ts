export type ModelCapability = 'text' | 'reasoning' | 'tool_calls' | 'streaming'

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool'

export interface SecretRef {
  readonly name: string
}

export function secretRef(name: string): SecretRef {
  if (name.length === 0) throw new Error('secret reference name is required')
  return Object.freeze({ name })
}

export interface ModelMessage {
  readonly role: ModelRole
  readonly content: string
  readonly toolCallId?: string
  readonly toolName?: string
  readonly toolCalls?: readonly ModelToolCall[]
}

export interface ModelToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

export interface ModelTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}

export interface ModelRequest {
  readonly model: string
  readonly messages: readonly ModelMessage[]
  readonly tools?: readonly ModelTool[]
  readonly capabilities?: readonly ModelCapability[]
  readonly stream?: boolean
}

export type ModelFinishReason = 'stop' | 'tool_call' | 'length' | 'error'

export type ModelResponseItem =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | {
      readonly type: 'tool_call'
      readonly id: string
      readonly name: string
      readonly arguments: unknown
    }

export interface ModelUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
}

export interface ModelResponse {
  readonly responseId: string
  readonly provider: string
  readonly model: string
  readonly items: readonly ModelResponseItem[]
  readonly finishReason: ModelFinishReason
  readonly usage?: ModelUsage
  readonly metadata?: Readonly<Record<string, string>>
}

export type ModelStreamEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'reasoning_delta'; readonly text: string }
  | {
      readonly type: 'tool_call_delta'
      readonly id: string
      readonly name: string
      readonly argumentsDelta: string
    }
  | { readonly type: 'completed'; readonly response: ModelResponse }
  | { readonly type: 'failed'; readonly error: ModelError }

export type ModelErrorCode =
  | 'invalid_request'
  | 'unsupported_capability'
  | 'provider_error'
  | 'invalid_response'
  | 'interrupted'

export class ModelError extends Error {
  readonly code: ModelErrorCode
  readonly retryable: boolean

  constructor(message: string, code: ModelErrorCode, retryable = false) {
    super(message)
    this.name = 'ModelError'
    this.code = code
    this.retryable = retryable
  }
}

export interface ModelAdapter {
  readonly provider: string
  readonly capabilities: readonly ModelCapability[]
  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>
}
