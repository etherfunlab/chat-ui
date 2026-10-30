import { describe, it, expect, vi } from 'vitest'
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { performTopUp } from './useTopUp'

const payer = Keypair.generate()
const WALLET = payer.publicKey.toBase58()

function unsignedTxBase64(): string {
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1,
  }))
  tx.feePayer = payer.publicKey
  tx.recentBlockhash = new PublicKey(Keypair.generate().publicKey).toBase58()
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
}

function deps(over: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/topup/intent') return { intentId: 'i1', transactionBase64: unsignedTxBase64() }
    if (url === '/api/topup/submit') return { status: 'confirmed', creditedMicro: '10000000' }
    throw new Error(`unexpected ${url}`)
  })
  const signTransaction = vi.fn(async (tx: Transaction) => {
    tx.partialSign(payer)
    return tx
  })
  return { amount: '10', connectedWallet: WALLET, sessionWallet: WALLET, signTransaction, fetcher, ...over }
}

describe('performTopUp', () => {
  it('requests an intent, signs it with the wallet, and submits the signed bytes', async () => {
    const d = deps()
    expect(await performTopUp(d as never)).toEqual({ status: 'confirmed', creditedMicro: '10000000', intentId: 'i1' })
    expect(d.fetcher).toHaveBeenNthCalledWith(1, '/api/topup/intent', { method: 'POST', body: { amount: '10' } })
    expect(d.signTransaction).toHaveBeenCalledTimes(1)
    const [, opts] = d.fetcher.mock.calls[1] as unknown as [string, { body: { intentId: string, signedTxBase64: string } }]
    expect(opts.body.intentId).toBe('i1')
    const submitted = Transaction.from(Buffer.from(opts.body.signedTxBase64, 'base64'))
    expect(submitted.verifySignatures()).toBe(true)
  })

  it('refuses when the connected wallet differs from the signed-in wallet', async () => {
    const d = deps({ connectedWallet: Keypair.generate().publicKey.toBase58() })
    await expect(performTopUp(d as never)).rejects.toThrow(/differs from the signed-in wallet/)
    expect(d.fetcher).not.toHaveBeenCalled()
  })

  it('refuses when no wallet is connected', async () => {
    const d = deps({ connectedWallet: null })
    await expect(performTopUp(d as never)).rejects.toThrow(/differs from the signed-in wallet/)
  })

  it('propagates a 402 from the intent endpoint', async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error('Insufficient funds'), { statusCode: 402, data: { data: { code: 'insufficient_funds' } } })
    })
    const d = deps({ fetcher })
    await expect(performTopUp(d as never)).rejects.toMatchObject({ statusCode: 402 })
    expect(d.signTransaction).not.toHaveBeenCalled()
  })
})
