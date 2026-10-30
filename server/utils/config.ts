import { isValidSolanaAddress } from '#shared/siws'

export interface ServerConfig {
  billing: 'on' | 'off'
  databaseUrl: string
  sessionSecret: string
  veniceApiKey: string
  veniceBaseUrl: string
  /** Upstream model ids offered, in display order. */
  models: string[]
  allowedWallets: Set<string>
  markupBps: number
  markupExemptWallets: Set<string>
  searchFeeMicro: number
  solanaRpcUrl: string
  solanaTreasury: string
  usdcMint: string
  /** Normalized origin (e.g. "https://chat.example.com") or undefined. */
  publicOrigin?: string
}

const DEFAULT_MODELS = [
  'claude-opus-5-5',
  'deepseek-v4-1-flash-1017-uncensored',
  'grok-4-7',
  'gemini-4-argon',
  'openai-gpt-6-astra-pro',
  'openai-gpt-61-sol',
  'openai-gpt-61-sol-ultrafast',
  'openai-gpt-61-terra',
]

const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** This value once shipped in .env.example; it lives in public git history. */
const BANNED_SECRETS = new Set(['change-me-to-a-random-string-of-32+'])

function splitList(v: string | undefined): Set<string> {
  return new Set((v ?? '').split(',').map(s => s.trim()).filter(Boolean))
}

function isUrl(v: string): boolean {
  try {
    new URL(v)
    return true
  } catch {
    return false
  }
}

/** Markup that applies to a wallet: exempt wallets pay upstream cost as-is. */
export function markupBpsFor(config: ServerConfig, wallet: string): number {
  return config.markupExemptWallets.has(wallet) ? 0 : config.markupBps
}

/** Parses a decimal knob and scales it to a non-negative safe integer. */
function parseScaled(name: string, raw: string | undefined, fallback: string, scale: number): number {
  const text = raw?.trim() || fallback
  const scaled = Math.round(Number(text) * scale)
  if (!Number.isSafeInteger(scaled) || scaled < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`)
  }
  return scaled
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
  } else if (env.NODE_ENV === 'production' && env.VERCEL !== '1') {
    // Without it the signing domain comes from Host / X-Forwarded-* headers,
    // which a phishing relay controls on any self-hosted setup. Vercel routes
    // by Host and overwrites X-Forwarded-Host itself, so it may fall back.
    throw new Error('PUBLIC_ORIGIN is required in production outside Vercel')
  }

  const solanaRpcUrl = env.SOLANA_RPC_URL ?? ''
  const solanaTreasury = env.SOLANA_TREASURY ?? ''
  if (billing === 'on') {
    if (!isUrl(solanaRpcUrl)) throw new Error('BILLING=on requires SOLANA_RPC_URL to be a URL')
    if (!isValidSolanaAddress(solanaTreasury)) {
      throw new Error('BILLING=on requires SOLANA_TREASURY to be a Solana address')
    }
  }

  const models = [...splitList(env.MODELS)]

  return {
    billing,
    databaseUrl: env.DATABASE_URL,
    sessionSecret,
    veniceApiKey: env.VENICE_API_KEY,
    veniceBaseUrl: env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1',
    models: models.length ? models : DEFAULT_MODELS,
    allowedWallets,
    markupBps: parseScaled('PRICE_MARKUP', env.PRICE_MARKUP, '0', 10_000),
    markupExemptWallets: splitList(env.MARKUP_EXEMPT_WALLETS),
    searchFeeMicro: parseScaled('SEARCH_FEE_USD', env.SEARCH_FEE_USD, '0.01', 1_000_000),
    solanaRpcUrl,
    solanaTreasury,
    usdcMint: env.SOLANA_USDC_MINT || MAINNET_USDC_MINT,
    publicOrigin,
  }
}
