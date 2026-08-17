import { describe, expect, it } from 'vitest'
import { reduceRunEvent, type ChatSurfaceState } from './state.js'

const state: ChatSurfaceState = { messages: [], events: [], streaming: true }

describe('Chat Surface state', () => {
  it('shows an approval exactly once and clears it after the decision event', () => {
    const requested = reduceRunEvent(state, {
      eventId: 'approval-1', runId: 'run-1', sequence: 1, type: 'conversation.approval.requested', occurredAt: 1, payloadStatus: 'present',
      payload: { approvalId: 'approval-1', name: 'send_message', reason: 'external_effect_requires_approval', arguments: { text: 'hi' } },
    })
    const duplicate = reduceRunEvent(requested, requested.events[0]!)
    const decided = reduceRunEvent(duplicate, {
      eventId: 'approval-2', runId: 'run-1', sequence: 2, type: 'conversation.approval.decided', occurredAt: 2, payloadStatus: 'present', payload: { decision: 'approved' },
    })

    expect(requested.pendingApproval).toMatchObject({ approvalId: 'approval-1' })
    expect(duplicate.events).toHaveLength(1)
    expect(decided.pendingApproval).toBeUndefined()
  })

  it('renders streamed text once and clears it at terminal completion', () => {
    const streamed = reduceRunEvent(state, {
      eventId: 'delta-1', runId: 'run-1', sequence: 1, type: 'conversation.model.text.delta', occurredAt: 1, payloadStatus: 'present', payload: { text: 'Hello' },
    })
    const duplicate = reduceRunEvent(streamed, streamed.events[0]!)
    const completed = reduceRunEvent(duplicate, {
      eventId: 'done-1', runId: 'run-1', sequence: 2, type: 'conversation.completed', occurredAt: 2, payloadStatus: 'present', payload: { response: 'Hello' },
    })

    expect(streamed.streamingText).toBe('Hello')
    expect(duplicate.events).toHaveLength(1)
    expect(completed.streamingText).toBeUndefined()
  })
})
