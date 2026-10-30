import { SendTransactionError } from '@solana/web3.js'
import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { assertBillingOn } from '#server/utils/billingGate'
import { getPool } from '#server/utils/db'
import { getSolanaConnection, parseSignedTransaction, verifyTopUp } from '#server/utils/solana'
import { claimIntent, creditTopUp, failIntent, getIntentStatus, releaseClaim } from '#server/utils/topups'

interface Body {
  intentId: string
  signedTxBase64: string
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  assertBillingOn()
  const wallet = await requireWallet(event)
  const body = await readBody<Body>(event)
  if (typeof body?.intentId !== 'string' || typeof body?.signedTxBase64 !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing fields' })
  }

  let parsed: { signature: string, accountKeys: string[] }
  try {
    parsed = parseSignedTransaction(body.signedTxBase64)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Not a signed transaction' })
  }
  const { signature } = parsed

  const db = getPool()
  const intent = await claimIntent(db, body.intentId, wallet, signature, parsed.accountKeys)
  if (!intent) {
    const status = await getIntentStatus(db, body.intentId, wallet)
    if (!status) throw createError({ statusCode: 404, statusMessage: 'Intent not found' })
    if (status === 'pending') {
      throw createError({ statusCode: 400, statusMessage: 'Transaction does not belong to this intent' })
    }
    return { status }
  }

  const connection = getSolanaConnection()
  try {
    await connection.sendRawTransaction(Buffer.from(body.signedTxBase64, 'base64'), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
  } catch (err) {
    // Only an RPC error response is a definitive rejection. Anything else
    // (timeout, reset, gateway error) may have reached the cluster: keep the
    // intent submitting with its signature, and let reconcile settle it.
    if (!(err instanceof SendTransactionError)) return { status: 'submitting' as const }
    await releaseClaim(db, intent.id)
    const msg = err.message
    if (/blockhash not found|block height exceeded/i.test(msg)) return { status: 'expired' as const }
    if (/insufficient funds|insufficient lamports|no record of a prior credit/i.test(msg)) {
      throw createError({ statusCode: 402, statusMessage: 'Insufficient funds', data: { code: 'insufficient_funds' } })
    }
    throw createError({ statusCode: 400, statusMessage: 'Transaction rejected' })
  }

  try {
    await connection.confirmTransaction(
      { signature, blockhash: intent.blockhash, lastValidBlockHeight: intent.lastValidBlockHeight },
      'confirmed',
    )
  } catch {
    // Slow, or dropped: reconcile verifies it, or expires it once the
    // blockhash can no longer land.
    return { status: 'submitting' as const }
  }

  const verdict = await verifyTopUp(connection, signature, {
    recipient: intent.recipient,
    usdcMint: intent.mint,
    reference: intent.reference,
    amountBase: intent.amountBase,
  })
  if (!verdict.ok) {
    // A transient miss must not fail a payment whose money already moved.
    if (verdict.retryable) return { status: 'submitting' as const }
    await failIntent(db, intent.id, verdict.reason)
    return { status: 'failed' as const, reason: verdict.reason }
  }

  const credited = await creditTopUp(db, intent.id, signature)
  if (credited === 0) {
    // Settled concurrently (by reconcile): report what actually happened.
    return { status: (await getIntentStatus(db, intent.id, wallet)) ?? 'failed' }
  }
  return { status: 'confirmed' as const, creditedMicro: String(credited) }
})
