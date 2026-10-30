import type { H3Event } from 'h3'
import { getServerConfig } from './config'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function useAppSession(event: H3Event) {
  return useSession<{ wallet?: string }>(event, {
    name: 'cu_session',
    password: getServerConfig().sessionSecret,
    maxAge: SESSION_MAX_AGE_SECONDS,
    cookie: { httpOnly: true, secure: true, sameSite: 'lax' },
  })
}

export async function getSessionWallet(event: H3Event): Promise<string | null> {
  const session = await useAppSession(event)
  return session.data.wallet ?? null
}

export async function requireWallet(event: H3Event): Promise<string> {
  const wallet = await getSessionWallet(event)
  if (!wallet) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return wallet
}
