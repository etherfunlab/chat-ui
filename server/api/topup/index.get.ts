import { requireWallet } from '#server/utils/session'
import { assertBillingOn } from '#server/utils/billingGate'
import { getPool } from '#server/utils/db'
import { listIntents } from '#server/utils/topups'

export default defineEventHandler(async (event) => {
  assertBillingOn()
  const wallet = await requireWallet(event)
  return { intents: await listIntents(getPool(), wallet, 50) }
})
