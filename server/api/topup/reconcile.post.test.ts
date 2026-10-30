import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'

stubH3Globals()

const getServerConfig = vi.fn()
const reconcilableIntents = vi.fn()
const failIntent = vi.fn()
const creditTopUp = vi.fn()
const verifyTopUp = vi.fn()
const findTopUpSignature = vi.fn()

vi.mock('#server/utils/session', () => ({ requireWallet: async () => 'W' }))
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin: vi.fn() }))
vi.mock('#server/utils/config', () => ({ getServerConfig }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({}) }))
vi.mock('#server/utils/topups', () => ({ reconcilableIntents, failIntent, creditTopUp }))
vi.mock('#server/utils/solana', () => ({ getSolanaConnection: () => ({}), verifyTopUp, findTopUpSignature }))

const { default: handler } = await import('./reconcile.post')

const base = { wallet: 'W', amountBase: 1_000_000n, recipient: 'T', mint: 'M', blockhash: 'B', lastValidBlockHeight: 9 }

beforeEach(() => {
  vi.clearAllMocks()
  getServerConfig.mockReturnValue({ billing: 'on' })
  creditTopUp.mockResolvedValue(1_000_000)
})

describe('POST /api/topup/reconcile', () => {
  it('reconcile finds by reference and credits', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i1', reference: 'R1', status: 'pending', txSignature: null }])
    findTopUpSignature.mockResolvedValue('SIG1')
    verifyTopUp.mockResolvedValue({ ok: true })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i1', status: 'confirmed' }] })
    expect(findTopUpSignature).toHaveBeenCalledWith(expect.anything(), 'R1')
    expect(creditTopUp).toHaveBeenCalledWith(expect.anything(), 'i1', 'SIG1')
  })

  it('verifies a known signature without searching', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i2', reference: 'R2', status: 'submitting', txSignature: 'SIG2' }])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: true, reason: 'not found yet' })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i2', status: 'submitting' }] })
    expect(findTopUpSignature).not.toHaveBeenCalled()
    expect(creditTopUp).not.toHaveBeenCalled()
  })

  it('leaves a pending intent with no payment on chain untouched', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i3', reference: 'R3', status: 'pending', txSignature: null }])
    findTopUpSignature.mockResolvedValue(null)
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i3', status: 'pending' }] })
    expect(verifyTopUp).not.toHaveBeenCalled()
  })

  it('fails an intent on a final verification negative', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i4', reference: 'R4', status: 'submitting', txSignature: 'SIG4' }])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: false, reason: 'transaction failed' })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i4', status: 'failed' }] })
    expect(failIntent).toHaveBeenCalledWith(expect.anything(), 'i4', 'transaction failed')
  })
})
