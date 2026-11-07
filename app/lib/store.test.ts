import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { ZERO_USAGE } from '#shared/billing'
import { createStore, MAX_IMPORT_SESSIONS, type ChatStore, type StoredMessage, type StoredSession } from './store'

let store: ChatStore
let n = 0

const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  id: `s${++n}`,
  wallet: 'W',
  title: 'Fees',
  model: 'claude-opus-5-5',
  systemPrompt: null,
  thinking: { enabled: true, effort: 'high' },
  webSearch: false,
  createdAt: 1000 + n,
  updatedAt: 1000 + n,
  ...over,
})

const message = (sessionId: string, over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: `m${++n}`,
  sessionId,
  role: 'user',
  text: 'hello',
  images: [],
  reasoning: '',
  reasoningMs: null,
  citations: [],
  usage: null,
  status: 'done',
  error: null,
  omittedImages: 0,
  model: 'claude-opus-5-5',
  createdAt: 2000 + n,
  ...over,
})

beforeEach(() => {
  store = createStore(`test-${++n}`)
})

describe('store', () => {
  it('partitions sessions by wallet, newest first', async () => {
    await store.putSession(session({ id: 'a', updatedAt: 1 }))
    await store.putSession(session({ id: 'b', updatedAt: 5 }))
    await store.putSession(session({ id: 'x', wallet: 'OTHER' }))
    expect((await store.listSessions('W')).map(s => s.id)).toEqual(['b', 'a'])
    expect((await store.listSessions('OTHER')).map(s => s.id)).toEqual(['x'])
  })

  it('lists messages oldest first and deletes them with their session', async () => {
    await store.putSession(session({ id: 's' }))
    await store.putMessage(message('s', { id: 'm2', createdAt: 20 }))
    await store.putMessage(message('s', { id: 'm1', createdAt: 10 }))
    expect((await store.listMessages('s')).map(m => m.id)).toEqual(['m1', 'm2'])
    await store.deleteSession('s')
    expect(await store.getSession('s')).toBeUndefined()
    expect(await store.listMessages('s')).toEqual([])
  })

  it('stores settings per wallet', async () => {
    await store.setSetting('W', 'systemPrompt', 'Be brief.')
    expect(await store.getSetting('W', 'systemPrompt')).toBe('Be brief.')
    expect(await store.getSetting('OTHER', 'systemPrompt')).toBeUndefined()
  })
})

describe('export / import', () => {
  it('round-trips an export including images, usage and citations', async () => {
    await store.putSession(session({ id: 's', title: 'Round trip' }))
    await store.putMessage(message('s', { id: 'u', images: ['data:image/jpeg;base64,AAAA'] }))
    await store.putMessage(message('s', {
      id: 'a', role: 'assistant', text: 'answer', reasoning: 'why',
      citations: [{ title: 'A', url: 'https://a.example' }],
      usage: { usage: { ...ZERO_USAGE, inputTokens: 5 }, costMicro: '12' },
    }))
    const file = await store.exportSessions('W')
    expect(file).toMatchObject({ format: 'chat-ui-export', version: 1 })

    const other = createStore(`test-${++n}`)
    expect(await other.importSessions('W2', JSON.parse(JSON.stringify(file)))).toEqual({ imported: 1, copied: 0 })
    const [s] = await other.listSessions('W2')
    expect(s).toMatchObject({ id: 's', wallet: 'W2', title: 'Round trip' })
    const msgs = await other.listMessages('s')
    expect(msgs.map(m => m.id)).toEqual(['u', 'a'])
    expect(msgs[0]!.images).toEqual(['data:image/jpeg;base64,AAAA'])
    expect(msgs[1]!.usage?.costMicro).toBe('12')
  })

  it('exports only the chosen sessions', async () => {
    await store.putSession(session({ id: 'keep' }))
    await store.putSession(session({ id: 'skip' }))
    const file = await store.exportSessions('W', ['keep'])
    expect(file.sessions.map(s => s.id)).toEqual(['keep'])
  })

  it('imports an existing id as a copy, never overwriting', async () => {
    await store.putSession(session({ id: 's', title: 'Mine' }))
    await store.putMessage(message('s', { id: 'm', text: 'original' }))
    const file = await store.exportSessions('W')
    file.sessions[0]!.title = 'Theirs'
    file.sessions[0]!.messages[0]!.text = 'changed'

    expect(await store.importSessions('W', file)).toEqual({ imported: 0, copied: 1 })
    const sessions = await store.listSessions('W')
    expect(sessions).toHaveLength(2)
    expect((await store.getSession('s'))!.title).toBe('Mine')
    expect((await store.listMessages('s'))[0]!.text).toBe('original')
    const copy = sessions.find(s => s.id !== 's')!
    expect(copy.title).toBe('Theirs (copy)')
    const copied = await store.listMessages(copy.id)
    expect(copied.map(m => m.text)).toEqual(['changed'])
    expect(copied[0]!.id).not.toBe('m')
  })

  it('never overwrites existing messages, even when a new session reuses their ids', async () => {
    await store.putSession(session({ id: 'mine' }))
    await store.putMessage(message('mine', { id: 'shared-id', text: 'original' }))
    const file = { format: 'chat-ui-export', version: 1, exportedAt: 'x', sessions: [{
      ...session({ id: 'theirs' }), messages: [message('theirs', { id: 'shared-id', text: 'hostile' })],
    }] }
    await store.importSessions('W', file)
    expect((await store.listMessages('mine'))[0]).toMatchObject({ id: 'shared-id', text: 'original' })
    expect((await store.listMessages('theirs')).map(m => m.text)).toEqual(['hostile'])
  })

  it('sanitizes imported fields: remote images, unsafe citations, broken shapes', async () => {
    const file = { format: 'chat-ui-export', version: 1, exportedAt: 'x', sessions: [{
      ...session({ id: 'imp' }), thinking: 'garbage', webSearch: 'yes',
      messages: [
        message('imp', { id: 'a', images: ['https://evil.example/p.png', 'data:image/png;base64,AA', 'data:text/html,x'] as never }),
        { ...message('imp', { id: 'b', role: 'assistant' }), citations: [{ title: 't', url: 'javascript:alert(1)' }, { title: 'ok', url: 'https://ok.example' }, 'junk'], usage: { costMicro: 'x' }, status: 'weird' },
      ],
    }] }
    await store.importSessions('W', file)
    const s = (await store.getSession('imp'))!
    expect(s.thinking).toEqual({ enabled: true, effort: null })
    expect(s.webSearch).toBe(false)
    const [a, b] = await store.listMessages('imp')
    expect(a!.images).toEqual(['data:image/png;base64,AA'])
    expect(b!.citations).toEqual([{ title: 'ok', url: 'https://ok.example' }])
    expect(b!.usage).toBeNull()
    expect(b!.status).toBe('done')
  })

  it('rejects an import with more sessions than the limit', async () => {
    const sessions = Array.from({ length: MAX_IMPORT_SESSIONS + 1 }, (_, i) => ({ ...session({ id: `bulk${i}` }), messages: [] }))
    await expect(store.importSessions('W', { format: 'chat-ui-export', version: 1, exportedAt: 'x', sessions })).rejects.toThrow()
  })

  it('rejects a file of another format or version', async () => {
    await expect(store.importSessions('W', { format: 'something-else', version: 1, sessions: [] })).rejects.toThrow()
    await expect(store.importSessions('W', { format: 'chat-ui-export', version: 2, sessions: [] })).rejects.toThrow()
    await expect(store.importSessions('W', 'not an object')).rejects.toThrow()
  })

  it('skips malformed sessions inside a valid file', async () => {
    const file = { format: 'chat-ui-export', version: 1, exportedAt: 'x', sessions: [{ ...session({ id: 'ok' }), messages: [] }, { nope: true }] }
    expect(await store.importSessions('W', file)).toEqual({ imported: 1, copied: 0 })
  })
})
