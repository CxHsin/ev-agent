import type { PushSubscriptionService } from '@ev-agent/push'
import { createPushApi, type PushApiHandlers } from './push-api.js'

export function createPushHandlers(service: PushSubscriptionService): PushApiHandlers {
  return {
    proposeCandidate: (input) => service.propose(input),
    getCandidate: (candidateId) => service.getCandidate(candidateId),
    confirmCandidate: (input) => service.confirm(input),
    rejectCandidate: (candidateId, reason) => service.reject(candidateId, reason),
    getSubscription: (subscriptionId) => service.getSubscription(subscriptionId),
    setSubscriptionStatus: (subscriptionId, status) => status === 'paused'
      ? service.pause(subscriptionId)
      : status === 'active' ? service.resume(subscriptionId) : service.revoke(subscriptionId),
  }
}

export async function createPushSubscriptionApi(service: PushSubscriptionService) {
  return createPushApi(createPushHandlers(service))
}
