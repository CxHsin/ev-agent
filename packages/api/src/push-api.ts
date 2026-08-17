import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import type { DurablePushSubscription, DurablePushSubscriptionCandidate } from '@ev-agent/durability'

export interface PushApiHandlers {
  readonly proposeCandidate: (input: { readonly candidateId: string; readonly userScopeId: string; readonly requestText: string }) => DurablePushSubscriptionCandidate | Promise<DurablePushSubscriptionCandidate>
  readonly getCandidate: (candidateId: string) => DurablePushSubscriptionCandidate | undefined | Promise<DurablePushSubscriptionCandidate | undefined>
  readonly confirmCandidate: (input: { readonly candidateId: string; readonly subscriptionId: string; readonly revision: number; readonly scopeFingerprint: string }) => DurablePushSubscription | Promise<DurablePushSubscription>
  readonly rejectCandidate: (candidateId: string, reason: string) => DurablePushSubscriptionCandidate | Promise<DurablePushSubscriptionCandidate>
  readonly getSubscription: (subscriptionId: string) => DurablePushSubscription | undefined | Promise<DurablePushSubscription | undefined>
  readonly setSubscriptionStatus: (subscriptionId: string, status: 'paused' | 'active' | 'revoked') => DurablePushSubscription | Promise<DurablePushSubscription>
}

export async function createPushApi(handlers: PushApiHandlers): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.post('/push/candidates', async (request, reply) => {
    const body = request.body as Partial<{ candidateId: string; userScopeId: string; requestText: string }>
    if (!isNonEmptyString(body.candidateId) || !isNonEmptyString(body.userScopeId) || !isNonEmptyString(body.requestText)) {
      return reply.code(400).send({ error: 'invalid_push_candidate_request' })
    }
    try {
      return reply.code(201).send(await handlers.proposeCandidate({ candidateId: body.candidateId, userScopeId: body.userScopeId, requestText: body.requestText }))
    } catch (error) {
      return sendPushError(reply, error)
    }
  })

  app.get('/push/candidates/:candidateId', async (request, reply) => {
    const { candidateId } = request.params as { candidateId: string }
    const candidate = await handlers.getCandidate(candidateId)
    return candidate === undefined ? reply.code(404).send({ error: 'push_candidate_not_found' }) : reply.send(candidate)
  })

  app.post('/push/candidates/:candidateId/confirm', async (request, reply) => {
    const { candidateId } = request.params as { candidateId: string }
    const body = request.body as Partial<{ subscriptionId: string; revision: number; scopeFingerprint: string }>
    const revision = body.revision
    if (!isNonEmptyString(body.subscriptionId) || !isPositiveInteger(revision) || !isNonEmptyString(body.scopeFingerprint)) {
      return reply.code(400).send({ error: 'invalid_push_confirmation_request' })
    }
    try {
      return reply.code(201).send(await handlers.confirmCandidate({ candidateId, subscriptionId: body.subscriptionId, revision, scopeFingerprint: body.scopeFingerprint }))
    } catch (error) {
      return sendPushError(reply, error)
    }
  })

  app.post('/push/candidates/:candidateId/reject', async (request, reply) => {
    const { candidateId } = request.params as { candidateId: string }
    const body = request.body as Partial<{ reason: string }>
    if (!isNonEmptyString(body.reason)) return reply.code(400).send({ error: 'invalid_push_rejection_request' })
    try {
      return reply.send(await handlers.rejectCandidate(candidateId, body.reason))
    } catch (error) {
      return sendPushError(reply, error)
    }
  })

  app.get('/push/subscriptions/:subscriptionId', async (request, reply) => {
    const { subscriptionId } = request.params as { subscriptionId: string }
    const subscription = await handlers.getSubscription(subscriptionId)
    return subscription === undefined ? reply.code(404).send({ error: 'push_subscription_not_found' }) : reply.send(subscription)
  })

  for (const status of ['paused', 'active', 'revoked'] as const) {
    app.post(`/push/subscriptions/:subscriptionId/${status === 'active' ? 'resume' : status}`, async (request, reply) => {
      const { subscriptionId } = request.params as { subscriptionId: string }
      try {
        return reply.send(await handlers.setSubscriptionStatus(subscriptionId, status))
      } catch (error) {
        return sendPushError(reply, error)
      }
    })
  }

  return app
}

function sendPushError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : 'push_request_failed'
  const status = /not found/i.test(message) ? 404 : /changed|pending|transition|invalid|required|source/i.test(message) ? 409 : 422
  return reply.code(status).send({ error: message })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}
