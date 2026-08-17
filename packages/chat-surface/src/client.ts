export interface ChatSession {
  readonly sessionId: string
  readonly agentDefinitionId: string
  readonly agentDefinitionVersion: string
  readonly agentDefinitionFingerprint: string
}

export interface ChatMessage {
  readonly messageId: string
  readonly runId: string
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly sequence: number
}

export interface ChatRun {
  readonly runId: string
  readonly status: 'completed' | 'failed' | 'resumable'
  readonly summary: {
    readonly response: string
    readonly error?: string
    readonly pendingApproval?: {
      readonly approvalId: string
      readonly name: string
      readonly reason: string
      readonly arguments: unknown
    }
  }
}

export interface RunEvent {
  readonly eventId: string
  readonly runId: string
  readonly sequence: number
  readonly type: string
  readonly occurredAt: number
  readonly payloadStatus: 'present' | 'missing' | 'erased'
  readonly payload?: unknown
}

export interface ChatApiClient {
  createSession(input: Omit<ChatSession, 'sessionId'> & { sessionId: string }): Promise<ChatSession>
  getSession(sessionId: string): Promise<ChatSession>
  listMessages(sessionId: string): Promise<readonly ChatMessage[]>
  sendMessage(sessionId: string, runId: string, message: string): Promise<ChatRun>
  decideApproval(approvalId: string, input: { runId: string; decision: 'approved' | 'denied'; reason?: string }): Promise<ChatRun>
  subscribeRun(runId: string, afterSequence: number, listener: (event: RunEvent) => void, onError: (error: unknown) => void, onOpen?: () => void): () => void
}

export class HttpChatApiClient implements ChatApiClient {
  private readonly baseUrl: string

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async createSession(input: Omit<ChatSession, 'sessionId'> & { sessionId: string }): Promise<ChatSession> {
    return this.request<ChatSession>('/sessions', { method: 'POST', body: JSON.stringify(input) })
  }

  getSession(sessionId: string): Promise<ChatSession> {
    return this.request<ChatSession>(`/sessions/${encodeURIComponent(sessionId)}`)
  }

  listMessages(sessionId: string): Promise<readonly ChatMessage[]> {
    return this.request<readonly ChatMessage[]>(`/sessions/${encodeURIComponent(sessionId)}/messages`)
  }

  sendMessage(sessionId: string, runId: string, message: string): Promise<ChatRun> {
    return this.request<ChatRun>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ runId, message }),
    })
  }

  decideApproval(approvalId: string, input: { runId: string; decision: 'approved' | 'denied'; reason?: string }): Promise<ChatRun> {
    return this.request<ChatRun>(`/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  subscribeRun(runId: string, afterSequence: number, listener: (event: RunEvent) => void, onError: (error: unknown) => void, onOpen?: () => void): () => void {
    const source = new EventSource(`${this.baseUrl}/runs/${encodeURIComponent(runId)}/events?after=${afterSequence}`)
    const handler = (message: MessageEvent<string>): void => {
      try {
        const event = JSON.parse(message.data) as RunEvent
        listener(event)
        if (event.type === 'conversation.completed' || event.type === 'conversation.failed') source.close()
      } catch (error) {
        onError(error)
      }
    }
    source.onmessage = handler
    const eventTypes = ['conversation.started', 'conversation.model.text.delta', 'conversation.model.reasoning.delta', 'conversation.model.completed', 'conversation.tool.called', 'conversation.tool.completed', 'conversation.tool.failed', 'conversation.tool.denied', 'conversation.approval.requested', 'conversation.approval.decided', 'conversation.budget_exhausted', 'conversation.interrupted', 'conversation.evidence.attached', 'conversation.completed', 'conversation.failed']
    for (const type of eventTypes) source.addEventListener(type, handler as EventListener)
    source.onopen = () => onOpen?.()
    source.onerror = (error) => {
      if (source.readyState !== EventSource.CLOSED) onError(error)
    }
    return () => source.close()
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
    const raw = await response.text()
    let body: unknown
    try {
      body = JSON.parse(raw) as unknown
    } catch {
      throw new Error('Chat service unavailable')
    }
    if (!response.ok) throw new Error(typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : `request_failed:${response.status}`)
    return body as T
  }
}
