import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SendTransactionError } from '@solana/web3.js'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'

stubH3Globals()

const getServerConfig = vi.fn()
const claimIntent = vi.fn()
const getIntentStatus = vi.fn()
const releaseClaim = vi.fn()
const failIntent = vi.fn()
const creditTopUp = vi.fn()
const verifyTopUp = vi.fn()
const signatureOf = vi.fn()
const sendRawTransaction = vi.fn()
const confirmTransaction = vi.fn()

vi.mock('#server/utils/session', () => ({ requireWallet: async () => 'W' }))
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin: vi.fn() }))
vi.mock('#server/utils/config', () => ({ getServerConfig }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({}) }))
vi.mock('#server/utils/topups', () => ({ claimIntent, getIntentStatus, releaseClaim, failIntent, creditTopUp }))
vi.mock('#server/utils/solana', () => ({
  getSolanaConnection: () => ({ sendRawTransaction, confirmTransaction }),
  verifyTopUp,
  signatureOf,
}))

const { default: handler } = await import('./submit.post')

const INTENT = {
  id: 'i1', wallet: 'W', amountBase: 1_000_000n, reference: 'R', recipient: 'T', mint: 'M',
  blockhash: 'B', lastValidBlockHeight: 9, status: 'submitting', txSignature: 'SIG',
}
const body = { intentId: 'i1', signedTxBase64: Buffer.from('signed').toString('base64') }
const rejected = (msg: string) => new SendTransactionError({ action: 'send', signature: '', transactionMessage: msg, logs: [] })

beforeEach(() => {
  vi.clearAllMocks()
  getServerConfig.mockReturnValue({ billing: 'on' })
  signatureOf.mockReturnValue('SIG')
  claimIntent.mockResolvedValue(INTENT)
  sendRawTransaction.mockResolvedValue('SIG')
  confirmTransaction.mockResolvedValue({ value: { err: null } })
  verifyTopUp.mockResolvedValue({ ok: true })
  creditTopUp.mockResolvedValue(1_000_000)
})

describe('POST /api/topup/submit', () => {
  it('submit credits on verified effect', async () => {
    expect(await handler(evt(body))).toEqual({ status: 'confirmed', creditedMicro: '1000000' })
    expect(verifyTopUp).toHaveBeenCalledWith(expect.anything(), 'SIG', {
      recipient: 'T', usdcMint: 'M', reference: 'R', amountBase: 1_000_000n,
    })
    expect(creditTopUp).toHaveBeenCalledWith(expect.anything(), 'i1', 'SIG')
  })

  it('records the signature at claim time, before broadcasting', async () => {
    await handler(evt(body))
    expect(signatureOf).toHaveBeenCalledWith(body.signedTxBase64)
    expect(claimIntent).toHaveBeenCalledWith(expect.anything(), 'i1', 'W', 'SIG')
    expect(claimIntent.mock.invocationCallOrder[0]).toBeLessThan(sendRawTransaction.mock.invocationCallOrder[0]!)
  })

  it('rejects bytes that are not a signed transaction with 400 and claims nothing', async () => {
    signatureOf.mockImplementation(() => { throw new Error('bad tx') })
    await expect(handler(evt(body))).rejects.toMatchObject({ statusCode: 400 })
    expect(claimIntent).not.toHaveBeenCalled()
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
  })

  it('keeps submitting on an ambiguous broadcast failure (the payment may have landed)', async () => {
    sendRawTransaction.mockRejectedValue(new TypeError('fetch failed'))
    expect(await handler(evt(body))).toEqual({ status: 'submitting' })
    expect(releaseClaim).not.toHaveBeenCalled()
  })

  it('returns expired and releases the claim on a stale blockhash', async () => {
    sendRawTransaction.mockRejectedValue(rejected('Blockhash not found'))
    expect(await handler(evt(body))).toEqual({ status: 'expired' })
    expect(releaseClaim).toHaveBeenCalledWith(expect.anything(), 'i1')
  })

  it('maps a preflight fee shortfall to 402 insufficient_funds and releases the claim', async () => {
    for (const msg of [
      'Attempt to debit an account but found no record of a prior credit.',
      'Transaction results in an account (0) with insufficient funds for rent',
      'insufficient funds for fee',
    ]) {
      sendRawTransaction.mockRejectedValueOnce(rejected(msg))
      await expect(handler(evt(body)), msg).rejects.toMatchObject({ statusCode: 402, data: { code: 'insufficient_funds' } })
    }
    expect(releaseClaim).toHaveBeenCalledTimes(3)
  })

  it('releases the claim and answers 400 on any other preflight rejection', async () => {
    sendRawTransaction.mockRejectedValue(rejected('Transaction simulation failed: custom program error: 0x1'))
    await expect(handler(evt(body))).rejects.toMatchObject({ statusCode: 400 })
    expect(releaseClaim).toHaveBeenCalledWith(expect.anything(), 'i1')
  })

  it('reports the real status when nothing was credited', async () => {
    creditTopUp.mockResolvedValue(0)
    getIntentStatus.mockResolvedValue('failed')
    expect(await handler(evt(body))).toEqual({ status: 'failed' })
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
