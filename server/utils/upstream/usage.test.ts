import { describe, it, expect } from 'vitest'
import { citationsFromChat, reportedCostMicro, usageFromChat } from './usage'

describe('usageFromChat', () => {
  it('maps every usage field', () => {
    expect(usageFromChat({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 300,
        prompt_tokens_details: { cached_tokens: 600, cache_creation_input_tokens: 200 },
        completion_tokens_details: { reasoning_tokens: 120 },
      },
    })).toEqual({
      inputTokens: 1000, cachedInputTokens: 600, cacheWriteTokens: 200,
      outputTokens: 300, reasoningTokens: 120, webSearch: false,
    })
  })

  it('treats missing details as zero', () => {
    expect(usageFromChat({ usage: { prompt_tokens: 5, completion_tokens: 7, prompt_tokens_details: null } })).toEqual({
      inputTokens: 5, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 7, reasoningTokens: 0, webSearch: false,
    })
  })

  it('returns null without usage', () => {
    expect(usageFromChat({ choices: [] })).toBeNull()
    expect(usageFromChat(null)).toBeNull()
    expect(usageFromChat({ usage: { prompt_tokens: 'x' } })).toBeNull()
  })
})

describe('reportedCostMicro', () => {
  it('converts usd + diem to micro-USD exactly, rounding down', () => {
    expect(reportedCostMicro({ cost: { usd: 0.00042, diem: 0 } })).toBe(420)
    expect(reportedCostMicro({ cost: { usd: 0.1, diem: 0.2 } })).toBe(300000)
    expect(reportedCostMicro({ cost: { usd: 0.0000015, diem: 0 } })).toBe(1)
    expect(reportedCostMicro({ cost: { usd: 0, diem: 0.05 } })).toBe(50000)
  })

  it('returns null when cost is missing or invalid', () => {
    expect(reportedCostMicro({})).toBeNull()
    expect(reportedCostMicro({ cost: { usd: -1, diem: 0 } })).toBeNull()
    expect(reportedCostMicro({ cost: { usd: 'x' } })).toBeNull()
    expect(reportedCostMicro({ cost: { usd: Number.NaN, diem: 0 } })).toBeNull()
  })

  it('accepts a cost with only usd', () => {
    expect(reportedCostMicro({ cost: { usd: 0.002 } })).toBe(2000)
  })
})

describe('citationsFromChat', () => {
  it('keeps citations with a title and url', () => {
    expect(citationsFromChat({
      venice_parameters: { web_search_citations: [
        { title: 'Solana fees', url: 'https://solana.com/docs/core/fees', content: '…', date: '2026-10-01' },
        { title: 'no url' },
        { url: 'https://no-title.example' },
      ] },
    })).toEqual([{ title: 'Solana fees', url: 'https://solana.com/docs/core/fees' }])
  })

  it('returns an empty list when absent', () => {
    expect(citationsFromChat({})).toEqual([])
  })
})
