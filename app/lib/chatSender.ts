import type { ModelEntry } from '#shared/models'
import { BodyTooLargeError, buildChatRequest } from './chatRequest'
import { ChatApiError, type streamChat } from './chatStream'
import type { ChatStore, StoredMessage, StoredSession } from './store'

export interface SenderDeps {
  store: ChatStore
  stream: typeof streamChat
  now: () => number
  newId: () => string
  refreshMe: () => Promise<void>
  /** Minimum gap between store writes while streaming. */
  flushMs?: number
}

export interface SendInput {
  session: StoredSession
  model: ModelEntry
  text: string
  images: string[]
  /** Already resolved: the session's override, else the global default. */
  systemPrompt: string | null
  signal: AbortSignal
  onUpdate(answer: StoredMessage): void
}

const TITLE_LENGTH = 60

/**
 * One chat turn against the local store: save the user message, build the
 * request within the body limit, stream into a placeholder answer (writing
 * it at most every `flushMs`), and finish it as done / aborted / error.
 */
export function createChatSender(deps: SenderDeps) {
  const flushMs = deps.flushMs ?? 500

  async function send(i: SendInput): Promise<StoredMessage> {
    const { store } = deps
    const history = await store.listMessages(i.session.id)
    const user: StoredMessage = {
      id: deps.newId(), sessionId: i.session.id, role: 'user', text: i.text, images: i.images,
      reasoning: '', reasoningMs: null, citations: [], usage: null, status: 'done', error: null,
      omittedImages: 0, model: i.model.id, createdAt: deps.now(),
    }
    await store.putMessage(user)

    const current = (await store.getSession(i.session.id)) ?? i.session
    const title = current.title || i.text.trim().slice(0, TITLE_LENGTH) || 'Image'
    await store.putSession({ ...current, title, updatedAt: deps.now() })

    const answer: StoredMessage = {
      id: deps.newId(), sessionId: i.session.id, role: 'assistant', text: '', images: [], reasoning: '',
      reasoningMs: null, citations: [], usage: null, status: 'streaming', error: null, omittedImages: 0,
      model: i.model.id, createdAt: deps.now(),
    }

    let built
    try {
      built = buildChatRequest({
        model: i.model, history: [...history, user], systemPrompt: i.systemPrompt,
        thinking: i.session.thinking, webSearch: i.session.webSearch,
      })
    } catch (err) {
      if (!(err instanceof BodyTooLargeError)) throw err
      Object.assign(answer, { status: 'error', error: err.message })
      await store.putMessage(answer)
      i.onUpdate({ ...answer })
      return answer
    }
    for (const m of [...history, user]) {
      const count = built.omittedCounts[m.id] ?? 0
      if (count !== m.omittedImages) await store.putMessage({ ...m, omittedImages: count })
    }

    await store.putMessage(answer)
    i.onUpdate({ ...answer })

    const started = deps.now()
    let reasoningEnded: number | null = null
    let lastFlush = 0
    const flush = (force = false) => {
      const t = deps.now()
      if (!force && t - lastFlush < flushMs) return
      lastFlush = t
      store.putMessage({ ...answer }).catch(() => {})
    }

    try {
      await deps.stream({
        body: built.body,
        signal: i.signal,
        onDelta: (d) => {
          answer.reasoning += d.reasoning
          if (d.text) {
            if (answer.reasoning && reasoningEnded === null) reasoningEnded = deps.now()
            answer.text += d.text
          }
          i.onUpdate({ ...answer })
          flush()
        },
        onCitations: (c) => {
          answer.citations = c
        },
        onUsage: (u) => {
          answer.usage = u
        },
      })
      answer.status = 'done'
    } catch (err) {
      if (i.signal.aborted) {
        answer.status = 'aborted'
      } else {
        answer.status = 'error'
        answer.error = err instanceof ChatApiError ? err.message : 'The answer could not be completed. Try again.'
      }
    }

    if (answer.reasoning) answer.reasoningMs = (reasoningEnded ?? deps.now()) - started
    await store.putMessage({ ...answer })
    const latest = (await store.getSession(i.session.id)) ?? current
    await store.putSession({ ...latest, updatedAt: deps.now() })
    i.onUpdate({ ...answer })
    await deps.refreshMe().catch(() => {})
    return answer
  }

  return { send }
}
