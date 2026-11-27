import { assertSameOrigin } from '#server/utils/sameOrigin'
import { requireWallet } from '#server/utils/session'
import { getPool } from '#server/utils/db'
import { createApiKey } from '#server/utils/apiKeys'
import { RelayError } from '#server/utils/upstream/errors'

/** Creates an API key. The plaintext is in this response and nowhere else. */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const wallet = await requireWallet(event)
  const body = await readBody<{ name?: unknown }>(event)
  if (typeof body?.name !== 'string') throw createError({ statusCode: 400, statusMessage: 'invalid_key_name' })
  try {
    return await createApiKey(getPool(), wallet, body.name)
  } catch (e) {
    if (e instanceof RelayError) throw createError({ statusCode: e.status, statusMessage: e.code })
    throw e
  }
})
