import type { ChatRequestBody, ChatUsageEvent, Citation } from '#shared/chat'
import { createSseParser } from '#shared/sse'
import { createThinkSplitter } from '#shared/think'
import { safeHttpUrl } from '#shared/url'

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ChatApiError'
  }
}

export interface StreamOptions {
  body: ChatRequestBody
  signal: AbortSignal
  fetchImpl?: typeof fetch
  onDelta(d: { text: string, reasoning: string }): void
  onCitations(c: Citation[]): void
  onUsage(u: ChatUsageEvent): void
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null

async function toApiError(res: Response): Promise<ChatApiError> {
  let body: unknown
  try {
    body = await res.json()
  } catch {}
  if (isObj(body) && isObj(body.error) && typeof body.error.message === 'string') {
    return new ChatApiError(res.status, String(body.error.code ?? `http_${res.status}`), body.error.message)
  }
  const message = isObj(body) && typeof body.message === 'string' ? body.message : res.statusText || 'Request failed'
  return new ChatApiError(res.status, `http_${res.status}`, message)
}

/**
 * Streams one answer from /api/chat. Reasoning arrives either as
 * `reasoning_content` deltas or as <think> spans inside content; both are
 * routed to `reasoning`. Rejects with ChatApiError on an error response or a
 * stream cut short, or with the abort error when `signal` fires.
 */
export async function streamChat(o: StreamOptions): Promise<void> {
  const res = await (o.fetchImpl ?? fetch)('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(o.body),
    signal: o.signal,
    credentials: 'same-origin',
  })
  if (!res.ok || !res.body) throw await toApiError(res)

  const splitter = createThinkSplitter()
  let citationsSent = false
  let sawDone = false
  const emit = (text: string, reasoning: string) => {
    if (text || reasoning) o.onDelta({ text, reasoning })
  }

  const parser = createSseParser((e) => {
    if (e.event === 'chatui-usage') {
      o.onUsage(JSON.parse(e.data) as ChatUsageEvent)
      return
    }
    if (e.data === '[DONE]') {
      sawDone = true
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(e.data)
    } catch {
      return
    }
    if (!isObj(payload)) return
    if (!citationsSent && isObj(payload.venice_parameters) && Array.isArray(payload.venice_parameters.web_search_citations)) {
      const list = payload.venice_parameters.web_search_citations.flatMap((c) => {
        const url = isObj(c) ? safeHttpUrl(c.url) : null
        return isObj(c) && typeof c.title === 'string' && url ? [{ title: c.title, url }] : []
      })
      if (list.length) {
        o.onCitations(list)
        citationsSent = true
      }
    }
    if (!Array.isArray(payload.choices)) return
    for (const choice of payload.choices) {
      const d = isObj(choice) && isObj(choice.delta) ? choice.delta : null
      if (!d) continue
      let reasoning = typeof d.reasoning_content === 'string' ? d.reasoning_content : ''
      let text = ''
      if (typeof d.content === 'string' && d.content) {
        const split = splitter.push(d.content)
        text += split.text
        reasoning += split.reasoning
      }
      emit(text, reasoning)
    }
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }
  parser.push(decoder.decode())
  parser.end()
  const tail = splitter.end()
  emit(tail.text, tail.reasoning)
  // The server sends [DONE] only after a complete answer is settled; a stream
  // that ends without it was cut short (time limit, provider dropped it).
  if (!sawDone) throw new ChatApiError(0, 'stream_incomplete', 'The answer was cut off before it finished.')
}
