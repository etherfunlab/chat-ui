import { describe, it, expect, vi } from 'vitest'
import { resumePendingTopUps, topUpMessage, waitForIntent } from './useTopUp'

const noSleep = async () => {}

describe('waitForIntent', () => {
  it('returns the tracked intent’s final status from reconcile', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ intents: [{ id: 'i1', status: 'submitting' }, { id: 'old', status: 'submitting' }] })
      .mockResolvedValueOnce({ intents: [{ id: 'i1', status: 'confirmed' }, { id: 'old', status: 'submitting' }] })
    expect(await waitForIntent('i1', { fetcher, sleep: noSleep, now: () => 0, limitMs: 1000 })).toBe('confirmed')
    expect(fetcher).toHaveBeenCalledWith('/api/topup/reconcile', { method: 'POST' })
  })

  it('looks the intent up in the list once reconcile no longer returns it', async () => {
    const fetcher = vi.fn(async (url: string) => url === '/api/topup/reconcile'
      ? { intents: [] }
      : { intents: [{ id: 'i1', status: 'failed' }] })
    expect(await waitForIntent('i1', { fetcher, sleep: noSleep, now: () => 0, limitMs: 1000 })).toBe('failed')
    expect(fetcher).toHaveBeenCalledWith('/api/topup')
  })

  it('reports submitting when the time limit passes', async () => {
    let t = 0
    const fetcher = vi.fn(async () => ({ intents: [{ id: 'i1', status: 'submitting' }] }))
    const status = await waitForIntent('i1', { fetcher, sleep: async () => { t += 5000 }, now: () => t, limitMs: 12000 })
    expect(status).toBe('submitting')
  })

  it('treats a transient reconcile error as "still submitting" and keeps polling', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce({ intents: [{ id: 'i1', status: 'confirmed' }] })
    expect(await waitForIntent('i1', { fetcher, sleep: noSleep, now: () => 0, limitMs: 1000 })).toBe('confirmed')
  })
})

describe('topUpMessage', () => {
  it('never claims completion for anything but a confirmed top-up', () => {
    expect(topUpMessage('confirmed')).toBe('Top-up complete.')
    expect(topUpMessage('submitting')).toMatch(/still confirming/i)
    expect(topUpMessage('failed')).toMatch(/failed/i)
    expect(topUpMessage('expired')).toMatch(/expired/i)
    expect(topUpMessage('pending')).not.toMatch(/complete/i)
  })
})

describe('resumePendingTopUps', () => {
  it('reconciles and refreshes the balance when billing is on', async () => {
    const fetcher = vi.fn(async () => ({ intents: [{ id: 'i1', status: 'confirmed' }] }))
    const refreshMe = vi.fn(async () => {})
    await resumePendingTopUps({ me: { wallet: 'W', billing: 'on', availableMicro: '0' }, fetcher, refreshMe })
    expect(fetcher).toHaveBeenCalledWith('/api/topup/reconcile', { method: 'POST' })
    expect(refreshMe).toHaveBeenCalled()
  })

  it('does nothing when signed out or billing is off', async () => {
    const fetcher = vi.fn()
    const refreshMe = vi.fn()
    await resumePendingTopUps({ me: null, fetcher, refreshMe })
    await resumePendingTopUps({ me: { wallet: 'W', billing: 'off', availableMicro: '0' }, fetcher, refreshMe })
    expect(fetcher).not.toHaveBeenCalled()
    expect(refreshMe).not.toHaveBeenCalled()
  })

  it('swallows reconcile failures (it runs in the background on page load)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('502') })
    await expect(resumePendingTopUps({ me: { wallet: 'W', billing: 'on', availableMicro: '0' }, fetcher, refreshMe: vi.fn() }))
      .resolves.toBeUndefined()
  })
})
