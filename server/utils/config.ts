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
}

function splitList(v: string | undefined): Set<string> {
  return new Set((v ?? '').split(',').map(s => s.trim()).filter(Boolean))
}

/**
 * Reads process.env on every call so values are runtime-true in serverless
 * functions. Throws on inconsistent configuration rather than limping along.
 */
export function getServerConfig(): ServerConfig {
  const env = process.env
  const billing = env.BILLING === 'off' ? 'off' : 'on'
  const allowedWallets = splitList(env.ALLOWED_WALLETS)
  if (billing === 'off' && allowedWallets.size === 0) {
    throw new Error('BILLING=off requires a non-empty ALLOWED_WALLETS')
  }
  return {
    billing,
    databaseUrl: env.DATABASE_URL ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
    veniceApiKey: env.VENICE_API_KEY ?? '',
    allowedWallets,
    markupBps: Math.round(Number.parseFloat(env.PRICE_MARKUP || '0') * 10_000),
    markupExemptWallets: splitList(env.MARKUP_EXEMPT_WALLETS),
    searchFeeMicro: Math.round(Number.parseFloat(env.SEARCH_FEE_USD || '0.01') * 1_000_000),
    solanaRpcUrl: env.SOLANA_RPC_URL ?? '',
    solanaTreasury: env.SOLANA_TREASURY ?? '',
  }
}
