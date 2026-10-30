import { vi } from 'vitest'

/** A valid base58 32-byte address usable as a treasury in tests. */
export const TEST_TREASURY = 'GsbwXfJraMomNxBcjYLcG3mxkBUiyWXAB32fGbSMQRdW'

/** Stubs a complete, valid server environment; overrides win. */
export function stubValidEnv(overrides: Record<string, string> = {}): void {
  const env: Record<string, string> = {
    BILLING: '',
    DATABASE_URL: 'postgres://localhost/test',
    SESSION_SECRET: 's'.repeat(32),
    VENICE_API_KEY: 'vk',
    ALLOWED_WALLETS: '',
    SOLANA_RPC_URL: 'https://rpc.example.com',
    SOLANA_TREASURY: TEST_TREASURY,
    SOLANA_USDC_MINT: '',
    PRICE_MARKUP: '',
    MARKUP_EXEMPT_WALLETS: '',
    SEARCH_FEE_USD: '',
    PUBLIC_ORIGIN: '',
    MODELS: '',
    VENICE_BASE_URL: '',
    ...overrides,
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}
