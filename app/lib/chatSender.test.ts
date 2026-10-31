import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fixture from '../../server/utils/__fixtures__/venice-models.json'
import { toModelEntry } from '../../server/utils/catalog'
import type { ModelEntry } from '#shared/models'
import { createStore, type ChatStore, type StoredSession } from './store'
import { createChatSender } from './chatSender'
import { ChatApiError } from './chatStream'
import { BODY_LIMIT_BYTES } from './chatRequest'

const OPUS = toModelEntry(fixture.data.find(m => m.id === 'claude-opus-5-5'))! as ModelEntry
let store: ChatStore
let n = 0
let clock = 0

const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  id: 's', wallet: 'W', title: '', model: OPUS.id, systemPrompt: null,
  thinking: { enabled: true, effort: 'high' }, webSearch: false, createdAt: 0, updatedAt: 0, ...over,
})

function sender(stream: Parameters<typeof createChatSender>[0]['stream']) {
  const refreshMe = vi.fn(async () => {})
  const s = createChatSender({ store, stream, now: () => (clock += 100), newId: () => `id${++n}`, refreshMe, flushMs: 0 })
  return { s, refreshMe }
}

beforeEach(async () => {
  store = createStore(`sender-${++n}`)
  await store.putSession(session())
})

describe('createChatSender', () => {
  it('stores the turn, streams into the answer, and refreshes the balance', async () => {
    const usage = { usage: { inputTokens: 5, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 7, reasoningTokens: 0, webSearch: false }, costMicro: '42' }
    const { s, refreshMe } = sender(async (o) => {
      o.onDelta({ text: '', reasoning: 'think' })
      o.onCitations([{ title: 'A', url: 'https://a.example' }])
      o.onDelta({ text: 'Answer', reasoning: '' })
      o.onUsage(usage)
    })
    const updates: string[] = []
    const answer = await s.send({ session: session(), model: OPUS, text: 'What are fees on Solana?', images: [], systemPrompt: 'Be brief.', signal: new AbortController().signal, onUpdate: m => updates.push(m.status) })

    expect(answer).toMatchObject({ role: 'assistant', status: 'done', text: 'Answer', reasoning: 'think', usage, citations: [{ title: 'A', url: 'https://a.example' }] })
    expect(answer.reasoningMs).toBeGreaterThan(0)
    const stored = await store.listMessages('s')
    expect(stored.map(m => [m.role, m.status])).toEqual([['user', 'done'], ['assistant', 'done']])
    expect(updates.at(-1)).toBe('done')
    expect((await store.getSession('s'))!.title).toBe('What are fees on Solana?')
    expect(refreshMe).toHaveBeenCalled()
  })

  it('sends the system prompt and prior history', async () => {
    let sent: unknown
    const { s } = sender(async (o) => { sent = o.body })
    await s.send({ session: session(), model: OPUS, text: 'first', images: [], systemPrompt: 'Be brief.', signal: new AbortController().signal, onUpdate() {} })
    await s.send({ session: session(), model: OPUS, text: 'second', images: [], systemPrompt: 'Be brief.', signal: new AbortController().signal, onUpdate() {} })
    expect((sent as { messages: { role: string }[] }).messages.map(m => m.role)).toEqual(['system', 'user', 'user'])
  })

  it('keeps the title of a session that already has one', async () => {
    await store.putSession(session({ title: 'Named' }))
    const { s } = sender(async () => {})
    await s.send({ session: session({ title: 'Named' }), model: OPUS, text: 'x', images: [], systemPrompt: null, signal: new AbortController().signal, onUpdate() {} })
    expect((await store.getSession('s'))!.title).toBe('Named')
  })

  it('marks an aborted answer and keeps what was received', async () => {
    const ac = new AbortController()
    const { s } = sender(async (o) => {
      o.onDelta({ text: 'half', reasoning: '' })
      ac.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const answer = await s.send({ session: session(), model: OPUS, text: 'x', images: [], systemPrompt: null, signal: ac.signal, onUpdate() {} })
    expect(answer).toMatchObject({ status: 'aborted', text: 'half', error: null })
  })

  it('records an API error and keeps any received text', async () => {
    const { s } = sender(async () => { throw new ChatApiError(402, 'insufficient_balance', 'Balance too low') })
    const answer = await s.send({ session: session(), model: OPUS, text: 'x', images: [], systemPrompt: null, signal: new AbortController().signal, onUpdate() {} })
    expect(answer).toMatchObject({ status: 'error', error: 'Balance too low' })
  })

  it('refuses a conversation over the body limit without calling the API', async () => {
    const stream = vi.fn()
    const { s } = sender(stream)
    const answer = await s.send({ session: session(), model: OPUS, text: 'x'.repeat(BODY_LIMIT_BYTES), images: [], systemPrompt: null, signal: new AbortController().signal, onUpdate() {} })
    expect(stream).not.toHaveBeenCalled()
    expect(answer.status).toBe('error')
    expect(answer.error).toMatch(/too long/)
  })

  it('does not resurrect a session deleted mid-stream', async () => {
    const { s } = sender(async (o) => {
      o.onDelta({ text: 'partial', reasoning: '' })
      await store.deleteSession('s')
      o.onDelta({ text: ' more', reasoning: '' })
    })
    await s.send({ session: session(), model: OPUS, text: 'x', images: [], systemPrompt: null, signal: new AbortController().signal, onUpdate() {} })
    expect(await store.getSession('s')).toBeUndefined()
    expect(await store.listMessages('s')).toEqual([])
  })

  it('refuses to send into a chat that was deleted', async () => {
    await store.deleteSession('s')
    const stream = vi.fn()
    const { s } = sender(stream)
    await s.send({ session: session(), model: OPUS, text: 'x', images: [], systemPrompt: null, signal: new AbortController().signal, onUpdate() {} })
    expect(stream).not.toHaveBeenCalled()
    expect(await store.getSession('s')).toBeUndefined()
    expect(await store.listMessages('s')).toEqual([])
  })

  it('records how many images a message could not send', async () => {
    const textOnly: ModelEntry = { ...OPUS, vision: false, maxImages: 0 }
    const { s } = sender(async () => {})
    await s.send({ session: session(), model: textOnly, text: 'look', images: ['data:x;base64,AA', 'data:y;base64,BB'], systemPrompt: null, signal: new AbortController().signal, onUpdate() {} })
    const [user] = await store.listMessages('s')
    expect(user!.omittedImages).toBe(2)
  })
})
