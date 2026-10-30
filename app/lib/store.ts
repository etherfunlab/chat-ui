import Dexie, { type Table } from 'dexie'
import type { ChatUsageEvent, Citation } from '#shared/chat'

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

function looksLikeSession(v: unknown): v is StoredSession & { messages: StoredMessage[] } {
  return isObj(v) && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.model === 'string'
    && typeof v.createdAt === 'number' && typeof v.updatedAt === 'number' && Array.isArray(v.messages)
}

function looksLikeMessage(v: unknown): v is StoredMessage {
  return isObj(v) && typeof v.id === 'string' && (v.role === 'user' || v.role === 'assistant')
    && typeof v.text === 'string' && typeof v.createdAt === 'number'
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
      let imported = 0
      let copied = 0
      await db.transaction('rw', db.sessions, db.messages, async () => {
        for (const raw of file.sessions as unknown[]) {
          if (!looksLikeSession(raw)) continue
          const { messages, ...rest } = raw
          const exists = (await db.sessions.get(rest.id)) !== undefined
          const sessionId = exists ? crypto.randomUUID() : rest.id
          await db.sessions.put({ ...rest, id: sessionId, wallet, title: exists ? `${rest.title} (copy)` : rest.title })
          for (const m of messages) {
            if (!looksLikeMessage(m)) continue
            await db.messages.put({ ...m, id: exists ? crypto.randomUUID() : m.id, sessionId })
          }
          if (exists) copied++
          else imported++
        }
      })
      return { imported, copied }
    },
  }
}
