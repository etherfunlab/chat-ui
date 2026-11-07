import type { Usage } from '#shared/billing'
import type { PriceTier, Pricing } from '#shared/models'

/** Flat estimate per image part; the upstream bills images by tokens, not URL bytes. */
export const IMAGE_TOKENS = 1600
/** The smallest useful completion; a hold below this refuses the request. */
export const MIN_OUTPUT_TOKENS = 1024

// Exact arithmetic: prices (micro-USD per token) are scaled to integer
// "pico" units (1e-6 micro-USD) and everything runs in BigInt, so the only
// rounding is one final floor — the user is never charged a fraction more.
const PICO = 1_000_000n
const BPS = 10_000n

/**
 * Price → pico units, truncating digits past the 6th decimal (never rounding
 * the price up). Read from the decimal rendering, not price × 1e6, so a price
 * like 0.57 (569999.99… in binary) keeps its exact value.
 */
function pico(price: number): bigint {
  const [whole, frac = ''] = price.toFixed(12).split('.')
  return BigInt(whole!) * PICO + BigInt(frac.slice(0, 6))
}

function tierFor(p: Pricing, inputTokens: number): PriceTier {
  return p.extended && inputTokens > p.extended.threshold ? p.extended : p
}

function rawPico(p: Pricing, u: Usage, searchFeeMicro: number): bigint {
  const t = tierFor(p, u.inputTokens)
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens - u.cacheWriteTokens)
  let total = BigInt(uncached) * pico(t.input)
    + BigInt(u.cachedInputTokens) * pico(t.cacheInput ?? t.input)
    + BigInt(u.cacheWriteTokens) * pico(t.cacheWrite ?? t.input)
    + BigInt(u.outputTokens) * pico(t.output)
  if (u.webSearch) total += BigInt(searchFeeMicro) * PICO
  return total
}

/** floor(micro × (1 + markup)) — for an upstream-reported cost. */
export function applyMarkup(micro: number, markupBps: number): number {
  return Number((BigInt(micro) * (BPS + BigInt(markupBps))) / BPS)
}

/** floor((upstream cost + search fee) × (1 + markup)), in micro-USD. */
export function costMicro(p: Pricing, u: Usage, o: { markupBps: number, searchFeeMicro: number }): number {
  const scaled = rawPico(p, u, o.searchFeeMicro) * (BPS + BigInt(o.markupBps))
  return Number(scaled / (PICO * BPS))
}

/**
 * Token estimate used to size holds: ~4 ASCII characters per token, and every
 * non-ASCII code point (CJK, emoji…) at least one token. Under-counting is the
 * unsafe direction here — settle charges actual usage, so a short hold means
 * an overdraft — hence CJK is not lumped into bytes/4.
 */
export function estimateTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (const ch of text) {
    if (ch.codePointAt(0)! < 0x80) ascii++
    else other++
  }
  return Math.ceil(ascii / 4) + other
}

/**
 * Walks a request payload the way the upstream serializes it into the prompt:
 * object keys, strings, numbers and booleans all count (tool schemas are mostly
 * keys and numbers); image parts count IMAGE_TOKENS each and their URL bytes not at all.
 */
export function estimateInputTokens(payload: unknown): number {
  if (typeof payload === 'string') return estimateTokens(payload)
  if (typeof payload === 'number' || typeof payload === 'boolean') return estimateTokens(String(payload))
  if (Array.isArray(payload)) return payload.reduce<number>((n, v) => n + estimateInputTokens(v), 0)
  if (typeof payload === 'object' && payload !== null) {
    const obj = payload as Record<string, unknown>
    if (obj.type === 'image_url' || obj.type === 'input_image') return IMAGE_TOKENS
    let n = 0
    for (const [k, v] of Object.entries(obj)) n += estimateTokens(k) + estimateInputTokens(v)
    return n
  }
  return 0
}

interface HoldInput {
  pricing: Pricing
  inputTokens: number
  webSearch: boolean
  markupBps: number
  searchFeeMicro: number
}

/** want: full max output; min: the smallest useful completion. */
export function computeHold(o: HoldInput & { maxOutputTokens: number }): { wantMicro: number, minMicro: number } {
  const at = (outputTokens: number) => costMicro(
    o.pricing,
    { inputTokens: o.inputTokens, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens, reasoningTokens: 0, webSearch: o.webSearch },
    o,
  )
  return { wantMicro: at(o.maxOutputTokens), minMicro: at(Math.min(MIN_OUTPUT_TOKENS, o.maxOutputTokens)) }
}

/** Output tokens a (possibly capped) hold can pay for after input and search. */
export function affordableOutputTokens(o: HoldInput & { holdMicro: number }): number {
  const markup = BPS + BigInt(o.markupBps)
  const fixed = rawPico(
    o.pricing,
    { inputTokens: o.inputTokens, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearch: o.webSearch },
    o.searchFeeMicro,
  )
  const remaining = BigInt(o.holdMicro) * PICO * BPS - fixed * markup
  const perToken = pico(tierFor(o.pricing, o.inputTokens).output) * markup
  if (remaining < 0n) return 0
  if (perToken === 0n) return Number.MAX_SAFE_INTEGER
  return Number(remaining / perToken)
}
