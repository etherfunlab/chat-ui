import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { assertBillingOn } from '#server/utils/billingGate'
import { getPool } from '#server/utils/db'
import { findTopUpSignatures, getSolanaConnection, signatureLanded, verifyTopUp } from '#server/utils/solana'
import { creditTopUp, failIntent, reconcilableIntents, type TopUpIntent, type TopUpStatus } from '#server/utils/topups'

/**
 * Finishes top-ups the submit request could not: confirmation outlived it,
 * the broadcast failed ambiguously, or the transfer was broadcast without our
 * submit ever seeing it. Each intent is verified by on-chain effect and
 * credited, or — once its blockhash is past validity with no qualifying
 * payment on chain — expired, since its transfer can never land.
 * The client calls this on page load and while waiting on a top-up.
 */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  assertBillingOn()
  const wallet = await requireWallet(event)
  const db = getPool()
  const connection = getSolanaConnection()

  // Unknown height (RPC error) means nothing is expired this round.
  let height: number | null = null
  try {
    height = await connection.getBlockHeight('finalized')
  } catch {}
  const pastValidity = (i: TopUpIntent) => height !== null && height > i.lastValidBlockHeight

  async function expire(intent: TopUpIntent): Promise<TopUpStatus> {
    await failIntent(db, intent.id, 'expired')
    return 'failed'
  }

  async function settle(intent: TopUpIntent): Promise<TopUpStatus> {
    // A stored signature was checked at claim to carry this intent's
    // reference. Signatures found by reference may belong to anyone.
    const own = intent.txSignature
    const candidates = own ? [own] : await findTopUpSignatures(connection, intent.reference)
    let retryable = false
    let finalReason: string | null = null
    for (const signature of candidates) {
      const verdict = await verifyTopUp(connection, signature, {
        recipient: intent.recipient,
        usdcMint: intent.mint,
        reference: intent.reference,
        amountBase: intent.amountBase,
      })
      if (verdict.ok) {
        return (await creditTopUp(db, intent.id, signature)) > 0 ? 'confirmed' : intent.status
      }
      if (verdict.retryable) retryable = true
      else finalReason = verdict.reason
    }

    if (own) {
      if (!retryable && finalReason) {
        await failIntent(db, intent.id, finalReason)
        return 'failed'
      }
      // Not visible yet. Dropped for good only once the blockhash is past
      // validity and the cluster has no record of the signature.
      if (pastValidity(intent) && !(await signatureLanded(connection, own))) return expire(intent)
      return intent.status
    }

    // Never fail an intent over a transaction someone else made: only expire
    // it once its own transfer can no longer land.
    if (!retryable && pastValidity(intent)) return expire(intent)
    return intent.status
  }

  const results: { id: string, status: TopUpStatus }[] = []
  for (const intent of await reconcilableIntents(db, wallet)) {
    try {
      results.push({ id: intent.id, status: await settle(intent) })
    } catch {
      // One intent's RPC/DB trouble must not block the others; retry next time.
      results.push({ id: intent.id, status: intent.status })
    }
  }
  return { intents: results }
})
