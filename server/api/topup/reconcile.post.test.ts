import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'

stubH3Globals()

const getServerConfig = vi.fn()
const reconcilableIntents = vi.fn()
const failIntent = vi.fn()
const creditTopUp = vi.fn()
const verifyTopUp = vi.fn()
const findTopUpSignatures = vi.fn()
const signatureLanded = vi.fn()
const getBlockHeight = vi.fn()

vi.mock('#server/utils/session', () => ({ requireWallet: async () => 'W' }))
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin: vi.fn() }))
vi.mock('#server/utils/config', () => ({ getServerConfig }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({}) }))
vi.mock('#server/utils/topups', () => ({ reconcilableIntents, failIntent, creditTopUp }))
vi.mock('#server/utils/solana', () => ({
  getSolanaConnection: () => ({ getBlockHeight }),
  verifyTopUp,
  findTopUpSignatures,
  signatureLanded,
}))

const { default: handler } = await import('./reconcile.post')

const base = { wallet: 'W', amountBase: 1_000_000n, recipient: 'T', mint: 'M', blockhash: 'B', lastValidBlockHeight: 100 }

beforeEach(() => {
  vi.clearAllMocks()
  getServerConfig.mockReturnValue({ billing: 'on' })
  creditTopUp.mockResolvedValue(1_000_000)
  getBlockHeight.mockResolvedValue(50) // still inside the blockhash validity window
})

describe('POST /api/topup/reconcile', () => {
  it('reconcile finds by reference and credits', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i1', reference: 'R1', status: 'pending', txSignature: null }])
    findTopUpSignatures.mockResolvedValue(['SIG1'])
    verifyTopUp.mockResolvedValue({ ok: true })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i1', status: 'confirmed' }] })
    expect(creditTopUp).toHaveBeenCalledWith(expect.anything(), 'i1', 'SIG1')
  })

  it('verifies a known signature without searching', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i2', reference: 'R2', status: 'submitting', txSignature: 'SIG2' }])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: true, reason: 'not found yet' })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i2', status: 'submitting' }] })
    expect(findTopUpSignatures).not.toHaveBeenCalled()
    expect(failIntent).not.toHaveBeenCalled()
  })

  it('leaves a pending intent with no payment on chain untouched while its blockhash is valid', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i3', reference: 'R3', status: 'pending', txSignature: null }])
    findTopUpSignatures.mockResolvedValue([])
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i3', status: 'pending' }] })
    expect(failIntent).not.toHaveBeenCalled()
  })

  it('expires a pending intent once its blockhash can no longer land', async () => {
    getBlockHeight.mockResolvedValue(101)
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i3', reference: 'R3', status: 'pending', txSignature: null }])
    findTopUpSignatures.mockResolvedValue([])
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i3', status: 'failed' }] })
    expect(failIntent).toHaveBeenCalledWith(expect.anything(), 'i3', 'expired')
  })

  it('expires a dropped transaction: blockhash past validity and no record of the signature', async () => {
    getBlockHeight.mockResolvedValue(101)
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i5', reference: 'R5', status: 'submitting', txSignature: 'SIG5' }])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: true, reason: 'not found yet' })
    signatureLanded.mockResolvedValue(false)
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i5', status: 'failed' }] })
    expect(failIntent).toHaveBeenCalledWith(expect.anything(), 'i5', 'expired')
  })

  it('does not expire a transaction the cluster knows about', async () => {
    getBlockHeight.mockResolvedValue(101)
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i6', reference: 'R6', status: 'submitting', txSignature: 'SIG6' }])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: true, reason: 'not found yet' })
    signatureLanded.mockResolvedValue(true)
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i6', status: 'submitting' }] })
    expect(failIntent).not.toHaveBeenCalled()
  })

  it('fails an intent on a final verification negative', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i4', reference: 'R4', status: 'submitting', txSignature: 'SIG4' }])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: false, reason: 'transaction failed' })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i4', status: 'failed' }] })
    expect(failIntent).toHaveBeenCalledWith(expect.anything(), 'i4', 'transaction failed')
  })

  it('keeps going when one intent errors, leaving it unchanged', async () => {
    reconcilableIntents.mockResolvedValue([
      { ...base, id: 'bad', reference: 'RB', status: 'pending', txSignature: null },
      { ...base, id: 'good', reference: 'RG', status: 'pending', txSignature: null },
    ])
    findTopUpSignatures
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce(['SIGG'])
    verifyTopUp.mockResolvedValue({ ok: true })
    expect(await handler(evt())).toEqual({ intents: [
      { id: 'bad', status: 'pending' },
      { id: 'good', status: 'confirmed' },
    ] })
    expect(failIntent).not.toHaveBeenCalled()
  })

  it('credits when any signature for the reference verifies, even after a dust transaction', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i8', reference: 'R8', status: 'pending', txSignature: null }])
    findTopUpSignatures.mockResolvedValue(['DUST', 'REAL'])
    verifyTopUp.mockImplementation(async (_c: unknown, sig: string) => sig === 'REAL'
      ? { ok: true }
      : { ok: false, retryable: false, reason: 'amount not transferred' })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i8', status: 'confirmed' }] })
    expect(creditTopUp).toHaveBeenCalledWith(expect.anything(), 'i8', 'REAL')
  })

  it('never fails a pending intent over someone else’s transaction while its own can still land', async () => {
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i9', reference: 'R9', status: 'pending', txSignature: null }])
    findTopUpSignatures.mockResolvedValue(['DUST'])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: false, reason: 'amount not transferred' })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i9', status: 'pending' }] })
    expect(failIntent).not.toHaveBeenCalled()
  })

  it('expires a pending intent with only non-matching reference transactions once past validity', async () => {
    getBlockHeight.mockResolvedValue(101)
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i10', reference: 'R10', status: 'pending', txSignature: null }])
    findTopUpSignatures.mockResolvedValue(['DUST'])
    verifyTopUp.mockResolvedValue({ ok: false, retryable: false, reason: 'amount not transferred' })
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i10', status: 'failed' }] })
    expect(failIntent).toHaveBeenCalledWith(expect.anything(), 'i10', 'expired')
  })

  it('never expires anything when the block height is unknown', async () => {
    getBlockHeight.mockRejectedValue(new Error('rpc down'))
    reconcilableIntents.mockResolvedValue([{ ...base, id: 'i7', reference: 'R7', status: 'pending', txSignature: null }])
    findTopUpSignatures.mockResolvedValue([])
    expect(await handler(evt())).toEqual({ intents: [{ id: 'i7', status: 'pending' }] })
    expect(failIntent).not.toHaveBeenCalled()
  })
})
