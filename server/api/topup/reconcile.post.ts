import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { assertBillingOn } from '#server/utils/billingGate'
import { getPool } from '#server/utils/db'
import { findTopUpSignature, getSolanaConnection, verifyTopUp } from '#server/utils/solana'
import { creditTopUp, failIntent, reconcilableIntents, type TopUpStatus } from '#server/utils/topups'

/**
 * Finishes top-ups whose confirmation outlived the submit request, or whose
 * signature the client lost: locate by reference, verify by effect, credit.
 */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  assertBillingOn()
  const wallet = await requireWallet(event)
  const db = getPool()
  const connection = getSolanaConnection()

  const results: { id: string, status: TopUpStatus }[] = []
  for (const intent of await reconcilableIntents(db, wallet)) {
    const signature = intent.txSignature ?? await findTopUpSignature(connection, intent.reference)
    if (!signature) {
      results.push({ id: intent.id, status: intent.status })
      continue
    }
    const verdict = await verifyTopUp(connection, signature, {
      recipient: intent.recipient,
      usdcMint: intent.mint,
      reference: intent.reference,
      amountBase: intent.amountBase,
    })
    if (verdict.ok) {
      await creditTopUp(db, intent.id, signature)
      results.push({ id: intent.id, status: 'confirmed' })
    } else if (!verdict.retryable) {
      await failIntent(db, intent.id, verdict.reason)
      results.push({ id: intent.id, status: 'failed' })
    } else {
      results.push({ id: intent.id, status: intent.status })
    }
  }
  return { intents: results }
})
