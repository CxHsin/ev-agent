import type { CompositionDefinition } from '@ev-agent/composition'
import { ConversationalRunService, type PermissionPolicy, type ToolRegistry } from '@ev-agent/execution'
import type { ModelAdapter } from '@ev-agent/model'
import { SessionService, type AgentDefinitionRef } from '@ev-agent/session'
import type { EvidenceBundle } from '@ev-agent/personal-context'
import { createChatApi, type ChatApiHandlers } from './api.js'

export interface SessionChatRuntimeOptions {
  readonly databasePath: string
  readonly sessionService: SessionService
  readonly agentDefinition: AgentDefinitionRef
  readonly composition: CompositionDefinition
  readonly model: ModelAdapter | (() => ModelAdapter)
  readonly modelName: string
  readonly tools: ToolRegistry | (() => ToolRegistry)
  readonly permissionPolicy?: PermissionPolicy | (() => PermissionPolicy)
  readonly evidenceBundle?: EvidenceBundle | ((input: { readonly sessionId: string; readonly runId: string }) => EvidenceBundle | undefined)
}

export function createSessionChatHandlers(options: SessionChatRuntimeOptions): ChatApiHandlers {
  const model = (): ModelAdapter => typeof options.model === 'function' ? options.model() : options.model
  const tools = (): ToolRegistry => typeof options.tools === 'function' ? options.tools() : options.tools
  const policy = (): PermissionPolicy | undefined => {
    if (options.permissionPolicy === undefined) return undefined
    return typeof options.permissionPolicy === 'function' ? options.permissionPolicy() : options.permissionPolicy
  }
  const evidence = (sessionId: string, runId: string): EvidenceBundle | undefined => {
    if (options.evidenceBundle === undefined) return undefined
    return typeof options.evidenceBundle === 'function' ? options.evidenceBundle({ sessionId, runId }) : options.evidenceBundle
  }

  return {
    createSession: (input) => options.sessionService.create({
      sessionId: input.sessionId,
      id: input.agentDefinitionId,
      version: input.agentDefinitionVersion,
      fingerprint: input.agentDefinitionFingerprint,
    }),
    getSession: (sessionId) => options.sessionService.get(sessionId),
    listSessionMessages: (sessionId) => options.sessionService.get(sessionId) === undefined
      ? undefined
      : options.sessionService.listMessages(sessionId),
    submitMessage: async (input) => {
      const permissionPolicy = policy()
      const bundle = evidence(input.sessionId, input.runId)
      return options.sessionService.runMessage({
        sessionId: input.sessionId,
        runId: input.runId,
        message: input.message,
        agentDefinition: options.agentDefinition,
        composition: options.composition,
        model: model(),
        modelName: options.modelName,
        tools: tools(),
        ...(permissionPolicy === undefined ? {} : { permissionPolicy }),
        ...(bundle === undefined ? {} : { evidenceBundle: bundle }),
      })
    },
    getRun: async (runId) => {
      const runtime = new ConversationalRunService({ databasePath: options.databasePath })
      try {
        if (runtime.listEvents(runId).length === 0) return undefined
        const summary = runtime.replay(runId)
        return {
          runId,
          status: summary.status === 'completed' ? 'completed' : summary.status === 'failed' ? 'failed' : 'resumable',
          summary,
        }
      } finally {
        await runtime.close()
      }
    },
    decideApproval: async (input) => {
      const session = options.sessionService.getForRun(input.runId)
      if (session === undefined) throw new Error(`run "${input.runId}" was not found`)
      options.sessionService.assertDefinition(session.sessionId, options.agentDefinition)
      const runtime = new ConversationalRunService({ databasePath: options.databasePath })
      try {
        const permissionPolicy = policy()
        const bundle = evidence(session.sessionId, input.runId)
        const result = await runtime.decide({
          sessionId: session.sessionId,
          runId: input.runId,
          approvalId: input.approvalId,
          decision: input.decision,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          composition: options.composition,
          model: model(),
          modelName: options.modelName,
          messages: options.sessionService.modelMessages(session.sessionId),
          tools: tools(),
          ...(permissionPolicy === undefined ? {} : { permissionPolicy }),
          ...(bundle === undefined ? {} : { evidenceBundle: bundle }),
        })
        if (result.status === 'completed') options.sessionService.recordAssistantResponse(session.sessionId, input.runId, result.summary.response)
        return result
      } finally {
        await runtime.close()
      }
    },
    listRunEvents: async (runId) => {
      const runtime = new ConversationalRunService({ databasePath: options.databasePath })
      try {
        return runtime.listEvents(runId)
      } finally {
        await runtime.close()
      }
    },
    streamRunEvents: async function* (runId, afterSequence) {
      const runtime = new ConversationalRunService({ databasePath: options.databasePath })
      let cursor = afterSequence
      const deadline = Date.now() + 30_000
      try {
        while (Date.now() < deadline) {
          const events = runtime.listEvents(runId)
          if (events.length === 0) return
          for (const event of events) {
            if (event.sequence > cursor) {
              cursor = event.sequence
              yield event
            }
          }
          const last = events[events.length - 1]
          if (last?.type === 'conversation.completed' || last?.type === 'conversation.failed') return
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      } finally {
        await runtime.close()
      }
    },
  }
}

export async function createSessionChatApi(options: SessionChatRuntimeOptions) {
  return createChatApi({ handlers: createSessionChatHandlers(options) })
}
