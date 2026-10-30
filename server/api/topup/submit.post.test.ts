import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'

stubH3Globals()

const getServerConfig = vi.fn()
const claimIntent = vi.fn()
const getIntentStatus = vi.fn()
const releaseClaim = vi.fn()
const setSignature = vi.fn()
const failIntent = vi.fn()
const creditTopUp = vi.fn()
const verifyTopUp = vi.fn()
const sendRawTransaction = vi.fn()
const confirmTransaction = vi.fn()

vi.mock('#server/utils/session', () => ({ requireWallet: async () => 'W' }))
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin: vi.fn() }))
vi.mock('#server/utils/config', () => ({ getServerConfig }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({}) }))
vi.mock('#server/utils/topups', () => ({ claimIntent, getIntentStatus, releaseClaim, setSignature, failIntent, creditTopUp }))
vi.mock('#server/utils/solana', () => ({
  getSolanaConnection: () => ({ sendRawTransaction, confirmTransaction }),
  verifyTopUp,
}))

const { default: handler } = await import('./submit.post')

const INTENT = {
  id: 'i1', wallet: 'W', amountBase: 1_000_000n, reference: 'R', recipient: 'T', mint: 'M',
  blockhash: 'B', lastValidBlockHeight: 9, status: 'submitting', txSignature: null,
}
const body = { intentId: 'i1', signedTxBase64: Buffer.from('signed').toString('base64') }

beforeEach(() => {
  vi.clearAllMocks()
  getServerConfig.mockReturnValue({ billing: 'on' })
  claimIntent.mockResolvedValue(INTENT)
  sendRawTransaction.mockResolvedValue('SIG')
  confirmTransaction.mockResolvedValue({ value: { err: null } })
  verifyTopUp.mockResolvedValue({ ok: true })
  creditTopUp.mockResolvedValue(1_000_000)
})

describe('POST /api/topup/submit', () => {
  it('submit credits on verified effect', async () => {
    expect(await handler(evt(body))).toEqual({ status: 'confirmed', creditedMicro: '1000000' })
    expect(claimIntent).toHaveBeenCalledWith(expect.anything(), 'i1', 'W')
    expect(setSignature).toHaveBeenCalledWith(expect.anything(), 'i1', 'SIG')
    expect(verifyTopUp).toHaveBeenCalledWith(expect.anything(), 'SIG', {
      recipient: 'T', usdcMint: 'M', reference: 'R', amountBase: 1_000_000n,
    })
    expect(creditTopUp).toHaveBeenCalledWith(expect.anything(), 'i1', 'SIG')
  })

  it('submit stays submitting on retryable verify', async () => {
    verifyTopUp.mockResolvedValue({ ok: false, retryable: true, reason: 'not found yet' })
    expect(await handler(evt(body))).toEqual({ status: 'submitting' })
    expect(failIntent).not.toHaveBeenCalled()
    expect(creditTopUp).not.toHaveBeenCalled()
  })

  it('stays submitting when confirmation times out', async () => {
    confirmTransaction.mockRejectedValue(new Error('timeout'))
    expect(await handler(evt(body))).toEqual({ status: 'submitting' })
    expect(verifyTopUp).not.toHaveBeenCalled()
  })

  it('submit marks failed on final verify', async () => {
    verifyTopUp.mockResolvedValue({ ok: false, retryable: false, reason: 'amount not transferred' })
    expect(await handler(evt(body))).toEqual({ status: 'failed', reason: 'amount not transferred' })
    expect(failIntent).toHaveBeenCalledWith(expect.anything(), 'i1', 'amount not transferred')
    expect(creditTopUp).not.toHaveBeenCalled()
  })

  it('returns expired and releases the claim on a stale blockhash', async () => {
    sendRawTransaction.mockRejectedValue(new Error('Blockhash not found'))
    expect(await handler(evt(body))).toEqual({ status: 'expired' })
    expect(releaseClaim).toHaveBeenCalledWith(expect.anything(), 'i1')
  })

  it('submit only claims the caller’s own intent', async () => {
    claimIntent.mockResolvedValue(null)
    getIntentStatus.mockResolvedValue(null)
    await expect(handler(evt(body))).rejects.toMatchObject({ statusCode: 404 })
    expect(sendRawTransaction).not.toHaveBeenCalled()
  })

  it('reports the current status of an intent that is no longer pending', async () => {
    claimIntent.mockResolvedValue(null)
    getIntentStatus.mockResolvedValue('confirmed')
    expect(await handler(evt(body))).toEqual({ status: 'confirmed' })
    expect(sendRawTransaction).not.toHaveBeenCalled()
  })

  it('404 when billing off', async () => {
    getServerConfig.mockReturnValue({ billing: 'off' })
    await expect(handler(evt(body))).rejects.toMatchObject({ statusCode: 404 })
  })
})
