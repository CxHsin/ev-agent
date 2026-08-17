export type PushCandidateStatus = 'pending' | 'confirmed' | 'rejected'
export type PushSubscriptionStatus = 'active' | 'paused' | 'revoked' | 'expired'
export type PushDeliveryChannel = 'inbox' | 'windows'

export interface PushSubscriptionDraft {
  readonly scope: string
  readonly sources: readonly string[]
  readonly schedule: string
  readonly timezone: string
  readonly channel: PushDeliveryChannel
  readonly itemBudget: number
  readonly filters: readonly string[]
  readonly validFrom: number
  readonly validUntil?: number
}

export interface StorePushSubscriptionCandidateInput {
  readonly candidateId: string
  readonly userScopeId: string
  readonly requestText: string
  readonly draft: PushSubscriptionDraft
  readonly revision: number
  readonly scopeFingerprint: string
  readonly status?: PushCandidateStatus
  readonly decisionReason?: string
  readonly createdAt: number
}

export interface DurablePushSubscriptionCandidate extends Omit<StorePushSubscriptionCandidateInput, 'status' | 'decisionReason'> {
  readonly status: PushCandidateStatus
  readonly decisionReason: string | undefined
  readonly decidedAt: number | undefined
}

export interface DurablePushSubscription {
  readonly subscriptionId: string
  readonly candidateId: string
  readonly userScopeId: string
  readonly draft: PushSubscriptionDraft
  readonly revision: number
  readonly scopeFingerprint: string
  readonly status: PushSubscriptionStatus
  readonly createdAt: number
  readonly updatedAt: number
}
