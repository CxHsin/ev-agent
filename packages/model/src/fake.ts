import {
  ModelError,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
  type ModelResponseItem,
  type ModelStreamEvent,
  type ModelUsage,
} from './model.js'

export interface FakeModelStep {
  readonly responseId?: string
  readonly items?: readonly ModelResponseItem[]
  readonly finishReason?: ModelResponse['finishReason']
  readonly usage?: ModelUsage
  readonly error?: string
  readonly interrupt?: string
}

export class DeterministicFakeModel implements ModelAdapter {
  readonly provider = 'fake'
  readonly capabilities = ['text', 'reasoning', 'tool_calls', 'streaming'] as const
  private cursor = 0

  constructor(private readonly script: readonly FakeModelStep[]) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    return Promise.resolve(this.nextResponse(request))
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = this.nextResponse(request)
    for (const item of response.items) {
      if (item.type === 'text') yield { type: 'text_delta', text: item.text }
      if (item.type === 'reasoning') yield { type: 'reasoning_delta', text: item.text }
      if (item.type === 'tool_call') {
        yield {
          type: 'tool_call_delta',
          id: item.id,
          name: item.name,
          argumentsDelta: JSON.stringify(item.arguments),
        }
      }
    }
    yield { type: 'completed', response }
  }

  reset(): void {
    this.cursor = 0
  }

  private nextResponse(request: ModelRequest): ModelResponse {
    const index = this.cursor
    const step = this.script[this.cursor++]
    if (!step) throw new ModelError('fake model script is exhausted', 'provider_error')
    if (step.error !== undefined) throw new ModelError(step.error, 'provider_error')
    if (step.interrupt !== undefined) throw new ModelError(step.interrupt, 'interrupted', true)

    const response: ModelResponse = {
      responseId: step.responseId ?? `fake:${index}`,
      provider: this.provider,
      model: request.model,
      items: step.items ?? [],
      finishReason: step.finishReason ?? (step.items?.some((item) => item.type === 'tool_call') ? 'tool_call' : 'stop'),
      ...(step.usage === undefined ? {} : { usage: step.usage }),
    }
    return response
  }
}
