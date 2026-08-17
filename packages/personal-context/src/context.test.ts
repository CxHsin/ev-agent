import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalContextService } from './index.js'

describe('Personal Context', () => {
  const directories: string[] = []
  const services: PersonalContextService[] = []

  afterEach(() => {
    for (const service of services.splice(0)) service.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('keeps Memory Candidates separate until explicit review accepts one', () => {
    const service = createService(directories, services)
    const candidate = service.submitCandidate({
      candidateId: 'candidate-1', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'timezone',
      content: 'Asia/Shanghai', source: 'session:run-1', scope: 'user', confidence: 0.9, sensitive: false,
    })
    expect(candidate.status).toBe('pending')
    expect(service.listClaims('agent-1')).toHaveLength(0)

    const review = service.reviewCandidate('candidate-1')

    expect(review.candidate.status).toBe('accepted')
    expect(review.claim).toEqual(expect.objectContaining({ claimKey: 'timezone', content: 'Asia/Shanghai' }))
    expect(service.listClaims('agent-1')).toHaveLength(1)
  })

  it('rejects invalid, duplicate, and conflicting candidates with reasons', () => {
    const service = createService(directories, services)
    const invalid = service.submitCandidate({
      candidateId: 'candidate-invalid', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'timezone',
      content: '', source: 'session:run-1', scope: 'user', confidence: 1.2, sensitive: false,
    })
    expect(invalid).toEqual(expect.objectContaining({ status: 'rejected', decisionReason: 'content_required' }))
    service.submitCandidate({
      candidateId: 'candidate-1', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'timezone',
      content: 'Asia/Shanghai', source: 'session:run-1', scope: 'user', confidence: 0.9, sensitive: false,
    })
    service.reviewCandidate('candidate-1')
    service.submitCandidate({
      candidateId: 'candidate-duplicate', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'timezone',
      content: 'Asia/Shanghai', source: 'session:run-2', scope: 'user', confidence: 0.8, sensitive: false,
    })
    service.submitCandidate({
      candidateId: 'candidate-conflict', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'timezone',
      content: 'Europe/London', source: 'session:run-3', scope: 'user', confidence: 0.8, sensitive: false,
    })

    expect(service.reviewCandidate('candidate-duplicate').candidate.decisionReason).toBe('duplicate_claim')
    expect(service.reviewCandidate('candidate-conflict').candidate.decisionReason).toBe('conflicting_claim')
  })

  it('requires an explicit policy before a sensitive candidate can be reviewed', () => {
    const service = createService(directories, services)
    const candidate = service.submitCandidate({
      candidateId: 'candidate-sensitive', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'secret',
      content: 'private value', source: 'session:run-1', scope: 'user', confidence: 0.9, sensitive: true,
    })

    expect(candidate).toMatchObject({ status: 'rejected', decisionReason: 'sensitive_candidate_requires_policy' })
    expect(service.listClaims('agent-1')).toHaveLength(0)
  })

  it('persists structured Evidence Bundle items with provenance', () => {
    const service = createService(directories, services)
    service.submitCandidate({
      candidateId: 'candidate-evidence', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'timezone',
      content: 'Asia/Shanghai', source: 'session:run-1', scope: 'user', confidence: 0.9, sensitive: false,
    })
    service.reviewCandidate('candidate-evidence')
    const bundle = service.createEvidenceBundle({
      bundleId: 'evidence-1', runId: 'run-1', items: [
        { itemId: 'item-1', referenceType: 'claim', referenceId: 'candidate-evidence:claim', source: 'session:run-1', applicability: 'timezone answer', confidence: 0.9 },
        { itemId: 'item-2', referenceType: 'claim', referenceId: 'candidate-evidence:claim', source: 'run-1', applicability: 'tool result', confidence: 0.8 },
      ],
    })
    expect(service.getEvidenceBundle('evidence-1')).toEqual(bundle)
    expect(() => service.createEvidenceBundle({
      bundleId: 'evidence-unknown', runId: 'run-1', items: [{ itemId: 'unknown', referenceType: 'event', referenceId: 'missing-event', source: 'run-1', applicability: 'missing', confidence: 0.5 }],
    })).toThrow(/unknown Agent Event/)
    expect(() => service.createEvidenceBundle({
      bundleId: 'evidence-bad', runId: 'run-1', items: [{ itemId: 'bad', referenceType: 'event', referenceId: '', source: '', applicability: '', confidence: 2 }],
    })).toThrow(/missing provenance/)
  })

  it('erases a candidate and its derived Claim without retaining sensitive content', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-agent-context-erasure-'))
    directories.push(directory)
    const service = new PersonalContextService({ databasePath: join(directory, 'runtime.sqlite'), candidatePolicy: () => undefined })
    services.push(service)
    service.submitCandidate({
      candidateId: 'candidate-erased', agentScopeId: 'agent-1', kind: 'semantic', claimKey: 'private-key',
      content: 'private value', source: 'session:run-1', scope: 'user', confidence: 0.9, sensitive: true,
    })
    service.reviewCandidate('candidate-erased')
    service.eraseCandidate('candidate-erased')

    expect(service.listClaims('agent-1')).toHaveLength(0)
    expect(service.listCandidates('agent-1')[0]).toEqual(expect.objectContaining({ content: '[erased]', source: '[erased]', decisionReason: 'data_erased' }))
  })
})

function createService(directories: string[], services: PersonalContextService[]): PersonalContextService {
  const directory = mkdtempSync(join(tmpdir(), 'ev-agent-context-'))
  directories.push(directory)
  const service = new PersonalContextService({ databasePath: join(directory, 'runtime.sqlite') })
  services.push(service)
  return service
}
