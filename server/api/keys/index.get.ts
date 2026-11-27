import { requireWallet } from '#server/utils/session'
import { getPool } from '#server/utils/db'
import { listApiKeys } from '#server/utils/apiKeys'

/** The signed-in wallet's API keys, revoked ones included; never the keys themselves. */
export default defineEventHandler(async (event) => {
  const wallet = await requireWallet(event)
  return { keys: await listApiKeys(getPool(), wallet) }
})
