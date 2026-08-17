import type { ChatMessage, RunEvent } from './client.js'

export interface ChatSurfaceState {
  readonly messages: readonly ChatMessage[]
  readonly events: readonly RunEvent[]
  readonly pendingApproval?: {
    readonly approvalId: string
    readonly runId: string
    readonly name: string
    readonly reason: string
    readonly arguments: unknown
  }
  readonly evidenceBundle?: {
    readonly bundleId: string
    readonly runId: string
    readonly items: readonly {
      readonly itemId: string
      readonly referenceType: 'claim' | 'event'
      readonly referenceId: string
      readonly source: string
      readonly applicability: string
      readonly confidence: number
    }[]
  }
  readonly streaming: boolean
  readonly reconnecting?: boolean
  readonly streamingText?: string
  readonly error?: string
}

export function reduceRunEvent(state: ChatSurfaceState, event: RunEvent): ChatSurfaceState {
  if (state.events.some((value) => value.eventId === event.eventId)) return state
  const events = [...state.events, event]
  const payload = event.payload as Record<string, unknown> | undefined
  if (event.type === 'conversation.model.text.delta' && typeof payload?.text === 'string') {
    return { ...state, events, streamingText: `${state.streamingText ?? ''}${payload.text}` }
  }
  if (event.type === 'conversation.approval.requested' && payload !== undefined) {
    return {
      ...state,
      events,
      pendingApproval: {
        approvalId: typeof payload.approvalId === 'string' ? payload.approvalId : 'unknown',
        runId: event.runId,
        name: typeof payload.name === 'string' ? payload.name : 'tool',
        reason: typeof payload.reason === 'string' ? payload.reason : 'Approval required',
        arguments: payload.arguments,
      },
    }
  }
  if (event.type === 'conversation.approval.decided') return clearApproval({ ...state, events })
  if (event.type === 'conversation.evidence.attached' && payload?.bundle !== undefined) {
    return { ...state, events, evidenceBundle: payload.bundle as NonNullable<ChatSurfaceState['evidenceBundle']> }
  }
  if (event.type === 'conversation.interrupted') {
    return { ...state, events, streaming: false, reconnecting: false, error: stringValue(payload?.reason) ?? 'Run interrupted' }
  }
  if (event.type === 'conversation.completed' || event.type === 'conversation.failed') {
    const { streamingText: _streamingText, ...withoutStreamingText } = state
    const next = { ...withoutStreamingText, events, streaming: false }
    return event.type === 'conversation.failed'
      ? { ...next, error: stringValue(payload?.error) ?? 'Run failed' }
      : clearError(next)
  }
  return { ...state, events }
}

function clearApproval(state: ChatSurfaceState): ChatSurfaceState {
  const { pendingApproval: _pendingApproval, ...withoutApproval } = state
  return withoutApproval
}

function clearError(state: ChatSurfaceState): ChatSurfaceState {
  const { error: _error, ...withoutError } = state
  return withoutError
}

export function appendMessage(state: ChatSurfaceState, message: ChatMessage): ChatSurfaceState {
  if (state.messages.some((value) => value.messageId === message.messageId)) return state
  return { ...state, messages: [...state.messages, message] }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
