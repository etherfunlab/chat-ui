import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { assertBillingOn } from '#server/utils/billingGate'
import { getPool } from '#server/utils/db'
import { getSolanaConnection, verifyTopUp } from '#server/utils/solana'
import { claimIntent, creditTopUp, failIntent, getIntentStatus, releaseClaim, setSignature } from '#server/utils/topups'

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

  const db = getPool()
  const intent = await claimIntent(db, body.intentId, wallet)
  if (!intent) {
    const status = await getIntentStatus(db, body.intentId, wallet)
    if (!status) throw createError({ statusCode: 404, statusMessage: 'Intent not found' })
    return { status }
  }

  const connection = getSolanaConnection()
  let signature: string
  try {
    signature = await connection.sendRawTransaction(Buffer.from(body.signedTxBase64, 'base64'), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
  } catch (err) {
    await releaseClaim(db, intent.id)
    if (/blockhash|expired/i.test((err as Error).message ?? '')) return { status: 'expired' as const }
    throw createError({ statusCode: 502, statusMessage: 'Broadcast failed' })
  }
  await setSignature(db, intent.id, signature)

  try {
    await connection.confirmTransaction(
      { signature, blockhash: intent.blockhash, lastValidBlockHeight: intent.lastValidBlockHeight },
      'confirmed',
    )
  } catch {
    // Broadcast succeeded; confirmation is just slow. Reconcile finishes it.
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
  return { status: 'confirmed' as const, creditedMicro: String(credited) }
})
