import type { Usage } from '#shared/billing'
import type { Citation } from '#shared/chat'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)

/** Upstream chat-completions usage → Usage. `webSearch` is decided by the caller. */
export function usageFromChat(payload: unknown): Usage | null {
  if (!isObj(payload) || !isObj(payload.usage)) return null
  const u = payload.usage
  if (typeof u.prompt_tokens !== 'number' || typeof u.completion_tokens !== 'number') return null
  const prompt = isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : {}
  const completion = isObj(u.completion_tokens_details) ? u.completion_tokens_details : {}
  return {
    inputTokens: count(u.prompt_tokens),
    cachedInputTokens: count(prompt.cached_tokens),
    cacheWriteTokens: count(prompt.cache_creation_input_tokens),
    outputTokens: count(u.completion_tokens),
    reasoningTokens: count(completion.reasoning_tokens),
    webSearch: false,
  }
}

/** A non-negative USD amount in 1e-12 units, read from its decimal rendering (no float drift). */
function usdToPico12(v: unknown): bigint | null {
  if (v === undefined) return 0n
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  const [whole, frac = ''] = v.toFixed(12).split('.')
  return BigInt(whole!) * 1_000_000_000_000n + BigInt(frac.padEnd(12, '0').slice(0, 12))
}

/**
 * What the upstream says it charged for this request (`cost.usd + cost.diem`,
 * both USD-equivalent, search fees included), in micro-USD rounded down;
 * null when the response does not report it.
 */
export function reportedCostMicro(payload: unknown): number | null {
  if (!isObj(payload) || !isObj(payload.cost)) return null
  const usd = usdToPico12(payload.cost.usd)
  const diem = usdToPico12(payload.cost.diem)
  if (usd === null || diem === null || (payload.cost.usd === undefined && payload.cost.diem === undefined)) return null
  return Number((usd + diem) / 1_000_000n)
}

/** Web-search citations attached to a response (the first chunk, when streaming). */
export function citationsFromChat(payload: unknown): Citation[] {
  if (!isObj(payload) || !isObj(payload.venice_parameters)) return []
  const list = payload.venice_parameters.web_search_citations
  if (!Array.isArray(list)) return []
  return list.flatMap(c => (isObj(c) && typeof c.title === 'string' && typeof c.url === 'string'
    ? [{ title: c.title, url: c.url }]
    : []))
}
