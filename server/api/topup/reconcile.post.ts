import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { assertBillingOn } from '#server/utils/billingGate'
import { getPool } from '#server/utils/db'
import { findTopUpSignature, getSolanaConnection, signatureLanded, verifyTopUp } from '#server/utils/solana'
import { creditTopUp, failIntent, reconcilableIntents, type TopUpIntent, type TopUpStatus } from '#server/utils/topups'

/**
 * Finishes top-ups the submit request could not: confirmation outlived it,
 * the broadcast failed ambiguously, or the client lost the signature. Each
 * intent is verified by on-chain effect and credited, or — once its blockhash
 * is past validity with no trace on chain — expired, since it can never land.
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

  async function settle(intent: TopUpIntent): Promise<TopUpStatus> {
    const signature = intent.txSignature ?? await findTopUpSignature(connection, intent.reference)
    if (!signature) {
      if (!pastValidity(intent)) return intent.status
      await failIntent(db, intent.id, 'expired')
      return 'failed'
    }
    const verdict = await verifyTopUp(connection, signature, {
      recipient: intent.recipient,
      usdcMint: intent.mint,
      reference: intent.reference,
      amountBase: intent.amountBase,
    })
    if (verdict.ok) {
      return (await creditTopUp(db, intent.id, signature)) > 0 ? 'confirmed' : intent.status
    }
    if (!verdict.retryable) {
      await failIntent(db, intent.id, verdict.reason)
      return 'failed'
    }
    if (pastValidity(intent) && !(await signatureLanded(connection, signature))) {
      await failIntent(db, intent.id, 'expired')
      return 'failed'
    }
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
