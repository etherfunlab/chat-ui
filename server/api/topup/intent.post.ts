import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { assertBillingOn } from '#server/utils/billingGate'
import { getServerConfig } from '#server/utils/config'
import { getPool } from '#server/utils/db'
import { buildTopUpTransaction, getSolanaConnection, usdcBaseUnits } from '#server/utils/solana'
import { createIntent } from '#server/utils/topups'

const MIN_BASE = 1_000_000n // 1 USDC
const MAX_BASE = 10_000_000_000n // 10000 USDC

interface Body {
  amount: string
}

function isInsufficientFunds(err: unknown): boolean {
  const e = err as { message?: string, cause?: { message?: string } }
  return /insufficient funds/i.test(e?.message ?? '') || /insufficient funds/i.test(e?.cause?.message ?? '')
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  assertBillingOn()
  const wallet = await requireWallet(event)
  const body = await readBody<Body>(event)

  let amountBase: bigint
  try {
    amountBase = usdcBaseUnits(String(body?.amount ?? ''))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid amount' })
  }
  if (amountBase < MIN_BASE || amountBase > MAX_BASE) {
    throw createError({ statusCode: 400, statusMessage: 'Amount must be between 1 and 10000 USDC' })
  }

  const config = getServerConfig()
  let built
  try {
    built = await buildTopUpTransaction({
      connection: getSolanaConnection(),
      sender: wallet,
      recipient: config.solanaTreasury,
      usdcMint: config.usdcMint,
      amountBase,
    })
  } catch (err) {
    // @solana/pay throws "insufficient funds" (on the error or its cause) when
    // the sender cannot cover the transfer; surface it as a typed 402.
    if (isInsufficientFunds(err)) {
      throw createError({ statusCode: 402, statusMessage: 'Insufficient funds', data: { code: 'insufficient_funds' } })
    }
    throw err
  }

  const id = crypto.randomUUID()
  await createIntent(getPool(), {
    id,
    wallet,
    amountBase,
    reference: built.reference,
    recipient: config.solanaTreasury,
    mint: config.usdcMint,
    blockhash: built.blockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
  })
  return { intentId: id, transactionBase64: built.transactionBase64 }
})
