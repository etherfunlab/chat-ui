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
  PUBLIC_ORIGIN: '',
}

beforeEach(() => {
  for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v)
})

describe('getServerConfig', () => {
  it('defaults: billing on, markup 0, search fee 10000 micro, no public origin', () => {
    const c = getServerConfig()
    expect(c.billing).toBe('on')
    expect(c.markupBps).toBe(0)
    expect(c.searchFeeMicro).toBe(10000)
    expect(c.publicOrigin).toBeUndefined()
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

  it('parses BILLING case-insensitively and rejects other values', () => {
    vi.stubEnv('BILLING', 'OFF')
    vi.stubEnv('ALLOWED_WALLETS', 'W1')
    expect(getServerConfig().billing).toBe('off')
    vi.stubEnv('BILLING', 'false')
    expect(() => getServerConfig()).toThrow(/BILLING/)
  })

  it('requires DATABASE_URL, SESSION_SECRET and VENICE_API_KEY', () => {
    vi.stubEnv('DATABASE_URL', '')
    expect(() => getServerConfig()).toThrow(/DATABASE_URL/)
    vi.stubEnv('DATABASE_URL', 'postgres://x')
    vi.stubEnv('VENICE_API_KEY', '')
    expect(() => getServerConfig()).toThrow(/VENICE_API_KEY/)
  })

  it('rejects a short or placeholder SESSION_SECRET', () => {
    vi.stubEnv('SESSION_SECRET', 'too-short')
    expect(() => getServerConfig()).toThrow(/SESSION_SECRET/)
    // The placeholder once shipped in .env.example is in public git history.
    vi.stubEnv('SESSION_SECRET', 'change-me-to-a-random-string-of-32+')
    expect(() => getServerConfig()).toThrow(/SESSION_SECRET/)
  })

  it('rejects junk, percent signs and negatives in money knobs', () => {
    for (const bad of ['10%', 'abc', '-0.1']) {
      vi.stubEnv('PRICE_MARKUP', bad)
      expect(() => getServerConfig(), `PRICE_MARKUP=${bad}`).toThrow(/PRICE_MARKUP/)
    }
    vi.stubEnv('PRICE_MARKUP', '0.1')
    vi.stubEnv('SEARCH_FEE_USD', 'free')
    expect(() => getServerConfig()).toThrow(/SEARCH_FEE_USD/)
  })

  it('normalizes PUBLIC_ORIGIN to an origin and rejects junk', () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://chat.example.com/some/path')
    expect(getServerConfig().publicOrigin).toBe('https://chat.example.com')
    vi.stubEnv('PUBLIC_ORIGIN', 'not a url')
    expect(() => getServerConfig()).toThrow(/PUBLIC_ORIGIN/)
  })
})
