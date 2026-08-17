export type MemoryCandidateStatus = 'pending' | 'accepted' | 'rejected'
export type MemoryKind = 'episodic' | 'semantic' | 'procedural' | 'working'

export interface MemoryAcceptanceProof {
  readonly validator: 'personal-context'
}

export interface StoreMemoryCandidateInput {
  readonly candidateId: string
  readonly agentScopeId: string
  readonly kind: MemoryKind
  readonly claimKey: string
  readonly content: string
  readonly source: string
  readonly scope: string
  readonly confidence: number
  readonly sensitive: boolean
  readonly status?: Exclude<MemoryCandidateStatus, 'accepted'>
  readonly decisionReason?: string
  readonly createdAt: number
}

export interface DurableMemoryCandidate {
  readonly candidateId: string
  readonly agentScopeId: string
  readonly kind: MemoryKind
  readonly claimKey: string
  readonly content: string
  readonly source: string
  readonly scope: string
  readonly confidence: number
  readonly sensitive: boolean
  readonly status: MemoryCandidateStatus
  readonly decisionReason: string | undefined
  readonly createdAt: number
  readonly decidedAt: number | undefined
}

export interface DurableClaim {
  readonly claimId: string
  readonly candidateId: string
  readonly agentScopeId: string
  readonly kind: MemoryKind
  readonly claimKey: string
  readonly content: string
  readonly source: string
  readonly scope: string
  readonly confidence: number
  readonly sensitive: boolean
  readonly acceptedAt: number
}

export interface StoreEvidenceBundleInput {
  readonly bundleId: string
  readonly runId: string
  readonly createdAt: number
  readonly items: readonly StoreEvidenceItemInput[]
}

export interface StoreEvidenceItemInput {
  readonly itemId: string
  readonly referenceType: 'claim' | 'event'
  readonly referenceId: string
  readonly source: string
  readonly applicability: string
  readonly confidence: number
}

export interface DurableEvidenceItem extends StoreEvidenceItemInput {}

export interface DurableEvidenceBundle {
  readonly bundleId: string
  readonly runId: string
  readonly createdAt: number
  readonly items: readonly DurableEvidenceItem[]
}
