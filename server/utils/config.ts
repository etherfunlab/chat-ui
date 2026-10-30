export interface ServerConfig {
  billing: 'on' | 'off'
  databaseUrl: string
  sessionSecret: string
  veniceApiKey: string
  allowedWallets: Set<string>
  markupBps: number
  markupExemptWallets: Set<string>
  searchFeeMicro: number
  solanaRpcUrl: string
  solanaTreasury: string
  /** Normalized origin (e.g. "https://chat.example.com") or undefined. */
  publicOrigin?: string
}

/** This value once shipped in .env.example; it lives in public git history. */
const BANNED_SECRETS = new Set(['change-me-to-a-random-string-of-32+'])

function splitList(v: string | undefined): Set<string> {
  return new Set((v ?? '').split(',').map(s => s.trim()).filter(Boolean))
}

function parseMoney(name: string, raw: string | undefined, fallback: string): number {
  const value = Number(raw || fallback)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`)
  }
  return value
}

/**
 * Reads process.env on every call so values are runtime-true in serverless
 * functions, and fails fast on broken configuration: a deployment that limps
 * along with a guessable secret or a silent billing default is worse than 500s.
 */
export function getServerConfig(): ServerConfig {
  const env = process.env

  const billingRaw = (env.BILLING || 'on').toLowerCase()
  if (billingRaw !== 'on' && billingRaw !== 'off') {
    throw new Error(`BILLING must be "on" or "off", got "${env.BILLING}"`)
  }
  const billing = billingRaw as 'on' | 'off'

  const allowedWallets = splitList(env.ALLOWED_WALLETS)
  if (billing === 'off' && allowedWallets.size === 0) {
    throw new Error('BILLING=off requires a non-empty ALLOWED_WALLETS')
  }

  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  if (!env.VENICE_API_KEY) throw new Error('VENICE_API_KEY is required')
  const sessionSecret = env.SESSION_SECRET ?? ''
  if (sessionSecret.length < 32 || BANNED_SECRETS.has(sessionSecret)) {
    throw new Error('SESSION_SECRET must be a random string of at least 32 characters')
  }

  let publicOrigin: string | undefined
  if (env.PUBLIC_ORIGIN) {
    try {
      publicOrigin = new URL(env.PUBLIC_ORIGIN).origin
    } catch {
      throw new Error(`PUBLIC_ORIGIN must be a URL, got "${env.PUBLIC_ORIGIN}"`)
    }
  }

  return {
    billing,
    databaseUrl: env.DATABASE_URL,
    sessionSecret,
    veniceApiKey: env.VENICE_API_KEY,
    allowedWallets,
    markupBps: Math.round(parseMoney('PRICE_MARKUP', env.PRICE_MARKUP, '0') * 10_000),
    markupExemptWallets: splitList(env.MARKUP_EXEMPT_WALLETS),
    searchFeeMicro: Math.round(parseMoney('SEARCH_FEE_USD', env.SEARCH_FEE_USD, '0.01') * 1_000_000),
    solanaRpcUrl: env.SOLANA_RPC_URL ?? '',
    solanaTreasury: env.SOLANA_TREASURY ?? '',
    publicOrigin,
  }
}
