import { describe, it, expect } from 'vitest'
import { citationsFromResponses, outputTextFromResponses, responsesEnd, usageFromResponses } from './responsesUsage'

const usage = {
  input_tokens: 100, output_tokens: 20, total_tokens: 120,
  input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 5 },
}

describe('usageFromResponses', () => {
  it('reads a response object, including cached and reasoning tokens', () => {
    expect(usageFromResponses({ object: 'response', usage })).toEqual({
      inputTokens: 100, cachedInputTokens: 30, cacheWriteTokens: 0, outputTokens: 20, reasoningTokens: 5, webSearch: false,
    })
  })
  it('reads the usage carried by a response.completed event', () => {
    expect(usageFromResponses({ type: 'response.completed', response: { usage } })).toMatchObject({ inputTokens: 100, outputTokens: 20 })
  })
  it('returns null for payloads without usage', () => {
    expect(usageFromResponses({ type: 'response.output_text.delta', delta: 'x' })).toBeNull()
    expect(usageFromResponses({ usage: { input_tokens: 'x' } })).toBeNull()
  })
})

describe('citationsFromResponses', () => {
  const output = [{
    type: 'message',
    content: [{
      type: 'output_text', text: 'see',
      annotations: [
        { type: 'url_citation', title: 'A', url: 'https://a.example' },
        { type: 'url_citation', title: 'Bad', url: 'javascript:alert(1)' },
        { type: 'file_citation', title: 'F', url: 'https://f.example' },
      ],
    }],
  }]
  it('collects url citations from the output and drops unsafe urls', () => {
    expect(citationsFromResponses({ object: 'response', output })).toEqual([{ title: 'A', url: 'https://a.example' }])
    expect(citationsFromResponses({ type: 'response.completed', response: { output } })).toHaveLength(1)
    expect(citationsFromResponses({ type: 'response.output_text.delta' })).toEqual([])
  })
})

describe('outputTextFromResponses', () => {
  it('accumulates delta events', () => {
    expect(outputTextFromResponses({ type: 'response.output_text.delta', delta: 'Hel' })).toBe('Hel')
    expect(outputTextFromResponses({ type: 'response.reasoning.delta', delta: 'think' })).toBe('think')
    expect(outputTextFromResponses({ type: 'response.function_call_arguments.delta', delta: '{"a"' })).toBe('{"a"')
    expect(outputTextFromResponses({ type: 'response.created' })).toBe('')
  })
  it('reads a full response object', () => {
    const output = [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan ' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'answer ' }] },
      { type: 'function_call', name: 'f', arguments: '{"x":1}' },
    ]
    expect(outputTextFromResponses({ object: 'response', output })).toBe('plan answer {"x":1}')
    // The completed event carries the whole response; counting it again would double the estimate.
    expect(outputTextFromResponses({ type: 'response.completed', response: { output } })).toBe('')
  })
})

describe('responsesEnd', () => {
  it('maps stream events', () => {
    expect(responsesEnd({ type: 'response.completed' })).toBe('ok')
    expect(responsesEnd({ type: 'response.incomplete' })).toBe('ok')
    expect(responsesEnd({ type: 'response.failed' })).toBe('failed')
    expect(responsesEnd({ type: 'response.output_text.delta' })).toBe('none')
  })
  it('maps a response object by status', () => {
    expect(responsesEnd({ object: 'response', status: 'completed' })).toBe('ok')
    expect(responsesEnd({ object: 'response', status: 'incomplete' })).toBe('ok')
    expect(responsesEnd({ object: 'response', status: 'failed' })).toBe('failed')
    expect(responsesEnd({ object: 'response', status: 'in_progress' })).toBe('none')
  })
})
