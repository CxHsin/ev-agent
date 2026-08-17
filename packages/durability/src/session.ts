export type SessionMessageRole = 'user' | 'assistant' | 'tool'

export interface StoreSessionInput {
  readonly sessionId: string
  readonly agentDefinitionId: string
  readonly agentDefinitionVersion: string
  readonly agentDefinitionFingerprint: string
  readonly createdAt: number
}

export interface DurableSession {
  readonly sessionId: string
  readonly agentDefinitionId: string
  readonly agentDefinitionVersion: string
  readonly agentDefinitionFingerprint: string
  readonly createdAt: number
}

export interface StoreSessionMessageInput {
  readonly messageId: string
  readonly sessionId: string
  readonly runId: string
  readonly role: SessionMessageRole
  readonly content: string
  readonly createdAt: number
}

export interface DurableSessionMessage {
  readonly messageId: string
  readonly sessionId: string
  readonly runId: string
  readonly sequence: number
  readonly role: SessionMessageRole
  readonly content: string
  readonly createdAt: number
}
