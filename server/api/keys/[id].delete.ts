import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { getPool } from '#server/utils/db'
import { revokeApiKey } from '#server/utils/apiKeys'

/** Revokes one of the signed-in wallet's keys. Revocation takes effect on the next /v1 request. */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const wallet = await requireWallet(event)
  const id = getRouterParam(event, 'id') ?? ''
  return { revoked: await revokeApiKey(getPool(), wallet, id) }
})
