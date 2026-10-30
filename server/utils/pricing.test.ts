import { describe, it, expect } from 'vitest'
import { ZERO_USAGE } from '#shared/billing'
import type { Pricing } from '#shared/models'
import {
  affordableOutputTokens, computeHold, costMicro, estimateInputTokens, estimateTokens,
  IMAGE_TOKENS, MIN_OUTPUT_TOKENS,
} from './pricing'

const opus: Pricing = { input: 4, output: 20, cacheInput: 0.2, cacheWrite: 5 }
const sol: Pricing = { input: 2, output: 10, extended: { threshold: 272000, input: 4, output: 15 } }
const none = { markupBps: 0, searchFeeMicro: 10000 }

describe('costMicro', () => {
  it('prices plain usage', () => {
    const u = { ...ZERO_USAGE, inputTokens: 1000, outputTokens: 500 }
    expect(costMicro(opus, u, none)).toBe(14000)
    expect(costMicro(opus, u, { ...none, markupBps: 1000 })).toBe(15400)
  })

  it('prices cache reads and writes', () => {
    const u = { ...ZERO_USAGE, inputTokens: 10000, cachedInputTokens: 8000, cacheWriteTokens: 1000 }
    expect(costMicro(opus, u, none)).toBe(10600)
  })

  it('falls back to the input price when cache prices are missing', () => {
    const u = { ...ZERO_USAGE, inputTokens: 100, cachedInputTokens: 100 }
    expect(costMicro({ input: 3, output: 9 }, u, none)).toBe(300)
  })

  it('switches whole request to the extended tier above threshold', () => {
    expect(costMicro(sol, { ...ZERO_USAGE, inputTokens: 300000, outputTokens: 1000 }, none)).toBe(1215000)
    expect(costMicro(sol, { ...ZERO_USAGE, inputTokens: 272000, outputTokens: 1000 }, none)).toBe(554000)
  })

  it('adds the search fee before markup', () => {
    const u = { ...ZERO_USAGE, inputTokens: 1000, outputTokens: 500, webSearch: true }
    expect(costMicro(opus, u, { markupBps: 1000, searchFeeMicro: 10000 })).toBe(26400)
  })

  it('rounds down fractional micro-USD', () => {
    expect(costMicro({ input: 0.33, output: 1.32 }, { ...ZERO_USAGE, inputTokens: 1 }, none)).toBe(0)
  })

  it('computes exactly without float drift', () => {
    // 0.29 * 100 is 28.999999999999996 in float; the true cost is 29.
    expect(costMicro({ input: 0.29, output: 0 }, { ...ZERO_USAGE, inputTokens: 100 }, none)).toBe(29)
    // 0.00825/M with +10%: 1000 tokens → 9.075 → 9
    expect(costMicro({ input: 0.00825, output: 0 }, { ...ZERO_USAGE, inputTokens: 1000 }, { ...none, markupBps: 1000 })).toBe(9)
  })

  it('floors sub-micro price precision instead of rounding the price up', () => {
    // 0.0000015 USD/M × 1M tokens = 1.5 micro-USD → 1, not 2
    expect(costMicro({ input: 0.0000015, output: 0 }, { ...ZERO_USAGE, inputTokens: 1_000_000 }, none)).toBe(1)
    // a price that is not exactly representable in binary must not lose a unit
    expect(costMicro({ input: 0.57, output: 0 }, { ...ZERO_USAGE, inputTokens: 1 }, none)).toBe(0)
    expect(costMicro({ input: 0.57, output: 0 }, { ...ZERO_USAGE, inputTokens: 100 }, none)).toBe(57)
  })

  it('never goes negative when cached counts exceed input', () => {
    const u = { ...ZERO_USAGE, inputTokens: 10, cachedInputTokens: 50 }
    expect(costMicro(opus, u, none)).toBe(10) // 50 cached * 0.2, uncached clamps to 0
  })
})

describe('estimates', () => {
  it('counts every non-ASCII code point as at least one token (holds must not under-count CJK)', () => {
    expect(estimateTokens('你好世界你好世界')).toBe(8)
    expect(estimateTokens('hello 你好')).toBe(2 + 2) // ceil(6 ASCII bytes / 4) + 2
    expect(estimateTokens('😀')).toBe(1)
  })

  it('estimates CJK and images', () => {
    expect(estimateTokens('你好')).toBe(2)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('')).toBe(0)
    const big = `data:image/png;base64,${'A'.repeat(1_000_000)}`
    const payload = {
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'hello world' },
        { type: 'image_url', image_url: { url: big } },
      ] }],
    }
    const t = estimateInputTokens(payload)
    expect(t).toBeGreaterThanOrEqual(IMAGE_TOKENS)
    expect(t).toBeLessThan(IMAGE_TOKENS + 100)
  })

  it('counts object keys and numbers, so tool schemas cannot slip past the hold', () => {
    const small = { tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object', properties: {} } } }] }
    const enumValues = Array.from({ length: 5000 }, (_, i) => 100000 + i)
    const big = { tools: [{ type: 'function', function: { name: 'f', parameters: {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`property_name_number_${i}`, { type: 'integer', minimum: 0 }])),
      enum: enumValues,
    } } }] }
    // 5000 six-digit numbers alone are ≥ 5000 × ceil(6/4) tokens
    expect(estimateInputTokens(big) - estimateInputTokens(small)).toBeGreaterThan(5000 * 2)
  })

  it('counts Responses-style input_image parts as images', () => {
    const payload = { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:x;base64,AAAA' }] }] }
    const t = estimateInputTokens(payload)
    expect(t).toBeGreaterThanOrEqual(IMAGE_TOKENS)
    expect(t).toBeLessThan(IMAGE_TOKENS + 20)
  })
})

describe('holds', () => {
  it('sizes want and min holds', () => {
    const h = computeHold({ pricing: opus, inputTokens: 1000, maxOutputTokens: 128000, webSearch: false, ...none })
    expect(h).toEqual({ wantMicro: 4000 + 128000 * 20, minMicro: 4000 + MIN_OUTPUT_TOKENS * 20 })
  })

  it('includes the search fee in both holds', () => {
    const h = computeHold({ pricing: opus, inputTokens: 0, maxOutputTokens: 10, webSearch: true, ...none })
    expect(h).toEqual({ wantMicro: 10000 + 200, minMicro: 10000 + 200 })
  })

  it('derives affordable output tokens from a capped hold', () => {
    expect(affordableOutputTokens({ holdMicro: 14000, pricing: opus, inputTokens: 1000, webSearch: false, ...none }))
      .toBe(500)
    expect(affordableOutputTokens({ holdMicro: 14000, pricing: opus, inputTokens: 1000, webSearch: false, markupBps: 1000, searchFeeMicro: 0 }))
      .toBe(436) // (14000 - 4400) / 22
    expect(affordableOutputTokens({ holdMicro: 100, pricing: opus, inputTokens: 1000, webSearch: false, ...none }))
      .toBe(0)
  })

  it('does not cap output for a model with free output', () => {
    expect(affordableOutputTokens({ holdMicro: 1, pricing: { input: 0, output: 0 }, inputTokens: 1000, webSearch: false, ...none }))
      .toBe(Number.MAX_SAFE_INTEGER)
  })
})
