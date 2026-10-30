import { describe, it, expect } from 'vitest'
import fixture from '../../server/utils/__fixtures__/venice-models.json'
import { toModelEntry } from '../../server/utils/catalog'
import type { ModelEntry } from '#shared/models'
import type { ChatImagePart, ChatTextPart } from '#shared/chat'
import type { StoredMessage } from './store'
import { BodyTooLargeError, BODY_LIMIT_BYTES, buildChatRequest, IMAGE_OMITTED } from './chatRequest'
import { reasoningEffortFor, thinkingFor } from './thinking'
import { fitWithin } from './images'

const model = (id: string) => toModelEntry(fixture.data.find(m => m.id === id))! as ModelEntry
const OPUS = model('claude-opus-5-5')
const GEMINI = model('gemini-4-argon')
const DEEPSEEK = model('deepseek-v4-1-flash-1017-uncensored')
const NO_VISION: ModelEntry = { ...OPUS, vision: false, maxImages: 0 }

let n = 0
const msg = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: `m${++n}`, sessionId: 's', role: 'user', text: 'hi', images: [], reasoning: '', reasoningMs: null,
  citations: [], usage: null, status: 'done', error: null, omittedImages: 0, model: OPUS.id, createdAt: n, ...over,
})
const img = (mb: number) => `data:image/jpeg;base64,${'A'.repeat(Math.round(mb * 1_000_000))}`
const build = (history: StoredMessage[], over: Partial<Parameters<typeof buildChatRequest>[0]> = {}) =>
  buildChatRequest({ model: OPUS, history, systemPrompt: null, thinking: { enabled: true, effort: 'high' }, webSearch: false, ...over })

const partsOf = (content: unknown) => (Array.isArray(content) ? content as (ChatTextPart | ChatImagePart)[] : [])
const imagesIn = (body: ReturnType<typeof build>['body']) =>
  body.messages.flatMap(m => partsOf(m.content).filter((p): p is ChatImagePart => p.type === 'image_url'))

describe('thinking preferences', () => {
  it('defaults to on at the model default effort', () => {
    expect(thinkingFor(OPUS, null)).toEqual({ enabled: true, effort: 'medium' })
    expect(thinkingFor(DEEPSEEK, null)).toEqual({ enabled: true, effort: 'high' })
  })

  it('forces thinking on for a model that cannot disable it', () => {
    expect(thinkingFor(OPUS, { enabled: false, effort: 'high' })).toEqual({ enabled: true, effort: 'high' })
    expect(thinkingFor(DEEPSEEK, { enabled: false, effort: 'low' })).toEqual({ enabled: false, effort: 'low' })
  })

  it('falls back to the default when the effort is not offered', () => {
    expect(thinkingFor(DEEPSEEK, { enabled: true, effort: 'xhigh' })).toEqual({ enabled: true, effort: 'high' })
  })

  it('maps preferences to reasoning_effort', () => {
    expect(reasoningEffortFor(OPUS, { enabled: true, effort: 'max' })).toBe('max')
    expect(reasoningEffortFor(DEEPSEEK, { enabled: false, effort: 'low' })).toBe('none')
    expect(reasoningEffortFor(OPUS, { enabled: false, effort: 'low' })).toBe('low')
    expect(reasoningEffortFor(GEMINI, { enabled: true, effort: null })).toBeUndefined()
  })
})

describe('buildChatRequest', () => {
  it('puts a non-empty system prompt first', () => {
    expect(build([msg()], { systemPrompt: 'Be brief.' }).body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' })
    expect(build([msg()], { systemPrompt: '   ' }).body.messages[0]!.role).toBe('user')
  })

  it('skips error and streaming messages, keeps aborted answers with text', () => {
    const body = build([
      msg({ text: 'q1' }),
      msg({ role: 'assistant', text: 'partial', status: 'aborted' }),
      msg({ text: 'q2' }),
      msg({ role: 'assistant', text: '', status: 'error', error: 'boom' }),
      msg({ text: 'q3' }),
      msg({ role: 'assistant', text: '', status: 'streaming' }),
    ]).body
    expect(body.messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'q1'], ['assistant', 'partial'], ['user', 'q2'], ['user', 'q3'],
    ])
  })

  it('sends assistant text without its reasoning', () => {
    const body = build([msg(), msg({ role: 'assistant', text: 'answer', reasoning: 'private thoughts' })]).body
    expect(JSON.stringify(body)).not.toContain('private thoughts')
  })

  it('sets reasoning_effort, web search and stream', () => {
    const body = build([msg()], { webSearch: true, thinking: { enabled: true, effort: 'xhigh' } }).body
    expect(body).toMatchObject({
      model: OPUS.id, stream: true, reasoning_effort: 'xhigh',
      venice_parameters: { enable_web_search: 'on', enable_web_citations: true },
    })
    expect(build([msg()]).body.venice_parameters).toEqual({ enable_web_search: 'off', enable_web_citations: false })
  })

  it('drops the oldest images first when over the byte limit', () => {
    const history = [msg({ id: 'old', images: [img(1.6)] }), msg({ id: 'mid', images: [img(1.6)] }), msg({ id: 'new', images: [img(1.6)] })]
    const { body, omittedImageMessageIds } = build(history)
    expect(imagesIn(body)).toHaveLength(2)
    expect(omittedImageMessageIds).toEqual(['old'])
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThanOrEqual(BODY_LIMIT_BYTES)
    expect(JSON.stringify(body.messages[0])).toContain(IMAGE_OMITTED)
  })

  it('keeps only the newest maxImages images', () => {
    const history = [msg({ id: 'a', images: ['data:x;base64,AA'] }), msg({ id: 'b', images: ['data:y;base64,BB'] })]
    const { body, omittedImageMessageIds } = build(history, { model: GEMINI })
    expect(imagesIn(body).map(p => p.image_url.url)).toEqual(['data:y;base64,BB'])
    expect(omittedImageMessageIds).toEqual(['a'])
  })

  it('replaces images for a non-vision model', () => {
    const { body, omittedImageMessageIds } = build([msg({ id: 'p', text: 'look', images: ['data:x;base64,AA'] })], { model: NO_VISION })
    expect(imagesIn(body)).toHaveLength(0)
    expect(body.messages[0]!.content).toBe(`look\n${IMAGE_OMITTED}`)
    expect(omittedImageMessageIds).toEqual(['p'])
  })

  it('throws when text alone exceeds the limit', () => {
    expect(() => build([msg({ text: 'x'.repeat(BODY_LIMIT_BYTES) })])).toThrow(BodyTooLargeError)
  })

  it('never truncates text', () => {
    const long = '长'.repeat(100_000)
    const { body } = build([msg({ text: long, images: [img(3)] }), msg({ images: [img(3)] })])
    expect(JSON.stringify(body)).toContain(long)
  })
})

describe('fitWithin', () => {
  it('scales the long edge down to the limit and never up', () => {
    expect(fitWithin(4000, 3000, 1568)).toEqual({ width: 1568, height: 1176 })
    expect(fitWithin(1000, 3000, 1568)).toEqual({ width: 523, height: 1568 })
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 })
  })
})
