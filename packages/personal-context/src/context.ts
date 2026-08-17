import {
  DurabilityStore,
  type DurableClaim,
  type DurableEvidenceBundle,
  type DurableMemoryCandidate,
  type MemoryKind,
} from '@ev-agent/durability'

export interface MemoryCandidateInput {
  readonly candidateId: string
  readonly agentScopeId: string
  readonly kind: MemoryKind
  readonly claimKey: string
  readonly content: string
  readonly source: string
  readonly scope: string
  readonly confidence: number
  readonly sensitive: boolean
}

export interface MemoryCandidateReview {
  readonly candidate: DurableMemoryCandidate
  readonly claim?: DurableClaim
}

export interface EvidenceBundleItem {
  readonly itemId: string
  readonly referenceType: 'claim' | 'event'
  readonly referenceId: string
  readonly source: string
  readonly applicability: string
  readonly confidence: number
}

export interface EvidenceBundleInput {
  readonly bundleId: string
  readonly runId: string
  readonly items: readonly EvidenceBundleItem[]
}

export type EvidenceBundle = DurableEvidenceBundle

export interface PersonalContextServiceOptions {
  readonly databasePath: string
  readonly now?: () => number
  readonly candidatePolicy?: (input: MemoryCandidateInput) => string | undefined
}

export class PersonalContextService {
  private readonly store: DurabilityStore
  private readonly now: () => number
  private readonly candidatePolicy: PersonalContextServiceOptions['candidatePolicy']

  constructor(options: PersonalContextServiceOptions) {
    this.store = new DurabilityStore(options.databasePath)
    this.now = options.now ?? (() => Date.now())
    this.candidatePolicy = options.candidatePolicy
  }

  submitCandidate(input: MemoryCandidateInput): DurableMemoryCandidate {
    const validationError = validateCandidate(input)
      ?? this.validatePolicy(input)
    return this.store.createMemoryCandidate({
      ...input,
      ...(validationError === undefined ? {} : { status: 'rejected' as const, decisionReason: validationError }),
      createdAt: this.now(),
    })
  }

  reviewCandidate(candidateId: string): MemoryCandidateReview {
    const candidate = this.store.getMemoryCandidate(candidateId)
    if (!candidate) throw new Error(`memory candidate "${candidateId}" was not found`)
    if (candidate.status !== 'pending') return this.reviewResult(candidate)

    const policyError = this.validatePolicy({
      candidateId: candidate.candidateId,
      agentScopeId: candidate.agentScopeId,
      kind: candidate.kind,
      claimKey: candidate.claimKey,
      content: candidate.content,
      source: candidate.source,
      scope: candidate.scope,
      confidence: candidate.confidence,
      sensitive: candidate.sensitive,
    })
    if (policyError !== undefined) {
      this.store.rejectMemoryCandidate(candidateId, policyError, this.now())
      return this.reviewResult(this.requireCandidate(candidateId))
    }

    const claims = this.store.listClaims(candidate.agentScopeId)
    const duplicate = claims.find((claim) => claim.scope === candidate.scope
      && claim.claimKey === candidate.claimKey
      && claim.content === candidate.content)
    if (duplicate !== undefined) {
      this.store.rejectMemoryCandidate(candidateId, 'duplicate_claim', this.now())
      return this.reviewResult(this.requireCandidate(candidateId))
    }
    const conflict = claims.find((claim) => claim.scope === candidate.scope && claim.claimKey === candidate.claimKey)
    if (conflict !== undefined) {
      this.store.rejectMemoryCandidate(candidateId, 'conflicting_claim', this.now())
      return this.reviewResult(this.requireCandidate(candidateId))
    }
    const claim = this.store.acceptValidatedMemoryCandidate(candidateId, { validator: 'personal-context' }, 'validated', this.now())
    return { candidate: this.requireCandidate(candidateId), ...(claim === undefined ? {} : { claim }) }
  }

  rejectCandidate(candidateId: string, reason: string): DurableMemoryCandidate {
    const candidate = this.store.getMemoryCandidate(candidateId)
    if (!candidate) throw new Error(`memory candidate "${candidateId}" was not found`)
    if (candidate.status === 'pending') this.store.rejectMemoryCandidate(candidateId, reason, this.now())
    return this.requireCandidate(candidateId)
  }

  listCandidates(agentScopeId: string): readonly DurableMemoryCandidate[] {
    return this.store.listMemoryCandidates(agentScopeId)
  }

  listClaims(agentScopeId: string): readonly DurableClaim[] {
    return this.store.listClaims(agentScopeId)
  }

  eraseCandidate(candidateId: string): void {
    this.store.eraseMemoryCandidate(candidateId, this.now())
  }

  createEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle {
    for (const item of input.items) {
      if (item.source.length === 0 || item.applicability.length === 0 || item.referenceId.length === 0) {
        throw new Error(`evidence item "${item.itemId}" is missing provenance`)
      }
      if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        throw new Error(`evidence item "${item.itemId}" has invalid confidence`)
      }
      if (item.referenceType === 'claim') {
        if (this.store.getClaim(item.referenceId) === undefined) throw new Error(`evidence item "${item.itemId}" references an unknown Claim`)
      } else {
        const event = this.store.getEvent(item.referenceId)
        if (event === undefined || event.runId !== input.runId) throw new Error(`evidence item "${item.itemId}" references an unknown Agent Event`)
      }
    }
    return this.store.createEvidenceBundle({ bundleId: input.bundleId, runId: input.runId, createdAt: this.now(), items: input.items })
  }

  getEvidenceBundle(bundleId: string): EvidenceBundle | undefined {
    return this.store.getEvidenceBundle(bundleId)
  }

  close(): void {
    this.store.close()
  }

  private requireCandidate(candidateId: string): DurableMemoryCandidate {
    const candidate = this.store.getMemoryCandidate(candidateId)
    if (!candidate) throw new Error(`memory candidate "${candidateId}" was not found`)
    return candidate
  }

  private reviewResult(candidate: DurableMemoryCandidate): MemoryCandidateReview {
    const claim = this.store.listClaims(candidate.agentScopeId).find((value) => value.candidateId === candidate.candidateId)
    return claim === undefined ? { candidate } : { candidate, claim }
  }

  private validatePolicy(input: MemoryCandidateInput): string | undefined {
    if (input.sensitive && this.candidatePolicy === undefined) return 'sensitive_candidate_requires_policy'
    return this.candidatePolicy?.(input)
  }
}

function validateCandidate(input: MemoryCandidateInput): string | undefined {
  if (input.candidateId.length === 0) return 'candidate_id_required'
  if (input.agentScopeId.length === 0) return 'scope_owner_required'
  if (input.claimKey.length === 0) return 'claim_key_required'
  if (input.content.length === 0) return 'content_required'
  if (input.source.length === 0) return 'provenance_required'
  if (input.scope.length === 0) return 'claim_scope_required'
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) return 'invalid_confidence'
  return undefined
}
