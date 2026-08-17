/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatSurface } from './ChatSurface.js'
import type { ChatApiClient, ChatSession, RunEvent } from './client.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session: ChatSession = {
  sessionId: 'session-1', agentDefinitionId: 'agent', agentDefinitionVersion: '1.0.0', agentDefinitionFingerprint: 'fp-1',
}

describe('ChatSurface DOM workflow', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
    container?.remove()
    root = undefined
    container = undefined
  })

  it('submits a message, renders approval, and shows the terminal response', async () => {
    let runListener: ((event: RunEvent) => void) | undefined
    let activeRunId = ''
    const client: ChatApiClient = {
      createSession: vi.fn(),
      getSession: vi.fn(async () => session),
      listMessages: vi.fn(async () => []),
      sendMessage: vi.fn(async () => ({
        runId: 'run-1', status: 'resumable' as const,
        summary: { response: '', pendingApproval: { approvalId: 'approval-1', name: 'send_message', reason: 'approval required', arguments: { text: 'hello' } } },
      })),
      decideApproval: vi.fn(async () => ({ runId: 'run-1', status: 'completed' as const, summary: { response: 'Done.' } })),
      subscribeRun: vi.fn((runId, _after, listener, _onError, onOpen) => {
        activeRunId = runId
        runListener = listener
        onOpen?.()
        return () => { runListener = undefined }
      }),
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ChatSurface client={client} session={session} />)
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Start with a question or a task.')

    const textarea = container.querySelector('textarea')
    if (!textarea) throw new Error('message input was not rendered')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Send hello')
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Send hello' }))
      await Promise.resolve()
    })
    const form = container.querySelector('form')
    if (!form) throw new Error('composer was not rendered')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(client.sendMessage).toHaveBeenCalledOnce()
    await act(async () => {
      runListener?.({
        eventId: 'approval-1', runId: activeRunId, sequence: 1, type: 'conversation.approval.requested', occurredAt: 1,
        payloadStatus: 'present', payload: { approvalId: 'approval-1', name: 'send_message', reason: 'approval required', arguments: { text: 'hello' } },
      })
      await Promise.resolve()
    })
    expect(container.textContent).toContain('APPROVAL REQUIRED')
    expect(container.textContent).toContain('send_message')

    const approve = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Approve'))
    if (!approve) throw new Error('approval button was not rendered')
    await act(async () => {
      approve.click()
      await Promise.resolve()
      runListener?.({ eventId: 'approval-2', runId: activeRunId, sequence: 2, type: 'conversation.approval.decided', occurredAt: 2, payloadStatus: 'present', payload: { decision: 'approved' } })
      runListener?.({ eventId: 'done-1', runId: activeRunId, sequence: 3, type: 'conversation.completed', occurredAt: 3, payloadStatus: 'present', payload: { response: 'Done.' } })
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(client.decideApproval).toHaveBeenCalledWith('approval-1', { runId: activeRunId, decision: 'approved' })
    expect(container.textContent).toContain('Done.')
    expect(container.textContent).not.toContain('APPROVAL REQUIRED')
  })
})
