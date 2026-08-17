/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PushSubscriptionSurface } from './PushSubscriptionSurface.js'
import type { PushSubscriptionClient } from './push-client.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PushSubscriptionSurface', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
      await Promise.resolve()
    })
    container?.remove()
    root = undefined
    container = undefined
  })

  it('shows the parsed authority before confirmation and confirms it explicitly', async () => {
    const client: PushSubscriptionClient = {
      confirmCandidate: vi.fn(async () => ({ subscriptionId: 'subscription-1', candidateId: 'candidate-1', userScopeId: 'user-1', draft: candidate.draft, revision: 1, scopeFingerprint: 'fp-1', status: 'active' as const, createdAt: 1, updatedAt: 1 })),
      rejectCandidate: vi.fn(),
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<PushSubscriptionSurface candidate={candidate} client={client} subscriptionId="subscription-1" />)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('pending')
    expect(container.textContent).toContain('daily@20:00')
    const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Confirm'))
    if (!confirm) throw new Error('confirmation control was not rendered')
    await act(async () => {
      confirm.click()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(client.confirmCandidate).toHaveBeenCalledWith({ candidateId: 'candidate-1', subscriptionId: 'subscription-1', revision: 1, scopeFingerprint: 'fp-1' })
    expect(container.textContent).toContain('confirmed')
  })
})

const candidate = {
  candidateId: 'candidate-1', userScopeId: 'user-1', requestText: 'Watch the AI feed.',
  draft: { scope: 'AI engineering', sources: ['https://feeds.example.test/ai'], schedule: 'daily@20:00', timezone: 'UTC', channel: 'inbox' as const, itemBudget: 5, filters: [], validFrom: 1 },
  revision: 1, scopeFingerprint: 'fp-1', status: 'pending' as const, createdAt: 1, decisionReason: undefined, decidedAt: undefined,
}
