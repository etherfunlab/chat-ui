import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getServerConfig } from './config'

const BASE_ENV = {
  BILLING: '',
  DATABASE_URL: 'postgres://x',
  SESSION_SECRET: 's'.repeat(32),
  VENICE_API_KEY: 'vk',
  ALLOWED_WALLETS: '',
  SOLANA_RPC_URL: '',
  SOLANA_TREASURY: '',
  PRICE_MARKUP: '',
  MARKUP_EXEMPT_WALLETS: '',
  SEARCH_FEE_USD: '',
}

beforeEach(() => {
  for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v)
})

describe('getServerConfig', () => {
  it('defaults: billing on, markup 0, search fee 10000 micro', () => {
    const c = getServerConfig()
    expect(c.billing).toBe('on')
    expect(c.markupBps).toBe(0)
    expect(c.searchFeeMicro).toBe(10000)
  })

  it('parses markup decimal to bps', () => {
    vi.stubEnv('PRICE_MARKUP', '0.10')
    expect(getServerConfig().markupBps).toBe(1000)
  })

  it('splits wallet lists and trims', () => {
    vi.stubEnv('MARKUP_EXEMPT_WALLETS', 'A, B')
    const c = getServerConfig()
    expect(c.markupExemptWallets).toEqual(new Set(['A', 'B']))
  })

  it('throws when BILLING=off and ALLOWED_WALLETS empty', () => {
    vi.stubEnv('BILLING', 'off')
    expect(() => getServerConfig()).toThrow(/ALLOWED_WALLETS/)
  })

  it('accepts BILLING=off with a whitelist', () => {
    vi.stubEnv('BILLING', 'off')
    vi.stubEnv('ALLOWED_WALLETS', 'W1,W2')
    const c = getServerConfig()
    expect(c.billing).toBe('off')
    expect(c.allowedWallets).toEqual(new Set(['W1', 'W2']))
  })

  it('parses search fee to micro-USD integer', () => {
    vi.stubEnv('SEARCH_FEE_USD', '0.005')
    expect(getServerConfig().searchFeeMicro).toBe(5000)
  })
})
