import type { Usage } from '#shared/billing'
import type { Citation } from '#shared/chat'
import { safeHttpUrl } from '#shared/url'
import type { StreamEnd } from './protocol'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)

/** The response object: the payload itself, or the one a stream event wraps. */
function responseOf(payload: unknown): Obj | null {
  if (!isObj(payload)) return null
  if (isObj(payload.response)) return payload.response
  return payload.object === 'response' ? payload : null
}

/** Responses-format usage (from a response object or a completed-type event) → Usage. */
export function usageFromResponses(payload: unknown): Usage | null {
  const r = responseOf(payload) ?? (isObj(payload) ? payload : null)
  if (!r || !isObj(r.usage)) return null
  const u = r.usage
  if (typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') return null
  const input = isObj(u.input_tokens_details) ? u.input_tokens_details : {}
  const output = isObj(u.output_tokens_details) ? u.output_tokens_details : {}
  return {
    inputTokens: count(u.input_tokens),
    cachedInputTokens: count(input.cached_tokens),
    cacheWriteTokens: count(input.cache_creation_input_tokens),
    outputTokens: count(u.output_tokens),
    reasoningTokens: count(output.reasoning_tokens),
    webSearch: false,
  }
}

/** url_citation annotations on the output text parts. */
export function citationsFromResponses(payload: unknown): Citation[] {
  const r = responseOf(payload)
  if (!r || !Array.isArray(r.output)) return []
  const out: Citation[] = []
  for (const item of r.output) {
    if (!isObj(item) || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isObj(part) || !Array.isArray(part.annotations)) continue
      for (const a of part.annotations) {
        if (!isObj(a) || a.type !== 'url_citation' || typeof a.title !== 'string') continue
        const url = safeHttpUrl(a.url)
        if (url) out.push({ title: a.title, url })
      }
    }
  }
  return out
}

/**
 * Text the model produced: deltas while streaming, the output items of a
 * non-streamed response. A completed-type event repeats the whole response
 * after its deltas already streamed, so it counts for nothing.
 */
export function outputTextFromResponses(payload: unknown): string {
  if (!isObj(payload)) return ''
  if (typeof payload.type === 'string') {
    return payload.type.endsWith('.delta') && typeof payload.delta === 'string' ? payload.delta : ''
  }
  if (payload.object !== 'response' || !Array.isArray(payload.output)) return ''
  let s = ''
  for (const item of payload.output) {
    if (!isObj(item)) continue
    if (typeof item.arguments === 'string') s += item.arguments
    for (const part of [...(Array.isArray(item.content) ? item.content : []), ...(Array.isArray(item.summary) ? item.summary : [])]) {
      if (isObj(part) && typeof part.text === 'string') s += part.text
    }
  }
  return s
}

const END_BY_STATUS: Record<string, StreamEnd> = { completed: 'ok', incomplete: 'ok', failed: 'failed' }

export function responsesEnd(payload: unknown): StreamEnd {
  if (!isObj(payload)) return 'none'
  if (typeof payload.type === 'string') {
    const m = /^response\.(completed|incomplete|failed)$/.exec(payload.type)
    return m ? END_BY_STATUS[m[1]!]! : 'none'
  }
  if (payload.object === 'response' && typeof payload.status === 'string') return END_BY_STATUS[payload.status] ?? 'none'
  return 'none'
}
