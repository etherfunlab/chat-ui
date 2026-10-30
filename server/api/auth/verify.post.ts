import { buildSignInMessage, isValidSolanaAddress, verifySignInSignature } from '#shared/siws'
import { assertSameOrigin } from '#server/utils/sameOrigin'
import { getAppUrl } from '#server/utils/appOrigin'
import { consumeNonce } from '#server/utils/authNonces'
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
  const consumed = await consumeNonce(pool, body.nonce, body.wallet)
  if (!consumed) throw createError({ statusCode: 401, statusMessage: 'Invalid or expired nonce' })

  const message = buildSignInMessage({
    domain: getAppUrl(event).host,
    address: body.wallet,
    nonce: body.nonce,
    issuedAt: consumed.issuedAt,
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
