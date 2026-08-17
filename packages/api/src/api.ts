import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { AgentEvent } from '@ev-agent/durability'

export interface ChatApiSessionInput {
  readonly sessionId: string
  readonly agentDefinitionId: string
  readonly agentDefinitionVersion: string
  readonly agentDefinitionFingerprint: string
}

export interface ChatApiMessageInput {
  readonly sessionId: string
  readonly runId: string
  readonly message: string
}

export interface ChatApiApprovalInput {
  readonly approvalId: string
  readonly runId: string
  readonly decision: 'approved' | 'denied'
  readonly reason?: string
}

export interface ChatApiHandlers {
  readonly createSession: (input: ChatApiSessionInput) => unknown | Promise<unknown>
  readonly getSession: (sessionId: string) => unknown | Promise<unknown>
  readonly listSessionMessages: (sessionId: string) => unknown | Promise<unknown>
  readonly submitMessage: (input: ChatApiMessageInput) => unknown | Promise<unknown>
  readonly getRun: (runId: string) => unknown | Promise<unknown>
  readonly decideApproval: (input: ChatApiApprovalInput) => unknown | Promise<unknown>
  readonly listRunEvents: (runId: string) => readonly AgentEvent[] | Promise<readonly AgentEvent[]>
  readonly streamRunEvents?: (runId: string, afterSequence: number) => AsyncIterable<AgentEvent>
}

export interface ChatApiOptions {
  readonly handlers: ChatApiHandlers
  readonly logger?: boolean
}

export async function createChatApi(options: ChatApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false })

  app.post('/sessions', async (request, reply) => {
    const body = request.body as Partial<ChatApiSessionInput>
    if (!isNonEmptyString(body.sessionId) || !isNonEmptyString(body.agentDefinitionId)
      || !isNonEmptyString(body.agentDefinitionVersion) || !isNonEmptyString(body.agentDefinitionFingerprint)) {
      return reply.code(400).send({ error: 'invalid_session_request' })
    }
    try {
      const session = await options.handlers.createSession({
        sessionId: body.sessionId,
        agentDefinitionId: body.agentDefinitionId,
        agentDefinitionVersion: body.agentDefinitionVersion,
        agentDefinitionFingerprint: body.agentDefinitionFingerprint,
      })
      return reply.code(201).send(session)
    } catch (error) {
      return sendDomainError(reply, error)
    }
  })

  app.get('/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const session = await options.handlers.getSession(sessionId)
    if (session === undefined) return reply.code(404).send({ error: 'session_not_found' })
    return reply.send(session)
  })

  app.get('/sessions/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const messages = await options.handlers.listSessionMessages(sessionId)
    if (messages === undefined) return reply.code(404).send({ error: 'session_not_found' })
    return reply.send(messages)
  })

  app.post('/sessions/:sessionId/messages', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const body = request.body as Partial<Omit<ChatApiMessageInput, 'sessionId'>>
    if (!isNonEmptyString(body.runId) || !isNonEmptyString(body.message)) {
      return reply.code(400).send({ error: 'invalid_message_request' })
    }
    try {
      const result = await options.handlers.submitMessage({ sessionId, runId: body.runId, message: body.message })
      return reply.code(202).send(result)
    } catch (error) {
      return sendDomainError(reply, error)
    }
  })

  app.get('/runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string }
    const run = await options.handlers.getRun(runId)
    if (run === undefined) return reply.code(404).send({ error: 'run_not_found' })
    return reply.send(run)
  })

  app.post('/approvals/:approvalId', async (request, reply) => {
    const { approvalId } = request.params as { approvalId: string }
    const body = request.body as Partial<Omit<ChatApiApprovalInput, 'approvalId'>>
    if (!isNonEmptyString(body.runId) || (body.decision !== 'approved' && body.decision !== 'denied')) {
      return reply.code(400).send({ error: 'invalid_approval_request' })
    }
    try {
      const result = await options.handlers.decideApproval({
        approvalId,
        runId: body.runId,
        decision: body.decision,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      })
      return reply.send(result)
    } catch (error) {
      return sendDomainError(reply, error)
    }
  })

  app.get('/runs/:runId/events', async (request, reply) => {
    const { runId } = request.params as { runId: string }
    const query = request.query as { after?: string }
    const lastEventId = request.headers['last-event-id']
    const headerCursor = typeof lastEventId === 'string' && lastEventId.length > 0 ? Number(lastEventId) : undefined
    const queryCursor = query.after === undefined ? 0 : Number(query.after)
    const afterSequence = Math.max(queryCursor, headerCursor ?? 0)
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) return reply.code(400).send({ error: 'invalid_event_cursor' })
    const stream = options.handlers.streamRunEvents?.(runId, afterSequence)
    if (stream === undefined) {
      const events = await options.handlers.listRunEvents(runId)
      if (events.length === 0) return reply.code(404).send({ error: 'run_not_found' })
      reply.hijack()
      reply.raw.statusCode = 200
      reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
      reply.raw.setHeader('cache-control', 'no-cache')
      reply.raw.setHeader('connection', 'keep-alive')
      for (const event of events) {
        if (event.sequence > afterSequence) writeEvent(reply, event)
      }
      reply.raw.end()
      return
    }
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done) return reply.code(404).send({ error: 'run_not_found' })
    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache')
    reply.raw.setHeader('connection', 'keep-alive')
    writeEvent(reply, first.value)
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) writeEvent(reply, event)
    reply.raw.end()
  })

  return app
}

function writeEvent(reply: FastifyReply, event: AgentEvent): void {
  reply.raw.write(`id: ${event.sequence}\n`)
  reply.raw.write(`event: ${event.type}\n`)
  reply.raw.write(`data: ${JSON.stringify({
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    payloadStatus: event.payloadStatus,
    payload: event.payload,
  })}\n\n`)
}

function sendDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : 'request_failed'
  const statusCode = /not found/i.test(message) ? 404 : /different|conflict|mismatch/i.test(message) ? 409 : 422
  return reply.code(statusCode).send({ error: message })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
