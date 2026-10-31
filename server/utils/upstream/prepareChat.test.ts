import { describe, it, expect } from 'vitest'
import fixture from '../__fixtures__/venice-models.json'
import { toModelEntry } from '../catalog'
import type { ModelEntry } from '#shared/models'
import { prepareChat } from './prepareChat'
import { RelayError } from './errors'

const models = fixture.data.map(m => toModelEntry(m)!) as ModelEntry[]
const OPUS = 'claude-opus-5-5'
const GEMINI = 'gemini-4-argon'
const DEEPSEEK = 'deepseek-v4-1-flash-1017-uncensored'

const msg = (content: unknown = 'hi', role = 'user') => ({ role, content })
const base = (over: Record<string, unknown> = {}) => ({ model: OPUS, messages: [msg()], ...over })

function rejects(body: unknown, code: string, status = 400) {
  try {
    prepareChat(body, models)
  } catch (e) {
    expect(e).toBeInstanceOf(RelayError)
    expect(e).toMatchObject({ status, code })
    return
  }
  throw new Error(`expected ${code}`)
}

describe('prepareChat — validation', () => {
  it('rejects an unknown model', () => rejects(base({ model: 'nope' }), 'model_not_found'))
  it('rejects a non-string model without throwing anything else', () => {
    rejects(base({ model: { toString: null } }), 'model_not_found')
    rejects(base({ model: 42 }), 'model_not_found')
  })
  it('rejects a non-object body, empty messages and unknown roles', () => {
    rejects('x', 'invalid_request')
    rejects(base({ messages: [] }), 'invalid_request')
    rejects(base({ messages: [msg('x', 'robot')] }), 'invalid_request')
  })
  it('rejects n > 1', () => rejects(base({ n: 2 }), 'invalid_request'))
  it('rejects a non-positive max_tokens', () => rejects(base({ max_tokens: 0 }), 'invalid_request'))
  it('rejects images for a model without vision', () => {
    const textOnly = models.map(m => (m.id === OPUS ? { ...m, vision: false, maxImages: 0 } : m))
    expect(() => prepareChat(base({ messages: [msg([{ type: 'image_url', image_url: { url: 'data:x' } }])] }), textOnly))
      .toThrow(expect.objectContaining({ code: 'model_not_vision' }))
  })
  it('rejects more images than the model allows', () => {
    const two = [{ type: 'image_url', image_url: { url: 'data:a' } }, { type: 'image_url', image_url: { url: 'data:b' } }]
    rejects(base({ model: GEMINI, messages: [msg(two)] }), 'too_many_images')
  })
})

describe('prepareChat — shaping', () => {
  it('keeps only allowed fields and drops fallbacks, user and metadata', () => {
    const p = prepareChat(base({ temperature: 0.2, user: 'u', metadata: { a: 1 }, fallbacks: [{ model: 'x' }], top_k: 5 }), models)
    expect(p.upstreamBody).toMatchObject({ model: OPUS, temperature: 0.2 })
    for (const k of ['user', 'metadata', 'fallbacks', 'top_k', 'max_tokens']) expect(p.upstreamBody).not.toHaveProperty(k)
  })

  it('passes cache_control on content parts untouched', () => {
    const content = [{ type: 'text', text: 'long context', cache_control: { type: 'ephemeral' } }]
    const p = prepareChat(base({ messages: [msg(content, 'system'), msg()] }), models)
    expect((p.upstreamBody.messages as unknown[])[0]).toEqual({ role: 'system', content })
  })

  it('rebuilds venice_parameters: no Venice system prompt, web search on/off/auto only', () => {
    const p = prepareChat(base({ venice_parameters: { enable_web_search: 'on', enable_web_citations: true, character_slug: 'x' } }), models)
    expect(p.upstreamBody.venice_parameters).toEqual({ include_venice_system_prompt: false, enable_web_search: 'on', enable_web_citations: true })
    expect(p.webSearch).toBe('on')
    const q = prepareChat(base({ venice_parameters: { enable_web_search: 'sometimes' } }), models)
    expect(q.webSearch).toBe('off')
  })

  it('forces web search off for a model without it', () => {
    const noSearch = models.map(m => (m.id === OPUS ? { ...m, webSearch: false } : m))
    const p = prepareChat(base({ venice_parameters: { enable_web_search: 'on' } }), noSearch)
    expect(p.webSearch).toBe('off')
    expect((p.upstreamBody.venice_parameters as Record<string, unknown>).enable_web_search).toBe('off')
  })

  it('normalizes reasoning.effort to reasoning_effort', () => {
    const p = prepareChat(base({ reasoning: { effort: 'high' } }), models)
    expect(p.upstreamBody.reasoning_effort).toBe('high')
    expect(p.upstreamBody).not.toHaveProperty('reasoning')
  })

  it('rejects minimal for opus and accepts none only where thinking can be disabled', () => {
    rejects(base({ reasoning_effort: 'minimal' }), 'invalid_reasoning_effort')
    rejects(base({ reasoning_effort: 'none' }), 'invalid_reasoning_effort')
    expect(prepareChat(base({ model: DEEPSEEK, reasoning_effort: 'none' }), models).upstreamBody.reasoning_effort).toBe('none')
  })

  it('drops reasoning_effort for a model without effort control', () => {
    const p = prepareChat(base({ model: GEMINI, reasoning_effort: 'high', reasoning: { effort: 'high' } }), models)
    expect(p.upstreamBody).not.toHaveProperty('reasoning_effort')
    expect(p.upstreamBody).not.toHaveProperty('reasoning')
  })

  it('forces usage into the stream and remembers whether the client asked', () => {
    const p = prepareChat(base({ stream: true }), models)
    expect(p.stream).toBe(true)
    expect(p.upstreamBody.stream_options).toEqual({ include_usage: true })
    expect(p.clientWantsUsage).toBe(false)
    expect(prepareChat(base({ stream: true, stream_options: { include_usage: true } }), models).clientWantsUsage).toBe(true)
    expect(prepareChat(base(), models).upstreamBody).not.toHaveProperty('stream_options')
  })

  it('derives requestedMaxOut, capped at the model maximum', () => {
    expect(prepareChat(base(), models).requestedMaxOut).toBe(128000)
    expect(prepareChat(base({ max_tokens: 500 }), models).requestedMaxOut).toBe(500)
    expect(prepareChat(base({ max_completion_tokens: 900, max_tokens: 500 }), models).requestedMaxOut).toBe(900)
    expect(prepareChat(base({ max_tokens: 10_000_000 }), models).requestedMaxOut).toBe(128000)
  })

  it('passes tools and tool_choice through for agent clients', () => {
    const tools = [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }]
    const p = prepareChat(base({ tools, tool_choice: 'auto', messages: [msg(), { role: 'tool', tool_call_id: 't1', content: 'ok' }] }), models)
    expect(p.upstreamBody.tools).toEqual(tools)
    expect(p.upstreamBody.tool_choice).toBe('auto')
  })
})
