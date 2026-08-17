import {
  DurabilityStore,
  type DurableSession,
  type DurableSessionMessage,
} from '@ev-agent/durability'
import type { CompositionDefinition } from '@ev-agent/composition'
import {
  ConversationalRunService,
  type ConversationalExecutionBudget,
  type ConversationalRunResult,
} from '@ev-agent/execution'
import type { ModelAdapter, ModelMessage } from '@ev-agent/model'
import type { PermissionPolicy, ToolRegistry } from '@ev-agent/execution'
import type { EvidenceBundle } from '@ev-agent/personal-context'

export interface AgentDefinitionRef {
  readonly id: string
  readonly version: string
  readonly fingerprint: string
}

export interface SessionServiceOptions {
  readonly databasePath: string
  readonly now?: () => number
}

export interface CreateSessionInput extends AgentDefinitionRef {
  readonly sessionId: string
}

export interface SessionMessageRunInput {
  readonly sessionId: string
  readonly runId: string
  readonly message: string
  readonly agentDefinition: AgentDefinitionRef
  readonly composition: CompositionDefinition
  readonly model: ModelAdapter
  readonly modelName: string
  readonly tools: ToolRegistry
  readonly permissionPolicy?: PermissionPolicy
  readonly evidenceBundle?: EvidenceBundle
  readonly budget?: ConversationalExecutionBudget
}

export class SessionDefinitionMismatchError extends Error {
  constructor(sessionId: string) {
    super(`session "${sessionId}" is bound to a different Agent Definition version`)
    this.name = 'SessionDefinitionMismatchError'
  }
}

export class SessionService {
  private readonly store: DurabilityStore
  private readonly now: () => number

  constructor(options: SessionServiceOptions) {
    this.store = new DurabilityStore(options.databasePath)
    this.databasePath = options.databasePath
    this.now = options.now ?? (() => Date.now())
  }

  create(input: CreateSessionInput): DurableSession {
    return this.store.createSession({
      sessionId: input.sessionId,
      agentDefinitionId: input.id,
      agentDefinitionVersion: input.version,
      agentDefinitionFingerprint: input.fingerprint,
      createdAt: this.now(),
    })
  }

  get(sessionId: string): DurableSession | undefined {
    return this.store.getSession(sessionId)
  }

  getForRun(runId: string): DurableSession | undefined {
    return this.store.getSessionForRun(runId)
  }

  listMessages(sessionId: string): readonly DurableSessionMessage[] {
    return this.store.listSessionMessages(sessionId)
  }

  eraseMessage(sessionId: string, messageId: string): void {
    const message = this.listMessages(sessionId).find((value) => value.messageId === messageId)
    if (message === undefined) throw new Error(`session message "${messageId}" was not found`)
    for (const event of this.store.listEvents(message.runId)) this.store.eraseEventPayload(event.eventId)
    this.store.eraseSessionMessage(messageId)
  }

  modelMessages(sessionId: string): readonly ModelMessage[] {
    return this.toModelMessages(sessionId)
  }

  recordAssistantResponse(sessionId: string, runId: string, response: string): void {
    if (response.length === 0) return
    this.store.appendSessionMessageForCompletedRun({
      messageId: `${runId}:session:assistant`,
      sessionId,
      runId,
      role: 'assistant',
      content: response,
      createdAt: this.now(),
    })
  }

  assertDefinition(sessionId: string, definition: AgentDefinitionRef): DurableSession {
    const session = this.store.getSession(sessionId)
    if (session === undefined) throw new Error(`session "${sessionId}" was not found`)
    if (session.agentDefinitionId !== definition.id
      || session.agentDefinitionVersion !== definition.version
      || session.agentDefinitionFingerprint !== definition.fingerprint) {
      throw new SessionDefinitionMismatchError(sessionId)
    }
    return session
  }

  async runMessage(input: SessionMessageRunInput): Promise<ConversationalRunResult> {
    const session = this.assertDefinition(input.sessionId, input.agentDefinition)
    const userMessageId = `${input.runId}:session:user`
      this.store.appendSessionMessage({
      messageId: userMessageId,
      sessionId: input.sessionId,
      runId: input.runId,
      role: 'user',
      content: input.message,
      createdAt: this.now(),
    })
    const runtime = new ConversationalRunService({ databasePath: this.databasePath })
    try {
      const result = await runtime.start({
        sessionId: input.sessionId,
        runId: input.runId,
        composition: input.composition,
        model: input.model,
        modelName: input.modelName,
        messages: this.toModelMessages(input.sessionId),
        tools: input.tools,
        ...(input.permissionPolicy === undefined ? {} : { permissionPolicy: input.permissionPolicy }),
        ...(input.evidenceBundle === undefined ? {} : { evidenceBundle: input.evidenceBundle }),
        ...(input.budget === undefined ? {} : { budget: input.budget }),
      })
      if (result.status === 'completed' && result.summary.response.length > 0) {
        this.recordAssistantResponse(input.sessionId, input.runId, result.summary.response)
      }
      return result
    } finally {
      await runtime.close()
    }
  }

  close(): void {
    this.store.close()
  }

  private readonly databasePath: string

  private toModelMessages(sessionId: string): readonly ModelMessage[] {
    return this.store.listSessionMessages(sessionId).map((message) => ({ role: message.role, content: message.content }))
  }
}
