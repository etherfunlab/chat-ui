import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'

const createTransfer = vi.fn()
const findReference = vi.fn()
vi.mock('@solana/pay', () => ({ createTransfer, findReference }))

const {
  usdcBaseUnits, verifyTopUp, buildTopUpTransaction, findTopUpSignatures, signatureLanded, parseSignedTransaction,
} = await import('./solana')

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const OTHER_MINT = Keypair.generate().publicKey.toBase58()
const TREASURY = Keypair.generate().publicKey.toBase58()
const REFERENCE = Keypair.generate().publicKey.toBase58()
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111'

interface Bal { accountIndex: number, mint: string, owner: string, amount: string }

function fakeTx(o: { keys: string[], pre: Bal[], post: Bal[], err?: unknown }) {
  const toRow = (b: Bal) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount } })
  return {
    meta: { err: o.err ?? null, preTokenBalances: o.pre.map(toRow), postTokenBalances: o.post.map(toRow), loadedAddresses: undefined },
    transaction: {
      message: {
        getAccountKeys: () => ({ keySegments: () => [o.keys.map(k => new PublicKey(k))] }),
      },
    },
  }
}

const conn = (tx: unknown) => ({ getTransaction: vi.fn(async () => tx) }) as never
const expectV = { recipient: TREASURY, usdcMint: MINT, reference: REFERENCE, amountBase: 1_000_000n }

describe('usdcBaseUnits', () => {
  it('parses decimal strings exactly', () => {
    expect(usdcBaseUnits('1')).toBe(1_000_000n)
    expect(usdcBaseUnits('1.1')).toBe(1_100_000n)
    expect(usdcBaseUnits('0.000001')).toBe(1n)
    expect(usdcBaseUnits('10000')).toBe(10_000_000_000n)
  })

  it('rejects anything that is not a plain decimal with at most 6 places', () => {
    for (const bad of ['0.0000001', '1e3', '-5', '', '1.', '.5', ' 1', 'abc', '1,000']) {
      expect(() => usdcBaseUnits(bad), bad).toThrow()
    }
  })
})

describe('verifyTopUp', () => {
  it('accepts an effect-verified payment even with extra compute-budget instructions', async () => {
    const tx = fakeTx({
      keys: [Keypair.generate().publicKey.toBase58(), COMPUTE_BUDGET, REFERENCE],
      pre: [{ accountIndex: 3, mint: MINT, owner: TREASURY, amount: '5000000' }],
      post: [{ accountIndex: 3, mint: MINT, owner: TREASURY, amount: '6000000' }],
    })
    expect(await verifyTopUp(conn(tx), 'SIG', expectV)).toEqual({ ok: true })
  })

  it('rejects wrong mint', async () => {
    const tx = fakeTx({
      keys: [REFERENCE],
      pre: [{ accountIndex: 3, mint: OTHER_MINT, owner: TREASURY, amount: '0' }],
      post: [{ accountIndex: 3, mint: OTHER_MINT, owner: TREASURY, amount: '1000000' }],
    })
    expect(await verifyTopUp(conn(tx), 'SIG', expectV)).toEqual({ ok: false, retryable: false, reason: 'amount not transferred' })
  })

  it('rejects short amount', async () => {
    const tx = fakeTx({
      keys: [REFERENCE],
      pre: [{ accountIndex: 3, mint: MINT, owner: TREASURY, amount: '0' }],
      post: [{ accountIndex: 3, mint: MINT, owner: TREASURY, amount: '999999' }],
    })
    expect(await verifyTopUp(conn(tx), 'SIG', expectV)).toMatchObject({ ok: false, retryable: false })
  })

  it('rejects missing reference', async () => {
    const tx = fakeTx({
      keys: [Keypair.generate().publicKey.toBase58()],
      pre: [{ accountIndex: 3, mint: MINT, owner: TREASURY, amount: '0' }],
      post: [{ accountIndex: 3, mint: MINT, owner: TREASURY, amount: '1000000' }],
    })
    expect(await verifyTopUp(conn(tx), 'SIG', expectV)).toEqual({ ok: false, retryable: false, reason: 'reference not found' })
  })

  it('treats a not-yet-visible tx as retryable', async () => {
    expect(await verifyTopUp(conn(null), 'SIG', expectV)).toMatchObject({ ok: false, retryable: true })
  })

  it('treats an on-chain error as final', async () => {
    const tx = fakeTx({ keys: [REFERENCE], pre: [], post: [], err: { InstructionError: [0, 'Custom'] } })
    expect(await verifyTopUp(conn(tx), 'SIG', expectV)).toEqual({ ok: false, retryable: false, reason: 'transaction failed' })
  })

  it('treats an RPC failure as retryable', async () => {
    const c = { getTransaction: vi.fn(async () => { throw new Error('429 Too Many Requests') }) } as never
    expect(await verifyTopUp(c, 'SIG', expectV)).toMatchObject({ ok: false, retryable: true })
  })

  it('sums balance change across treasury accounts by index', async () => {
    // A treasury token account created in this tx appears only on the post side.
    const tx = fakeTx({
      keys: [REFERENCE],
      pre: [{ accountIndex: 2, mint: MINT, owner: TREASURY, amount: '700000' }],
      post: [
        { accountIndex: 2, mint: MINT, owner: TREASURY, amount: '700000' },
        { accountIndex: 5, mint: MINT, owner: TREASURY, amount: '1000000' },
      ],
    })
    expect(await verifyTopUp(conn(tx), 'SIG', expectV)).toEqual({ ok: true })
  })
})

describe('buildTopUpTransaction', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('stores the same blockhash the transaction carries, unsigned', async () => {
    const sender = Keypair.generate().publicKey
    createTransfer.mockImplementation(async () => new Transaction().add(
      SystemProgram.transfer({ fromPubkey: sender, toPubkey: new PublicKey(TREASURY), lamports: 1 }),
    ))
    const blockhash = Keypair.generate().publicKey.toBase58()
    const connection = { getLatestBlockhash: vi.fn(async () => ({ blockhash, lastValidBlockHeight: 42 })) } as never
    const out = await buildTopUpTransaction({
      connection, sender: sender.toBase58(), recipient: TREASURY, usdcMint: MINT, amountBase: 1_500_000n,
    })
    const tx = Transaction.from(Buffer.from(out.transactionBase64, 'base64'))
    expect(tx.recentBlockhash).toBe(blockhash)
    expect(tx.feePayer?.toBase58()).toBe(sender.toBase58())
    expect(tx.signatures.every(s => s.signature === null)).toBe(true)
    expect(out).toMatchObject({ blockhash, lastValidBlockHeight: 42 })
    const [, , fields] = createTransfer.mock.calls[0]!
    expect(fields.splToken.toBase58()).toBe(MINT)
    expect(fields.reference.toBase58()).toBe(out.reference)
    expect(fields.amount.toString()).toBe('1.5')
  })
})

describe('findTopUpSignatures', () => {
  it('returns every successful transaction that carries the reference', async () => {
    const getSignaturesForAddress = vi.fn(async () => [
      { signature: 'DUST', err: null },
      { signature: 'FAILED', err: { InstructionError: [0, 'x'] } },
      { signature: 'REAL', err: null },
    ])
    expect(await findTopUpSignatures({ getSignaturesForAddress } as never, REFERENCE)).toEqual(['DUST', 'REAL'])
    expect((getSignaturesForAddress.mock.calls[0] as unknown[])[0]).toBeInstanceOf(PublicKey)
  })

  it('returns an empty list only when the chain has none', async () => {
    const c = { getSignaturesForAddress: vi.fn(async () => []) } as never
    expect(await findTopUpSignatures(c, REFERENCE)).toEqual([])
  })

  it('throws on RPC failures so callers never mistake them for "no payment"', async () => {
    const c = { getSignaturesForAddress: vi.fn(async () => { throw new Error('429 Too Many Requests') }) } as never
    await expect(findTopUpSignatures(c, REFERENCE)).rejects.toThrow(/429/)
  })
})

describe('signatureLanded', () => {
  it('reports whether the cluster has any record of the signature', async () => {
    const c = (value: unknown) => ({ getSignatureStatuses: vi.fn(async () => ({ value: [value] })) }) as never
    expect(await signatureLanded(c(null), 'SIG')).toBe(false)
    expect(await signatureLanded(c({ confirmationStatus: 'confirmed', err: null }), 'SIG')).toBe(true)
  })
})

describe('parseSignedTransaction', () => {
  it('derives the fee-payer signature and the account keys from signed bytes', () => {
    const payer = Keypair.generate()
    const ix = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(TREASURY), lamports: 1 })
    ix.keys.push({ pubkey: new PublicKey(REFERENCE), isSigner: false, isWritable: false })
    const tx = new Transaction().add(ix)
    tx.feePayer = payer.publicKey
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58()
    tx.sign(payer)
    const parsed = parseSignedTransaction(Buffer.from(tx.serialize()).toString('base64'))
    expect(parsed.signature).toBe(bs58.encode(tx.signature!))
    expect(parsed.accountKeys).toEqual(expect.arrayContaining([payer.publicKey.toBase58(), TREASURY, REFERENCE]))
  })

  it('throws on bytes that are not a signed transaction', () => {
    expect(() => parseSignedTransaction(Buffer.from('garbage').toString('base64'))).toThrow()
  })
})
