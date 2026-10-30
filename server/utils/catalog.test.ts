import { describe, it, expect, vi } from 'vitest'
import fixture from './__fixtures__/venice-models.json'
import { createCatalog, toModelEntry } from './catalog'

const raw = (id: string) => fixture.data.find(m => m.id === id)!

describe('toModelEntry', () => {
  it('maps opus reasoning options without none', () => {
    const m = toModelEntry(raw('claude-opus-5-5'))!
    expect(m).toMatchObject({
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      vision: true,
      maxImages: 10,
      webSearch: true,
      reasoning: {
        supported: true,
        effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'medium',
        canDisable: false,
      },
    })
    expect(m.pricing).toEqual({ input: 4, output: 20, cacheInput: 0.2, cacheWrite: 5 })
  })

  it('marks deepseek as able to disable thinking', () => {
    const m = toModelEntry(raw('deepseek-v4-1-flash-1017-uncensored'))!
    expect(m.reasoning).toEqual({
      supported: true,
      effortOptions: ['low', 'high', 'max'],
      defaultEffort: 'high',
      canDisable: true,
    })
  })

  it('gemini has no effort control and one image', () => {
    const m = toModelEntry(raw('gemini-4-argon'))!
    expect(m.reasoning).toEqual({ supported: true, effortOptions: [], defaultEffort: null, canDisable: false })
    expect(m.maxImages).toBe(1)
    expect(m.pricing).toEqual({ input: 2.5, output: 12.5, cacheInput: 0.125 })
  })

  it('keeps the extended tier for gpt-61-sol', () => {
    const m = toModelEntry(raw('openai-gpt-61-sol'))!
    expect(m.pricing.extended).toEqual({ threshold: 272000, input: 4, output: 15, cacheInput: 0.2, cacheWrite: 5 })
  })

  it('falls back to the first effort when the upstream default is none', () => {
    const r = structuredClone(raw('deepseek-v4-1-flash-1017-uncensored'))
    r.model_spec.capabilities.defaultReasoningEffort = 'none'
    expect(toModelEntry(r)!.reasoning.defaultEffort).toBe('low')
  })

  it('rejects negative prices (a charge must never become a credit)', () => {
    const r = structuredClone(raw('claude-opus-5-5'))
    r.model_spec.pricing.output.usd = -20
    expect(toModelEntry(r)).toBeNull()
    const c = structuredClone(raw('claude-opus-5-5'))
    c.model_spec.pricing.cache_input!.usd = -1
    expect(toModelEntry(c)).toBeNull()
  })

  it('returns null for malformed entries', () => {
    expect(toModelEntry(null)).toBeNull()
    expect(toModelEntry({ id: 'x' })).toBeNull()
    expect(toModelEntry({ id: 'x', model_spec: { pricing: { input: {}, output: {} } } })).toBeNull()
  })
})

describe('createCatalog', () => {
  it('returns models in configured order and skips unknown ids', async () => {
    const c = createCatalog({
      fetchModels: async () => fixture,
      modelIds: ['openai-gpt-61-sol', 'nope', 'claude-opus-5-5'],
    })
    expect((await c.list()).map(m => m.id)).toEqual(['openai-gpt-61-sol', 'claude-opus-5-5'])
    expect((await c.get('claude-opus-5-5'))?.name).toBe('Claude Opus 5.5')
    expect(await c.get('nope')).toBeUndefined()
  })

  it('caches for the TTL and refetches after it', async () => {
    let t = 0
    const fetchModels = vi.fn(async () => fixture)
    const c = createCatalog({ fetchModels, modelIds: ['claude-opus-5-5'], ttlMs: 1000, now: () => t })
    await c.list()
    t = 999
    await c.list()
    expect(fetchModels).toHaveBeenCalledTimes(1)
    t = 1001
    await c.list()
    expect(fetchModels).toHaveBeenCalledTimes(2)
  })

  it('serves stale cache when refresh fails', async () => {
    let t = 0
    const fetchModels = vi.fn()
      .mockResolvedValueOnce(fixture)
      .mockRejectedValueOnce(new Error('upstream down'))
    const c = createCatalog({ fetchModels, modelIds: ['claude-opus-5-5'], ttlMs: 10, now: () => t })
    await c.list()
    t = 100
    expect((await c.list()).map(m => m.id)).toEqual(['claude-opus-5-5'])
  })

  it('keeps the last good list when a refresh parses to nothing', async () => {
    let t = 0
    const fetchModels = vi.fn()
      .mockResolvedValueOnce(fixture)
      .mockResolvedValueOnce({ data: [] })
    const c = createCatalog({ fetchModels, modelIds: ['claude-opus-5-5'], ttlMs: 10, now: () => t })
    await c.list()
    t = 100
    expect((await c.list()).map(m => m.id)).toEqual(['claude-opus-5-5'])
  })

  it('throws when it has never loaded', async () => {
    const c = createCatalog({ fetchModels: async () => { throw new Error('down') }, modelIds: ['x'] })
    await expect(c.list()).rejects.toThrow(/model catalog unavailable/)
  })
})
