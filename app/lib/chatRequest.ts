import type { ChatImagePart, ChatMessage, ChatRequestBody, ChatTextPart } from '#shared/chat'
import type { ModelEntry } from '#shared/models'
import type { StoredMessage, ThinkingPref } from './store'
import { reasoningEffortFor } from './thinking'

/** Under the server's 4.5 MB cap, with headroom for headers and encoding. */
export const BODY_LIMIT_BYTES = 4_400_000
export const IMAGE_OMITTED = '[image not sent]'

export class BodyTooLargeError extends Error {
  constructor() {
    super('This conversation is too long to send. Start a new conversation, or export it and trim it.')
    this.name = 'BodyTooLargeError'
  }
}

export interface BuildInput {
  model: ModelEntry
  history: StoredMessage[]
  systemPrompt: string | null
  thinking: ThinkingPref
  webSearch: boolean
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

/**
 * Assembles the /api/chat body from local history. Images are the only thing
 * ever dropped to fit — oldest first, each replaced by a visible placeholder —
 * and only as many as the model accepts are sent; text is never truncated.
 */
export function buildChatRequest(i: BuildInput): { body: ChatRequestBody, omittedImageMessageIds: string[] } {
  const history = i.history.filter(m =>
    (m.status === 'done' || m.status === 'aborted') && (m.text.trim() !== '' || m.images.length > 0))

  // Every image in send order; the newest `maxImages` start out kept.
  const all: { messageId: string, url: string }[] = []
  for (const m of history) if (m.role === 'user') for (const url of m.images) all.push({ messageId: m.id, url })
  const allowed = i.model.vision ? i.model.maxImages : 0
  let kept = all.slice(Math.max(0, all.length - allowed))

  const assemble = () => {
    const keptSet = new Set(kept)
    const omitted = new Set<string>()
    const messages: ChatMessage[] = []
    if (i.systemPrompt?.trim()) messages.push({ role: 'system', content: i.systemPrompt })
    for (const m of history) {
      if (m.role === 'assistant') {
        messages.push({ role: 'assistant', content: m.text })
        continue
      }
      const mine = all.filter(a => a.messageId === m.id)
      const send = mine.filter(a => keptSet.has(a))
      const dropped = mine.length - send.length
      if (dropped > 0) omitted.add(m.id)
      const text = m.text + `\n${IMAGE_OMITTED}`.repeat(dropped)
      messages.push(send.length === 0
        ? { role: 'user', content: text }
        : {
            role: 'user',
            content: [
              { type: 'text', text } satisfies ChatTextPart,
              ...send.map(a => ({ type: 'image_url', image_url: { url: a.url } }) satisfies ChatImagePart),
            ],
          })
    }
    const effort = reasoningEffortFor(i.model, i.thinking)
    const search = i.webSearch && i.model.webSearch
    const body: ChatRequestBody = {
      model: i.model.id,
      messages,
      stream: true,
      ...(effort ? { reasoning_effort: effort } : {}),
      venice_parameters: { enable_web_search: search ? 'on' : 'off', enable_web_citations: search },
    }
    return { body, omittedImageMessageIds: [...omitted] }
  }

  let out = assemble()
  while (bytes(out.body) > BODY_LIMIT_BYTES) {
    if (kept.length === 0) throw new BodyTooLargeError()
    kept = kept.slice(1)
    out = assemble()
  }
  return out
}
