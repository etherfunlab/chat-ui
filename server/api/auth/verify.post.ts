import { buildSignInMessage, isValidSolanaAddress, verifySignInSignature } from '#shared/siws'
import { assertSameOrigin } from '#server/utils/sameOrigin'
import { getServerConfig } from '#server/utils/config'
import { getPool } from '#server/utils/db'
import { useAppSession } from '#server/utils/session'

interface Body {
  wallet: string
  nonce: string
  signature: string
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readBody<Body>(event)
  if (!body?.wallet || !body?.nonce || !body?.signature || !isValidSolanaAddress(body.wallet)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }

  const pool = getPool()
  // Atomic consume: replay (used_at) and expiry guards live in this query.
  const { rows } = await pool.query(
    `UPDATE auth_nonces SET used_at = now()
     WHERE nonce = $1 AND wallet = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING issued_at`,
    [body.nonce, body.wallet],
  )
  const row = rows[0] as { issued_at: Date } | undefined
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Invalid or expired nonce' })

  const domain = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).host
  const message = buildSignInMessage({
    domain,
    address: body.wallet,
    nonce: body.nonce,
    issuedAt: new Date(row.issued_at).toISOString(),
  })
  if (!verifySignInSignature({ message, signatureB58: body.signature, address: body.wallet })) {
    throw createError({ statusCode: 401, statusMessage: 'Signature verification failed' })
  }

  const config = getServerConfig()
  if (config.billing === 'off' && !config.allowedWallets.has(body.wallet)) {
    throw createError({ statusCode: 403, statusMessage: 'Wallet not allowed' })
  }

  await pool.query('INSERT INTO accounts (wallet) VALUES ($1) ON CONFLICT DO NOTHING', [body.wallet])
  const session = await useAppSession(event)
  await session.update({ wallet: body.wallet })
  return { wallet: body.wallet }
})
