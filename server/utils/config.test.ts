import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getServerConfig, markupBpsFor } from './config'
import { stubValidEnv, TEST_TREASURY } from '../../tests/helpers/env'

beforeEach(() => {
  stubValidEnv()
})

describe('getServerConfig — billing and models', () => {
  it('defaults models to the spec list in order', () => {
    expect(getServerConfig().models).toEqual([
      'claude-opus-5-5',
      'deepseek-v4-1-flash-1017-uncensored',
      'grok-4-7',
      'gemini-4-argon',
      'openai-gpt-6-astra-pro',
      'openai-gpt-61-sol',
      'openai-gpt-61-sol-ultrafast',
      'openai-gpt-61-terra',
    ])
  })

  it('parses MODELS and defaults the Venice base URL and USDC mint', () => {
    vi.stubEnv('MODELS', ' a , b ')
    const c = getServerConfig()
    expect(c.models).toEqual(['a', 'b'])
    expect(c.veniceBaseUrl).toBe('https://api.venice.ai/api/v1')
    expect(c.usdcMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    expect(c.solanaTreasury).toBe(TEST_TREASURY)
  })

  it('requires a valid treasury and RPC URL when billing is on', () => {
    vi.stubEnv('SOLANA_TREASURY', '')
    expect(() => getServerConfig()).toThrow(/SOLANA_TREASURY/)
    vi.stubEnv('SOLANA_TREASURY', 'not-an-address')
    expect(() => getServerConfig()).toThrow(/SOLANA_TREASURY/)
    vi.stubEnv('SOLANA_TREASURY', TEST_TREASURY)
    vi.stubEnv('SOLANA_RPC_URL', '')
    expect(() => getServerConfig()).toThrow(/SOLANA_RPC_URL/)
    vi.stubEnv('SOLANA_RPC_URL', 'not a url')
    expect(() => getServerConfig()).toThrow(/SOLANA_RPC_URL/)
  })

  it('does not require Solana settings when billing is off', () => {
    vi.stubEnv('BILLING', 'off')
    vi.stubEnv('ALLOWED_WALLETS', 'W1')
    vi.stubEnv('SOLANA_TREASURY', '')
    vi.stubEnv('SOLANA_RPC_URL', '')
    expect(getServerConfig().billing).toBe('off')
  })

  it('markupBpsFor exempts listed wallets', () => {
    vi.stubEnv('PRICE_MARKUP', '0.10')
    vi.stubEnv('MARKUP_EXEMPT_WALLETS', 'VIP')
    const c = getServerConfig()
    expect(markupBpsFor(c, 'VIP')).toBe(0)
    expect(markupBpsFor(c, 'someone')).toBe(1000)
  })
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

  it('requires PUBLIC_ORIGIN in production outside Vercel', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL', '')
    expect(() => getServerConfig()).toThrow(/PUBLIC_ORIGIN/)
    vi.stubEnv('PUBLIC_ORIGIN', 'https://chat.example.com')
    expect(getServerConfig().publicOrigin).toBe('https://chat.example.com')
  })

  it('allows a request-derived origin on Vercel and in development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL', '1')
    expect(getServerConfig().publicOrigin).toBeUndefined()
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(getServerConfig().publicOrigin).toBeUndefined()
  })

  it('rejects money knobs that overflow to non-integers', () => {
    vi.stubEnv('PRICE_MARKUP', '1e308')
    expect(() => getServerConfig()).toThrow(/PRICE_MARKUP/)
    vi.stubEnv('PRICE_MARKUP', '0')
    vi.stubEnv('SEARCH_FEE_USD', '1e308')
    expect(() => getServerConfig()).toThrow(/SEARCH_FEE_USD/)
  })

  it('treats whitespace-only money knobs as unset (defaults apply)', () => {
    vi.stubEnv('PRICE_MARKUP', '   ')
    vi.stubEnv('SEARCH_FEE_USD', '  ')
    const c = getServerConfig()
    expect(c.markupBps).toBe(0)
    expect(c.searchFeeMicro).toBe(10000)
  })

  it('normalizes PUBLIC_ORIGIN to an origin and rejects junk', () => {
    vi.stubEnv('PUBLIC_ORIGIN', 'https://chat.example.com/some/path')
    expect(getServerConfig().publicOrigin).toBe('https://chat.example.com')
    vi.stubEnv('PUBLIC_ORIGIN', 'not a url')
    expect(() => getServerConfig()).toThrow(/PUBLIC_ORIGIN/)
  })
})
