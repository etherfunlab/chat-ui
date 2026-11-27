import { walletForKey } from '#server/utils/apiKeys'
import { getCatalog } from '#server/utils/catalog'
import { getServerConfig } from '#server/utils/config'
import { getPool } from '#server/utils/db'
import { errorResponse } from '#server/utils/upstream/errors'
import { bearerHash } from '#server/utils/v1'

/** The offered models in display order, OpenAI list shape. */
export default defineEventHandler(async (event) => {
  const hash = bearerHash(event)
  if (hash instanceof Response) return sendWebResponse(event, hash)
  let wallet: string | null
  try {
    wallet = await walletForKey(getPool(), getServerConfig(), hash)
  } catch {
    return sendWebResponse(event, errorResponse(503, 'ledger_unavailable', 'Billing is unavailable; try again shortly'))
  }
  if (!wallet) return sendWebResponse(event, errorResponse(401, 'invalid_api_key', 'Invalid or revoked API key'))
  let models
  try {
    models = await getCatalog().list()
  } catch {
    return sendWebResponse(event, errorResponse(503, 'catalog_unavailable', 'The model list is unavailable; try again shortly'))
  }
  const body = { object: 'list', data: models.map(m => ({ id: m.id, object: 'model', created: 0, owned_by: 'venice' })) }
  return sendWebResponse(event, new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
})
