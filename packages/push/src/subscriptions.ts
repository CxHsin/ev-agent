import { createHash } from 'node:crypto'
import {
  DurabilityStore,
  type DurablePushSubscription,
  type DurablePushSubscriptionCandidate,
  type PushDeliveryChannel,
  type PushSubscriptionDraft,
  type PushSubscriptionStatus,
} from '@ev-agent/durability'

export interface PushSubscriptionServiceOptions {
  readonly databasePath: string
  readonly now?: () => number
  readonly defaultTimezone?: string
}

export interface ProposePushSubscriptionInput {
  readonly candidateId: string
  readonly userScopeId: string
  readonly requestText: string
}

export interface ConfirmPushSubscriptionInput {
  readonly candidateId: string
  readonly subscriptionId: string
  readonly revision: number
  readonly scopeFingerprint: string
}

export class PushSubscriptionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PushSubscriptionValidationError'
  }
}

export class PushSubscriptionService {
  private readonly store: DurabilityStore
  private readonly now: () => number
  private readonly defaultTimezone: string

  constructor(options: PushSubscriptionServiceOptions) {
    this.store = new DurabilityStore(options.databasePath)
    this.now = options.now ?? (() => Date.now())
    this.defaultTimezone = options.defaultTimezone ?? 'UTC'
  }

  propose(input: ProposePushSubscriptionInput): DurablePushSubscriptionCandidate {
    const draft = parseSubscriptionRequest(input.requestText, this.defaultTimezone, this.now())
    const fingerprint = fingerprintDraft(draft)
    return this.store.createPushSubscriptionCandidate({
      candidateId: requireText(input.candidateId, 'candidateId'),
      userScopeId: requireText(input.userScopeId, 'userScopeId'),
      requestText: requireText(input.requestText, 'requestText'),
      draft,
      revision: 1,
      scopeFingerprint: fingerprint,
      createdAt: this.now(),
    })
  }

  getCandidate(candidateId: string): DurablePushSubscriptionCandidate | undefined {
    return this.store.getPushSubscriptionCandidate(candidateId)
  }

  listCandidates(userScopeId: string): readonly DurablePushSubscriptionCandidate[] {
    return this.store.listPushSubscriptionCandidates(userScopeId)
  }

  confirm(input: ConfirmPushSubscriptionInput): DurablePushSubscription {
    return this.store.confirmPushSubscription({
      ...input,
      confirmedAt: this.now(),
    })
  }

  reject(candidateId: string, reason: string): DurablePushSubscriptionCandidate {
    return this.store.rejectPushSubscriptionCandidate(candidateId, requireText(reason, 'reason'), this.now())
  }

  getSubscription(subscriptionId: string): DurablePushSubscription | undefined {
    return this.store.getPushSubscription(subscriptionId)
  }

  listSubscriptions(userScopeId: string): readonly DurablePushSubscription[] {
    return this.store.listPushSubscriptions(userScopeId)
  }

  pause(subscriptionId: string): DurablePushSubscription {
    return this.setStatus(subscriptionId, 'paused')
  }

  resume(subscriptionId: string): DurablePushSubscription {
    return this.setStatus(subscriptionId, 'active')
  }

  revoke(subscriptionId: string): DurablePushSubscription {
    return this.setStatus(subscriptionId, 'revoked')
  }

  expire(subscriptionId: string): DurablePushSubscription {
    return this.setStatus(subscriptionId, 'expired')
  }

  close(): void {
    this.store.close()
  }

  private setStatus(subscriptionId: string, status: PushSubscriptionStatus): DurablePushSubscription {
    const current = this.store.getPushSubscription(subscriptionId)
    if (!current) throw new PushSubscriptionValidationError(`Push Subscription "${subscriptionId}" was not found`)
    if (current.status === 'revoked' || current.status === 'expired') {
      throw new PushSubscriptionValidationError(`Push Subscription "${subscriptionId}" cannot transition from ${current.status}`)
    }
    if (status === 'active' && current.status !== 'paused') {
      throw new PushSubscriptionValidationError(`Push Subscription "${subscriptionId}" can only resume from paused`)
    }
    if (status === 'paused' && current.status !== 'active') {
      throw new PushSubscriptionValidationError(`Push Subscription "${subscriptionId}" can only pause from active`)
    }
    return this.store.setPushSubscriptionStatus(subscriptionId, status, this.now())
  }
}

export function parseSubscriptionRequest(requestText: string, timezone: string, now: number): PushSubscriptionDraft {
  const text = requireText(requestText, 'requestText')
  const urls = [...text.matchAll(/https?:\/\/[^\s,]+/gi)].map((match) => match[0]!.replace(/[.)]+$/, ''))
  const githubSources = [...text.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)/gi)].map((match) => `github:${match[1]!.replace(/\.git$/, '')}`)
  const sources = [...new Set([...urls, ...githubSources])]
  if (sources.length === 0) throw new PushSubscriptionValidationError('at least one RSS URL or GitHub repository is required')
  const time = text.match(/(?:at|@|每天|每日)\s*(\d{1,2})(?::(\d{2}))?/i)
  const hour = time?.[1] === undefined ? 20 : Number(time[1])
  const minute = time?.[2] === undefined ? 0 : Number(time[2])
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new PushSubscriptionValidationError('schedule time must be a valid 24-hour time')
  }
  const budgetMatch = text.match(/(\d+)\s*(?:items?|条)/i)
  const itemBudget = budgetMatch?.[1] === undefined ? 5 : Number(budgetMatch[1])
  if (!Number.isSafeInteger(itemBudget) || itemBudget < 1 || itemBudget > 50) throw new PushSubscriptionValidationError('item budget must be between 1 and 50')
  const channel: PushDeliveryChannel = /windows|notification|通知/i.test(text) ? 'windows' : 'inbox'
  const filters = /release|发布/i.test(text) ? ['release'] : []
  return {
    scope: text,
    sources,
    schedule: `daily@${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
    timezone: requireText(timezone, 'timezone'),
    channel,
    itemBudget,
    filters,
    validFrom: now,
  }
}

function fingerprintDraft(draft: PushSubscriptionDraft): string {
  return createHash('sha256').update(JSON.stringify(draft)).digest('hex')
}

function requireText(value: string, field: string): string {
  if (value.trim().length === 0) throw new PushSubscriptionValidationError(`${field} is required`)
  return value.trim()
}
