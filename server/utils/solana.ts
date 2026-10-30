import { Connection, Keypair, PublicKey, type Transaction } from '@solana/web3.js'
import { createTransfer, findReference } from '@solana/pay'
import type { Amount } from '@solana/pay'
import BigNumber from 'bignumber.js'
import { getServerConfig } from './config'

const USDC_DECIMALS = 6

/**
 * Parses a plain decimal USDC amount ("12", "1.5", "0.000001") straight into
 * base units. No float is involved: "0.1" must be exactly 100000.
 */
export function usdcBaseUnits(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount)
  if (!m) throw new Error(`invalid USDC amount "${amount}"`)
  const [, whole, frac = ''] = m
  return BigInt(whole!) * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac.padEnd(USDC_DECIMALS, '0'))
}

let connection: Connection | undefined

export function getSolanaConnection(): Connection {
  if (!connection) connection = new Connection(getServerConfig().solanaRpcUrl, 'confirmed')
  return connection
}

/** Builds the UNSIGNED USDC transfer; the browser wallet signs it. */
export async function buildTopUpTransaction(o: {
  connection: Connection
  sender: string
  recipient: string
  usdcMint: string
  amountBase: bigint
}): Promise<{ reference: string, transactionBase64: string, blockhash: string, lastValidBlockHeight: number }> {
  const reference = Keypair.generate().publicKey
  const sender = new PublicKey(o.sender)
  // @solana/pay types its amount with its own bignumber.js major; the runtime
  // objects are structurally identical.
  const amount = new BigNumber(o.amountBase.toString()).shiftedBy(-USDC_DECIMALS) as unknown as Amount
  const tx: Transaction = await createTransfer(o.connection, sender, {
    recipient: new PublicKey(o.recipient),
    amount,
    splToken: new PublicKey(o.usdcMint),
    reference,
  })
  // createTransfer sets a blockhash but not its lastValidBlockHeight, which
  // submit needs to confirm. Replace both from one fetch so the stored pair
  // matches what the wallet signs.
  const { blockhash, lastValidBlockHeight } = await o.connection.getLatestBlockhash('finalized')
  tx.feePayer = sender
  tx.recentBlockhash = blockhash
  const transactionBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
  return { reference: reference.toBase58(), transactionBase64, blockhash, lastValidBlockHeight }
}

export type VerifyResult = { ok: true } | { ok: false, retryable: boolean, reason: string }

/**
 * Verifies a payment by its on-chain EFFECT, not its instruction layout:
 * wallets append compute-budget instructions when signing, which breaks
 * shape-based checks such as @solana/pay's validateTransfer (it expects the
 * transfer to be the last instruction) even for real payments.
 *
 * Asserts: the tx succeeded, this intent's unique reference key is among its
 * accounts, and treasury-owned token accounts of the mint gained >= amount
 * (per-tx pre/post snapshots, so concurrent payments never interfere).
 * `retryable` means "cannot tell yet" — callers keep the intent submitting.
 */
export async function verifyTopUp(
  connection: Connection,
  signature: string,
  v: { recipient: string, usdcMint: string, reference: string, amountBase: bigint },
): Promise<VerifyResult> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (!tx) return { ok: false, retryable: true, reason: 'not found yet' }
    const meta = tx.meta
    if (!meta) return { ok: false, retryable: true, reason: 'missing meta' }
    if (meta.err) return { ok: false, retryable: false, reason: 'transaction failed' }

    const keys = tx.transaction.message
      .getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses })
      .keySegments()
      .flat()
      .map(k => k.toBase58())
    if (!keys.includes(v.reference)) return { ok: false, retryable: false, reason: 'reference not found' }

    // Pair balances by accountIndex over the union of both sides: an account
    // created in this tx has no pre entry, one closed in it has no post entry.
    const byIndex = (rows: typeof meta.preTokenBalances) => {
      const m = new Map<number, bigint>()
      for (const b of rows ?? []) {
        if (b.owner === v.recipient && b.mint === v.usdcMint) m.set(b.accountIndex, BigInt(b.uiTokenAmount.amount))
      }
      return m
    }
    const pre = byIndex(meta.preTokenBalances)
    const post = byIndex(meta.postTokenBalances)
    let delta = 0n
    for (const i of new Set([...pre.keys(), ...post.keys()])) delta += (post.get(i) ?? 0n) - (pre.get(i) ?? 0n)
    if (delta < v.amountBase) return { ok: false, retryable: false, reason: 'amount not transferred' }
    return { ok: true }
  } catch (err) {
    return { ok: false, retryable: true, reason: (err as Error).message || 'verification failed' }
  }
}

/** Finds a payment by its reference key (reconcile when the signature was lost). */
export async function findTopUpSignature(connection: Connection, reference: string): Promise<string | null> {
  try {
    const info = await findReference(connection, new PublicKey(reference), { finality: 'confirmed' })
    return info.signature
  } catch {
    return null
  }
}
