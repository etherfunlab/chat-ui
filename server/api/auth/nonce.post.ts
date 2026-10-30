import bs58 from 'bs58'
import { buildSignInMessage, isValidSolanaAddress } from '#shared/siws'
import { assertSameOrigin } from '#server/utils/sameOrigin'
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
  await getPool().query(
    `INSERT INTO auth_nonces (nonce, wallet, issued_at, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')`,
    [nonce, body.wallet, issuedAt],
  )

  const domain = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).host
  const message = buildSignInMessage({ domain, address: body.wallet, nonce, issuedAt })
  return { message, nonce }
})
