import { useState, type ReactElement } from 'react'
import type { DurablePushSubscriptionCandidate } from '@ev-agent/durability'
import type { PushSubscriptionClient } from './push-client.js'

export interface PushSubscriptionSurfaceProps {
  readonly candidate: DurablePushSubscriptionCandidate
  readonly client: PushSubscriptionClient
  readonly subscriptionId: string
}

export function PushSubscriptionSurface({ candidate, client, subscriptionId }: PushSubscriptionSurfaceProps): ReactElement {
  const [status, setStatus] = useState(candidate.status)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await client.confirmCandidate({ candidateId: candidate.candidateId, subscriptionId, revision: candidate.revision, scopeFingerprint: candidate.scopeFingerprint })
      setStatus('confirmed')
    } catch (value) {
      setError(value instanceof Error ? value.message : 'confirmation_failed')
    } finally {
      setBusy(false)
    }
  }
  const reject = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await client.rejectCandidate(candidate.candidateId, 'user_rejected')
      setStatus('rejected')
    } catch (value) {
      setError(value instanceof Error ? value.message : 'rejection_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Push Subscription Candidate" className="push-candidate-surface">
      <div className="push-candidate-heading"><div><p className="eyebrow">PUSH CANDIDATE</p><h1>Review proactive delivery</h1></div><strong>{status}</strong></div>
      <p>{candidate.requestText}</p>
      <dl className="push-candidate-details">
        <div><dt>Scope</dt><dd>{candidate.draft.scope}</dd></div>
        <div><dt>Sources</dt><dd>{candidate.draft.sources.join(', ')}</dd></div>
        <div><dt>Schedule</dt><dd>{candidate.draft.schedule} · {candidate.draft.timezone}</dd></div>
        <div><dt>Channel</dt><dd>{candidate.draft.channel} · up to {candidate.draft.itemBudget} items</dd></div>
      </dl>
      {error && <p role="alert">{error}</p>}
      {status === 'pending' && <div className="push-candidate-actions"><button type="button" className="button secondary" onClick={() => void reject()} disabled={busy}>Reject</button><button type="button" className="button primary" onClick={() => void confirm()} disabled={busy}>Confirm subscription</button></div>}
    </section>
  )
}
