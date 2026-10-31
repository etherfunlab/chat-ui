import Dexie, { type Table } from 'dexie'
import type { ChatUsageEvent, Citation } from '#shared/chat'
import { safeHttpUrl } from '#shared/url'

export interface ThinkingPref {
  enabled: boolean
  effort: string | null
}

export interface StoredSession {
  id: string
  wallet: string
  title: string
  model: string
  systemPrompt: string | null
  thinking: ThinkingPref
  webSearch: boolean
  createdAt: number
  updatedAt: number
}

export interface StoredMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  text: string
  /** Image data URLs (user messages). */
  images: string[]
  reasoning: string
  reasoningMs: number | null
  citations: Citation[]
  usage: ChatUsageEvent | null
  status: 'done' | 'streaming' | 'aborted' | 'error'
  error: string | null
  /** Images not sent with the last request (body limit or model without vision). */
  omittedImages: number
  model: string
  createdAt: number
}

interface StoredSetting {
  wallet: string
  key: string
  value: string
}

/** Import limits: a crafted file must not exhaust the browser. */
export const MAX_IMPORT_SESSIONS = 5_000
export const MAX_IMPORT_MESSAGES = 20_000
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024

export interface ExportFile {
  format: 'chat-ui-export'
  version: 1
  exportedAt: string
  sessions: (StoredSession & { messages: StoredMessage[] })[]
}

export interface ChatStore {
  listSessions(wallet: string): Promise<StoredSession[]>
  getSession(id: string): Promise<StoredSession | undefined>
  putSession(s: StoredSession): Promise<void>
  deleteSession(id: string): Promise<void>
  listMessages(sessionId: string): Promise<StoredMessage[]>
  putMessage(m: StoredMessage): Promise<void>
  getSetting(wallet: string, key: string): Promise<string | undefined>
  setSetting(wallet: string, key: string, value: string): Promise<void>
  exportSessions(wallet: string, ids?: string[]): Promise<ExportFile>
  importSessions(wallet: string, file: unknown): Promise<{ imported: number, copied: number }>
}

class ChatDb extends Dexie {
  sessions!: Table<StoredSession, string>
  messages!: Table<StoredMessage, string>
  settings!: Table<StoredSetting, [string, string]>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      sessions: 'id, wallet, [wallet+updatedAt]',
      messages: 'id, sessionId, [sessionId+createdAt]',
      settings: '[wallet+key]',
    })
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const STATUSES = new Set(['done', 'aborted', 'error'])
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null)
const nonNegative = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** An imported file is untrusted: rebuild each record field by field. */
function sanitizeSession(v: unknown): (Omit<StoredSession, 'wallet'> & { messages: unknown[] }) | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.model !== 'string' || !Array.isArray(v.messages)) return null
  const th = isObj(v.thinking) ? v.thinking : null
  return {
    id: v.id,
    title: str(v.title, ''),
    model: v.model,
    systemPrompt: strOrNull(v.systemPrompt),
    thinking: th && typeof th.enabled === 'boolean'
      ? { enabled: th.enabled, effort: strOrNull(th.effort) }
      : { enabled: true, effort: null },
    webSearch: v.webSearch === true,
    createdAt: nonNegative(v.createdAt),
    updatedAt: nonNegative(v.updatedAt),
    messages: v.messages,
  }
}

function sanitizeUsage(v: unknown): ChatUsageEvent | null {
  if (!isObj(v) || !isObj(v.usage) || typeof v.costMicro !== 'string' || !/^\d+$/.test(v.costMicro)) return null
  const u = v.usage
  return {
    costMicro: v.costMicro,
    usage: {
      inputTokens: nonNegative(u.inputTokens),
      cachedInputTokens: nonNegative(u.cachedInputTokens),
      cacheWriteTokens: nonNegative(u.cacheWriteTokens),
      outputTokens: nonNegative(u.outputTokens),
      reasoningTokens: nonNegative(u.reasoningTokens),
      webSearch: u.webSearch === true,
    },
  }
}

function sanitizeMessage(v: unknown, sessionModel: string): Omit<StoredMessage, 'sessionId'> | null {
  if (!isObj(v) || typeof v.id !== 'string' || (v.role !== 'user' && v.role !== 'assistant') || typeof v.text !== 'string') {
    return null
  }
  const images = Array.isArray(v.images)
    // Only embedded images: a remote URL would be fetched (and forwarded upstream) on its own.
    ? v.images.filter((i): i is string => typeof i === 'string' && i.startsWith('data:image/'))
    : []
  const citations = Array.isArray(v.citations)
    ? v.citations.flatMap((c) => {
        const url = isObj(c) ? safeHttpUrl(c.url) : null
        return isObj(c) && typeof c.title === 'string' && url ? [{ title: c.title, url }] : []
      })
    : []
  return {
    id: v.id,
    role: v.role,
    text: v.text,
    images,
    reasoning: str(v.reasoning, ''),
    reasoningMs: typeof v.reasoningMs === 'number' && v.reasoningMs >= 0 ? v.reasoningMs : null,
    citations,
    usage: sanitizeUsage(v.usage),
    status: typeof v.status === 'string' && STATUSES.has(v.status) ? v.status as StoredMessage['status'] : 'done',
    error: strOrNull(v.error),
    omittedImages: nonNegative(v.omittedImages),
    model: str(v.model, sessionModel),
    createdAt: nonNegative(v.createdAt),
  }
}

/**
 * Conversations live only in this browser (IndexedDB), partitioned by wallet.
 * Export writes a self-contained JSON (images inline); import never
 * overwrites: an id that already exists is saved as a copy.
 */
export function createStore(dbName = 'chat-ui'): ChatStore {
  const db = new ChatDb(dbName)

  return {
    async listSessions(wallet) {
      const rows = await db.sessions.where('[wallet+updatedAt]')
        .between([wallet, Dexie.minKey], [wallet, Dexie.maxKey]).toArray()
      return rows.reverse()
    },
    getSession: id => db.sessions.get(id),
    async putSession(s) {
      await db.sessions.put(s)
    },
    async deleteSession(id) {
      await db.transaction('rw', db.sessions, db.messages, async () => {
        await db.messages.where('sessionId').equals(id).delete()
        await db.sessions.delete(id)
      })
    },
    listMessages: sessionId => db.messages.where('[sessionId+createdAt]')
      .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey]).toArray(),
    async putMessage(m) {
      await db.messages.put(m)
    },
    async getSetting(wallet, key) {
      return (await db.settings.get([wallet, key]))?.value
    },
    async setSetting(wallet, key, value) {
      await db.settings.put({ wallet, key, value })
    },

    async exportSessions(wallet, ids) {
      const all = await this.listSessions(wallet)
      const chosen = ids ? all.filter(s => ids.includes(s.id)) : all
      const sessions = await Promise.all(chosen.map(async s => ({ ...s, messages: await this.listMessages(s.id) })))
      return { format: 'chat-ui-export', version: 1, exportedAt: new Date().toISOString(), sessions }
    },

    async importSessions(wallet, file) {
      if (!isObj(file) || file.format !== 'chat-ui-export' || file.version !== 1 || !Array.isArray(file.sessions)) {
        throw new Error('Not a chat-ui export file')
      }
      if (file.sessions.length > MAX_IMPORT_SESSIONS) throw new Error('Too many chats in one file')
      let imported = 0
      let copied = 0
      await db.transaction('rw', db.sessions, db.messages, async () => {
        for (const raw of file.sessions as unknown[]) {
          const s = sanitizeSession(raw)
          if (!s) continue
          const { messages, ...rest } = s
          if (messages.length > MAX_IMPORT_MESSAGES) throw new Error('Too many messages in one chat')
          const exists = (await db.sessions.get(rest.id)) !== undefined
          const sessionId = exists ? crypto.randomUUID() : rest.id
          await db.sessions.put({ ...rest, id: sessionId, wallet, title: exists ? `${rest.title} (copy)` : rest.title })
          for (const rawMessage of messages) {
            const m = sanitizeMessage(rawMessage, rest.model)
            if (!m) continue
            // Never overwrite: an id already taken (in any chat) gets a fresh one.
            const taken = (await db.messages.get(m.id)) !== undefined
            await db.messages.put({ ...m, id: taken ? crypto.randomUUID() : m.id, sessionId })
          }
          if (exists) copied++
          else imported++
        }
      })
      return { imported, copied }
    },
  }
}
