import { describe, it, expect } from 'vitest'
import fixture from '../__fixtures__/venice-models.json'
import { toModelEntry } from '../catalog'
import type { ModelEntry } from '#shared/models'
import { prepareResponses } from './prepareResponses'
import { RelayError } from './errors'

const models = fixture.data.map(m => toModelEntry(m)!) as ModelEntry[]
const OPUS = 'claude-opus-5-5'
const GEMINI = 'gemini-4-argon'
const DEEPSEEK = 'deepseek-v4-1-flash-1017-uncensored'

const base = (over: Record<string, unknown> = {}) => ({ model: OPUS, input: 'hi', ...over })
const image = { type: 'input_image', image_url: 'data:x' }
const userMsg = (content: unknown) => ({ role: 'user', content })

function rejects(body: unknown, code: string, status = 400) {
  try {
    prepareResponses(body, models)
  } catch (e) {
    expect(e).toBeInstanceOf(RelayError)
    expect(e).toMatchObject({ status, code })
    return
  }
  throw new Error(`expected ${code}`)
}

describe('prepareResponses — validation', () => {
  it('rejects an unknown model and a non-object body', () => {
    rejects(base({ model: 'nope' }), 'model_not_found')
    rejects('x', 'invalid_request')
  })
  it('requires a non-empty string or array input', () => {
    rejects(base({ input: '' }), 'invalid_request')
    rejects(base({ input: [] }), 'invalid_request')
    rejects(base({ input: 5 }), 'invalid_request')
    expect(prepareResponses(base({ input: [userMsg('hi')] }), models).upstreamBody.input).toEqual([userMsg('hi')])
  })
  it('rejects stateful and background parameters', () => {
    rejects(base({ previous_response_id: 'r1' }), 'unsupported_parameter')
    rejects(base({ background: true }), 'unsupported_parameter')
    rejects(base({ conversation: 'c1' }), 'unsupported_parameter')
  })
  it('checks images against the model', () => {
    rejects(base({ model: GEMINI, input: [userMsg([image, image])] }), 'too_many_images')
    const textOnly = models.map(m => (m.id === OPUS ? { ...m, vision: false, maxImages: 0 } : m))
    expect(() => prepareResponses(base({ input: [userMsg([image])] }), textOnly))
      .toThrow(expect.objectContaining({ code: 'model_not_vision' }))
  })
  it('validates reasoning.effort against the model', () => {
    rejects(base({ reasoning: { effort: 'minimal' } }), 'invalid_reasoning_effort')
    rejects(base({ reasoning: { effort: 'none' } }), 'invalid_reasoning_effort')
    expect(prepareResponses(base({ model: DEEPSEEK, reasoning: { effort: 'none' } }), models).upstreamBody.reasoning).toEqual({ effort: 'none' })
  })
  it('rejects a non-positive max_output_tokens', () => rejects(base({ max_output_tokens: 0 }), 'invalid_request'))
})

describe('prepareResponses — shaping', () => {
  it('keeps only allowed fields and forces store off', () => {
    const p = prepareResponses(base({
      instructions: 'be brief', temperature: 0.2, include: ['reasoning.encrypted_content'], text: { format: { type: 'text' } },
      store: true, metadata: { a: 1 }, user: 'u', truncation: 'auto', service_tier: 'flex',
    }), models)
    expect(p.upstreamBody).toMatchObject({
      model: OPUS, input: 'hi', instructions: 'be brief', temperature: 0.2, include: ['reasoning.encrypted_content'], store: false,
    })
    for (const k of ['metadata', 'user', 'truncation', 'service_tier']) expect(p.upstreamBody).not.toHaveProperty(k)
  })

  it('passes reasoning.summary through and drops effort for a model without effort control', () => {
    const p = prepareResponses(base({ reasoning: { effort: 'high', summary: 'auto' } }), models)
    expect(p.upstreamBody.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    const q = prepareResponses(base({ model: GEMINI, reasoning: { effort: 'high', summary: 'auto' } }), models)
    expect(q.upstreamBody.reasoning).toEqual({ summary: 'auto' })
  })

  it('rebuilds venice_parameters with only the web search fields', () => {
    const p = prepareResponses(base({ venice_parameters: { enable_web_search: 'auto', enable_web_citations: true, character_slug: 'x' } }), models)
    expect(p.upstreamBody.venice_parameters).toEqual({ include_venice_system_prompt: false, enable_web_search: 'auto', enable_web_citations: true })
    expect(p.webSearch).toBe('auto')
    expect(prepareResponses(base(), models).webSearch).toBe('off')
  })

  it('treats a web_search tool as search on, and forces search off for a model without it', () => {
    const tools = [{ type: 'web_search' }, { type: 'function', name: 'f', parameters: {} }]
    const p = prepareResponses(base({ tools }), models)
    expect(p.webSearch).toBe('on')
    expect(p.upstreamBody.tools).toEqual(tools)
    const noSearch = models.map(m => (m.id === OPUS ? { ...m, webSearch: false } : m))
    expect(prepareResponses(base({ tools, venice_parameters: { enable_web_search: 'on' } }), noSearch).webSearch).toBe('off')
  })

  it('derives requestedMaxOut from max_output_tokens, capped at the model maximum', () => {
    expect(prepareResponses(base(), models).requestedMaxOut).toBe(128000)
    expect(prepareResponses(base({ max_output_tokens: 500 }), models).requestedMaxOut).toBe(500)
    expect(prepareResponses(base({ max_output_tokens: 10_000_000 }), models).requestedMaxOut).toBe(128000)
  })

  it('marks streams and always forwards usage', () => {
    const p = prepareResponses(base({ stream: true }), models)
    expect(p.stream).toBe(true)
    expect(p.clientWantsUsage).toBe(true)
    expect(prepareResponses(base(), models).stream).toBe(false)
  })
})
