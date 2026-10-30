import bs58 from 'bs58'
import { buildSignInMessage, isValidSolanaAddress } from '#shared/siws'
import { assertSameOrigin } from '#server/utils/sameOrigin'
import { getAppUrl } from '#server/utils/appOrigin'
import { insertNonce } from '#server/utils/authNonces'
import { getPool } from '#server/utils/db'

interface Body {
  wallet: string
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readBody<Body>(event)
  if (!body?.wallet || !isValidSolanaAddress(body.wallet)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid wallet' })
  }

  const nonce = bs58.encode(crypto.getRandomValues(new Uint8Array(32)))
  // issued_at is inserted explicitly (not DEFAULT now()) so verify can rebuild
  // the exact signed message from the stored row.
  const issuedAt = new Date().toISOString()
  await insertNonce(getPool(), { nonce, wallet: body.wallet, issuedAt })

  const domain = getAppUrl(event).host
  const message = buildSignInMessage({ domain, address: body.wallet, nonce, issuedAt })
  return { message, nonce, issuedAt }
})
