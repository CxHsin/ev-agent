import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { ChatApiClient, ChatMessage, ChatSession, RunEvent } from './client.js'
import { appendMessage, reduceRunEvent, type ChatSurfaceState } from './state.js'
import './styles.css'

export interface ChatSurfaceProps {
  readonly client: ChatApiClient
  readonly session: ChatSession
}

const EMPTY_STATE: ChatSurfaceState = { messages: [], events: [], streaming: false }

export function ChatSurface({ client, session }: ChatSurfaceProps): ReactElement {
  const [state, setState] = useState<ChatSurfaceState>(EMPTY_STATE)
  const [draft, setDraft] = useState('')
  const [activeRunId, setActiveRunId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setState(EMPTY_STATE)
    setLoading(true)
    void client.listMessages(session.sessionId).then((messages) => {
      if (alive) {
        setState((current) => ({ ...current, messages }))
        setLoading(false)
      }
    }).catch((error: unknown) => {
      if (alive) {
        setState((current) => ({ ...current, error: errorMessage(error) }))
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [client, session.sessionId])

  useEffect(() => {
    if (loading) return undefined
    const runIds = [...new Set(state.messages.map((message) => message.runId))]
    const cleanups = runIds.map((runId) => client.subscribeRun(runId, 0, (event) => {
      setState((current) => reduceRunEvent(current, event))
    }, () => undefined))
    return () => { for (const cleanup of cleanups) cleanup() }
  }, [client, loading])

  useEffect(() => {
    if (activeRunId === undefined) return undefined
    const after = state.events.filter((event) => event.runId === activeRunId).reduce((max, event) => Math.max(max, event.sequence), 0)
    return client.subscribeRun(activeRunId, after, (event) => {
      setState((current) => reduceRunEvent({ ...current, streaming: true }, event))
    }, (error) => setState((current) => ({ ...current, reconnecting: true, error: `Connection interrupted; reconnecting (${errorMessage(error)})` })), () => setState((current) => ({ ...current, reconnecting: false })))
  }, [activeRunId, client])

  const lastActivity = useMemo(() => state.events.slice(-5).reverse(), [state.events])
  const submit = async (): Promise<void> => {
    const message = draft.trim()
    if (message.length === 0 || state.streaming) return
    setDraft('')
    const runId = `run:${session.sessionId}:${Date.now()}`
    const userMessage: ChatMessage = { messageId: `${runId}:user`, runId, role: 'user', content: message, sequence: state.messages.length + 1 }
    setState((current) => {
      const { error: _error, ...withoutError } = appendMessage(current, userMessage)
      return { ...withoutError, streaming: true }
    })
    setActiveRunId(runId)
    try {
      const result = await client.sendMessage(session.sessionId, runId, message)
      if (result.status === 'completed' && result.summary.response.length > 0) {
        setState((current) => appendMessage({ ...current, streaming: false }, {
          messageId: `${runId}:assistant`, runId, role: 'assistant', content: result.summary.response, sequence: userMessage.sequence + 1,
        }))
      }
    } catch (error) {
      setState((current) => ({ ...current, streaming: false, error: errorMessage(error) }))
    }
  }

  const decide = async (decision: 'approved' | 'denied'): Promise<void> => {
    const approval = state.pendingApproval
    if (!approval) return
    try {
      const result = await client.decideApproval(approval.approvalId, { runId: approval.runId, decision })
      if (result.status === 'completed' && result.summary.response.length > 0) {
        setState((current) => appendMessage({ ...current, streaming: false }, {
          messageId: `${approval.runId}:assistant`, runId: approval.runId, role: 'assistant', content: result.summary.response, sequence: current.messages.length + 1,
        }))
      }
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error) }))
    }
  }

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div>
          <p className="eyebrow">PERSONAL AGENT HARNESS</p>
          <h1>Chat</h1>
        </div>
        <div className="session-meta" aria-label="Session details">
          <span>{session.agentDefinitionId}</span>
          <span>v{session.agentDefinitionVersion}</span>
           <span className={state.streaming || state.reconnecting ? 'status-dot live' : 'status-dot'}>{state.reconnecting ? 'Reconnecting' : state.streaming ? 'Running' : 'Ready'}</span>
        </div>
      </header>

      <div className="chat-layout">
        <section className="conversation-pane" aria-label="Conversation">
          <div className="message-list" aria-live="polite">
            {loading && <p className="empty-state">Loading Session history...</p>}
            {!loading && state.messages.length === 0 && <p className="empty-state">Start with a question or a task.</p>}
            {state.messages.map((message) => <Message key={message.messageId} message={message} />)}
            {state.streamingText && <article className="message assistant streaming-message"><div className="message-label">Agent</div><p>{state.streamingText}</p></article>}
            {state.streaming && <div className="typing-indicator" aria-label="Agent is working"><span /><span /><span /></div>}
          </div>

          {state.pendingApproval && (
            <section className="approval-panel" aria-label="Approval required">
              <div>
                <p className="eyebrow warm">APPROVAL REQUIRED</p>
                <h2>{state.pendingApproval.name}</h2>
                <p>{state.pendingApproval.reason}</p>
                <code>{formatArguments(state.pendingApproval.arguments)}</code>
              </div>
              <div className="approval-actions">
                <button className="button secondary" type="button" onClick={() => void decide('denied')}>Deny</button>
                <button className="button primary" type="button" onClick={() => void decide('approved')}>Approve</button>
              </div>
            </section>
          )}

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <label htmlFor="message">Message</label>
            <textarea id="message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask the Agent to inspect, explain, or act..." rows={2} disabled={state.streaming} />
            <div className="composer-footer">
              <span>{state.error ?? 'Responses and approvals are recorded in the Run history.'}</span>
              <button className="button primary send-button" type="submit" disabled={state.streaming || draft.trim().length === 0}>Send <span aria-hidden="true">↗</span></button>
            </div>
          </form>
        </section>

        <aside className="activity-pane" aria-label="Run activity">
          <div className="activity-heading"><div><p className="eyebrow">TRACE</p><h2>Run activity</h2></div><span className="event-count">{state.events.length}</span></div>
          {lastActivity.length === 0 ? <p className="muted">Events will appear here as the Agent works.</p> : <ol className="activity-list">{lastActivity.map((event) => <Activity key={event.eventId} event={event} />)}</ol>}
           <div className="evidence-note"><span className="evidence-mark" aria-hidden="true">⌁</span><div><strong>Evidence stays attached</strong><p>Responses can point back to claims and source events.</p></div></div>
           {state.evidenceBundle && <div className="evidence-list"><p className="eyebrow">EVIDENCE</p><ul>{state.evidenceBundle.items.map((item) => <li key={item.itemId}><strong>{item.referenceType}:{item.referenceId}</strong><span>{item.source}</span><span>{item.applicability} · confidence {item.confidence.toFixed(2)}</span></li>)}</ul></div>}
        </aside>
      </div>
    </main>
  )
}

function Message({ message }: { readonly message: ChatMessage }): ReactElement {
  return <article className={`message ${message.role}`}><div className="message-label">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : 'Tool'}</div><p>{message.content}</p></article>
}

function Activity({ event }: { readonly event: RunEvent }): ReactElement {
  const label = event.type.replace('conversation.', '').replaceAll('.', ' ')
  return <li><span className="activity-sequence">{event.sequence.toString().padStart(2, '0')}</span><span>{label}</span></li>
}

function formatArguments(value: unknown): string {
  try { return JSON.stringify(value) }
  catch { return '[unavailable]' }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
