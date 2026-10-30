import type { H3Event } from 'h3'
import { getServerConfig } from './config'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function useAppSession(event: H3Event) {
  return useSession<{ wallet?: string }>(event, {
    name: 'cu_session',
    password: getServerConfig().sessionSecret,
    maxAge: SESSION_MAX_AGE_SECONDS,
    sessionHeader: false, // the session is a cookie, never a request header
    cookie: { httpOnly: true, secure: true, sameSite: 'lax' },
  })
}

export async function getSessionWallet(event: H3Event): Promise<string | null> {
  const session = await useAppSession(event)
  const wallet = session.data.wallet ?? null
  if (!wallet) return null
  // Sealed cookies are stateless, so the BILLING=off whitelist is re-checked
  // on every use: removing a wallet from ALLOWED_WALLETS revokes it now, not
  // in 30 days.
  const config = getServerConfig()
  if (config.billing === 'off' && !config.allowedWallets.has(wallet)) return null
  return wallet
}

export async function requireWallet(event: H3Event): Promise<string> {
  const wallet = await getSessionWallet(event)
  if (!wallet) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return wallet
}
