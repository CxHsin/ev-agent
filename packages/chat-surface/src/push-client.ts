import type { DurablePushSubscription, DurablePushSubscriptionCandidate } from '@ev-agent/durability'

export interface PushSubscriptionClient {
  confirmCandidate(input: { readonly candidateId: string; readonly subscriptionId: string; readonly revision: number; readonly scopeFingerprint: string }): Promise<DurablePushSubscription>
  rejectCandidate(candidateId: string, reason: string): Promise<DurablePushSubscriptionCandidate>
}

export class HttpPushSubscriptionClient implements PushSubscriptionClient {
  private readonly baseUrl: string

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  confirmCandidate(input: { readonly candidateId: string; readonly subscriptionId: string; readonly revision: number; readonly scopeFingerprint: string }): Promise<DurablePushSubscription> {
    return this.request<DurablePushSubscription>(`/push/candidates/${encodeURIComponent(input.candidateId)}/confirm`, { method: 'POST', body: JSON.stringify({ subscriptionId: input.subscriptionId, revision: input.revision, scopeFingerprint: input.scopeFingerprint }) })
  }

  rejectCandidate(candidateId: string, reason: string): Promise<DurablePushSubscriptionCandidate> {
    return this.request<DurablePushSubscriptionCandidate>(`/push/candidates/${encodeURIComponent(candidateId)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json' } })
    const body = await response.json() as unknown
    if (!response.ok) throw new Error(typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : `request_failed:${response.status}`)
    return body as T
  }
}
