import { ZERO_USAGE, type Usage } from '#shared/billing'
import type { ChatUsageEvent, Citation } from '#shared/chat'
import { createSseParser } from '#shared/sse'
import type { Catalog } from './catalog'
import { markupBpsFor, type ServerConfig } from './config'
import { openCharge, settleCharge } from './ledger'
import {
  affordableOutputTokens, applyMarkup, computeHold, costMicro, estimateInputTokens, estimateTokens,
} from './pricing'
import type { Queryable } from './queryable'
import { chatProtocol } from './upstream/chatProtocol'
import { errorResponse, RelayError } from './upstream/errors'
import type { Prepared, Protocol, StreamEnd } from './upstream/protocol'
import { responsesProtocol } from './upstream/responsesProtocol'

/** Above this the platform rejects the request anyway; refuse it ourselves first. */
export const MAX_BODY_BYTES = 4_500_000
/** One relayed answer may stream this long; below the 15-minute stale-hold release. */
export const RELAY_MAX_MS = 600_000

export interface RelayDeps {
  config: ServerConfig
  db: Queryable
  catalog: Catalog
  upstream: (path: string, body: unknown, signal: AbortSignal) => Promise<Response>
  newId: () => string
  /** Overrides RELAY_MAX_MS (tests). */
  maxMs?: number
  /** How long to wait for an upstream error body (default 5 s). */
  errorBodyMs?: number
}

export type RelayAuth = { wallet: string } | { keyHash: string }

export interface RelayRequest {
  auth: RelayAuth
  rawBody: string
  /** Aborts when the client goes away. */
  signal: AbortSignal
  /** Web client only: append a `chatui-usage` event with the charge before [DONE]. */
  emitUsageEvent: boolean
  /**
   * What a client disconnect does to a streamed answer. 'abort' stops the
   * upstream and charges what was received (the web client's Stop button);
   * 'drain' keeps reading to the end, forwards nothing more, and charges the
   * real usage (/v1: a script that hangs up must not dodge the bill).
   */
  disconnect: 'abort' | 'drain'
  /**
   * Receives, as soon as a charge is open, a promise that resolves once it
   * is settled. On a platform that terminates a function when the client
   * disconnects, this is what keeps the settlement (and, in drain mode, the
   * upstream read) alive.
   */
  keepAlive?: (work: Promise<unknown>) => void
}

type SettleStatus = 'ok' | 'aborted' | 'error'
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  'x-accel-buffering': 'no',
}

/** A forwarded event must end with a blank line, or the next one merges into it. */
function terminated(raw: string): string {
  return /(\r\n\r\n|\n\n|\r\r)$/.test(raw) ? raw : `${raw.replace(/[\r\n]*$/, '')}\n\n`
}

/**
 * The upstream's own charge never reaches a client: what they owe is this
 * deployment's figure, not the provider's. Looks at the payload and at a
 * nested response object (Responses stream events). Returns null when
 * nothing changed.
 */
function withoutCost(payload: unknown): Obj | null {
  if (!isObj(payload)) return null
  let out: Obj | null = null
  if ('cost' in payload) {
    const { cost: _cost, ...rest } = payload
    out = rest
  }
  if (isObj(payload.response) && 'cost' in payload.response) {
    const { cost: _cost, ...response } = payload.response
    out = { ...(out ?? payload), response }
  }
  return out
}

const SETTLE_BACKOFF_MS = [0, 100, 400]

function upstreamErrorResponse(status: number, text: string, upstreamKey: string): Response {
  if (status === 401 || status === 403) return errorResponse(502, 'upstream_auth', 'The model provider rejected this deployment\'s credentials')
  if (status === 429) return errorResponse(429, 'upstream_rate_limited', 'The model provider is rate limiting requests; try again shortly')
  if (status === 400 || status === 422) {
    let message = text
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } | string, message?: unknown }
      const m = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
      if (typeof m === 'string') message = m
    } catch {}
    const scrubbed = (upstreamKey ? message.split(upstreamKey).join('[redacted]') : message).slice(0, 500)
    return errorResponse(400, 'upstream_rejected', scrubbed || 'The model provider rejected the request')
  }
  return errorResponse(502, 'upstream_error', 'The model provider returned an error')
}

/**
 * Meters one request: authenticate and hold in one ledger round trip,
 * forward with an explicit output cap, stream through while collecting
 * usage / cost / citations on the side, and settle exactly once on every
 * path — completion, client abort, upstream failure, or time limit.
 */
export async function relay(deps: RelayDeps, protocol: Protocol, req: RelayRequest): Promise<Response> {
  const { config, db } = deps
  if (Buffer.byteLength(req.rawBody, 'utf8') > MAX_BODY_BYTES) {
    return errorResponse(413, 'request_too_large', 'Request body exceeds 4.5 MB; send fewer or smaller images')
  }
  let body: unknown
  try {
    body = JSON.parse(req.rawBody)
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body is not valid JSON')
  }

  let models
  try {
    models = await deps.catalog.list()
  } catch {
    return errorResponse(503, 'catalog_unavailable', 'The model list is unavailable; try again shortly')
  }
  let prepared: Prepared
  try {
    prepared = protocol.prepare(body, models)
  } catch (e) {
    if (e instanceof RelayError) return errorResponse(e.status, e.code, e.message)
    throw e
  }

  const billing = config.billing === 'on'
  const pricing = prepared.model.pricing
  const inputTokens = estimateInputTokens(prepared.upstreamBody)
  const holdSearch = prepared.webSearch !== 'off'
  const { wantMicro, minMicro } = computeHold({
    pricing, inputTokens, maxOutputTokens: prepared.requestedMaxOut, webSearch: holdSearch,
    markupBps: config.markupBps, searchFeeMicro: config.searchFeeMicro,
  })

  const id = deps.newId()
  let opened
  try {
    opened = await openCharge(db, {
      id,
      wallet: 'wallet' in req.auth ? req.auth.wallet : null,
      keyHash: 'keyHash' in req.auth ? req.auth.keyHash : null,
      billing,
      allowed: billing ? null : [...config.allowedWallets],
      wantMicro,
      minMicro,
      endpoint: protocol.endpoint,
      model: prepared.model.id,
    })
  } catch {
    return errorResponse(503, 'ledger_unavailable', 'Billing is unavailable; try again shortly')
  }
  if (opened.status === 'invalid_key') return errorResponse(401, 'invalid_api_key', 'Invalid or revoked API key')
  if (opened.status === 'forbidden') return errorResponse(403, 'wallet_not_allowed', 'This wallet may not use this deployment')
  if (opened.status === 'insufficient_balance') {
    return errorResponse(402, 'insufficient_balance', 'Balance too low for this request; top up and try again')
  }
  const wallet = opened.wallet

  protocol.setMaxOutput(prepared.upstreamBody, billing
    ? Math.max(1, Math.min(prepared.requestedMaxOut, affordableOutputTokens({
        holdMicro: opened.holdMicro, pricing, inputTokens, webSearch: holdSearch,
        markupBps: config.markupBps, searchFeeMicro: config.searchFeeMicro,
      })))
    : prepared.requestedMaxOut)

  // Everything the upstream tells us, gathered on the side.
  const seen = { usage: null as Usage | null, reported: null as number | null, citations: [] as Citation[], output: '' }
  const collect = (payload: unknown) => {
    seen.usage = protocol.usage(payload) ?? seen.usage
    seen.reported = protocol.reportedCost(payload) ?? seen.reported
    if (seen.citations.length === 0) seen.citations = protocol.citations(payload)
    seen.output += protocol.outputText(payload)
  }

  // From here on a charge is open; whoever hosts us must let the settlement
  // finish even if the client is gone.
  let resolveSettled!: () => void
  const settledPromise = new Promise<void>((r) => { resolveSettled = r })
  try {
    req.keepAlive?.(settledPromise)
  } catch (err) {
    // The host could not promise to keep us alive; the charge is open, so carry on and settle as usual.
    console.error(`[relay] keepAlive failed for charge ${id}: ${(err as Error).message}`)
  }

  let settling: Promise<{ event: ChatUsageEvent, settled: boolean }> | null = null
  const finish = (status: SettleStatus, charge: boolean) => settling ??= (async () => {
    try {
      return await settle(status, charge)
    } finally {
      resolveSettled()
    }
  })()
  const settle = async (status: SettleStatus, charge: boolean) => {
    const webSearch = prepared.webSearch === 'on' || (prepared.webSearch === 'auto' && seen.citations.length > 0)
    const usage: Usage = charge
      ? { ...(seen.usage ?? { ...ZERO_USAGE, inputTokens, outputTokens: estimateTokens(seen.output) }), webSearch }
      : { ...ZERO_USAGE }
    const markupBps = markupBpsFor(config, wallet)
    const tokenCost = costMicro(pricing, usage, { markupBps: 0, searchFeeMicro: config.searchFeeMicro })
    // The upstream's own figure is the charge, but never more than twice what
    // the published prices imply: a malformed or hostile cost field must not
    // push a balance deep below zero.
    const upstreamCost = seen.reported !== null ? Math.min(seen.reported, tokenCost * 2) : tokenCost
    const cost = charge ? applyMarkup(upstreamCost, markupBps) : 0

    for (let attempt = 0; attempt < SETTLE_BACKOFF_MS.length; attempt++) {
      if (SETTLE_BACKOFF_MS[attempt]) await new Promise(r => setTimeout(r, SETTLE_BACKOFF_MS[attempt]))
      try {
        await settleCharge(db, { id, status, costMicro: cost, billing, usage })
        return { event: { usage, costMicro: String(cost) }, settled: true }
      } catch (err) {
        if (attempt === SETTLE_BACKOFF_MS.length - 1) {
          // Metering only (no content): enough for the operator to reconcile by hand.
          console.error(`[relay] settle failed for charge ${id} (wallet ${wallet}, ${status}, ${cost} micro-USD): ${(err as Error).message}`)
        }
      }
    }
    return { event: { usage, costMicro: String(cost) }, settled: false }
  }

  // A streamed answer stops when the client leaves only in abort mode (the
  // reader saves the rest). A non-streamed one never does: nothing reaches
  // the client until it is complete, so stopping early would only let a
  // disconnect dodge the charge.
  const ac = new AbortController()
  const followClient = prepared.stream && req.disconnect === 'abort'
  const onClientAbort = () => ac.abort()
  if (followClient) {
    if (req.signal.aborted) ac.abort()
    else req.signal.addEventListener('abort', onClientAbort, { once: true })
  }
  const timer = setTimeout(() => ac.abort(), deps.maxMs ?? RELAY_MAX_MS)
  const cleanup = () => {
    clearTimeout(timer)
    req.signal.removeEventListener('abort', onClientAbort)
  }

  let res: Response
  try {
    res = await deps.upstream(protocol.upstreamPath, prepared.upstreamBody, ac.signal)
  } catch {
    cleanup()
    // No response means nothing was produced: release the hold, charge nothing.
    await finish(ac.signal.aborted ? 'aborted' : 'error', false)
    return errorResponse(502, 'upstream_unavailable', 'The model provider could not be reached')
  }
  if (!res.ok) {
    cleanup()
    // Settle first: a stalled error body must not keep the hold open.
    await finish('error', false)
    const text = await Promise.race([
      res.text().catch(() => ''),
      new Promise<string>(r => setTimeout(() => r(''), deps.errorBodyMs ?? 5_000)),
    ])
    res.body?.cancel().catch(() => {})
    return upstreamErrorResponse(res.status, text, config.veniceApiKey)
  }

  if (!prepared.stream) {
    try {
      const json: unknown = await res.json()
      collect(json)
      cleanup()
      await finish(protocol.end(json) === 'failed' ? 'error' : 'ok', true)
      return new Response(JSON.stringify(withoutCost(json) ?? json), { status: 200, headers: { 'content-type': 'application/json' } })
    } catch {
      cleanup()
      await finish(ac.signal.aborted ? 'aborted' : 'error', ac.signal.aborted)
      return errorResponse(502, 'upstream_error', 'The model provider returned an unreadable response')
    }
  }

  const upstreamBody = res.body
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const run = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    const send = (s: string) => {
      try {
        controller.enqueue(encoder.encode(s))
      } catch {
        // client already gone
      }
    }
    let upstreamDone = false
    const state: { end: StreamEnd } = { end: 'none' }
    const parser = createSseParser((e) => {
      if (upstreamDone) return // nothing counts after the upstream's [DONE]
      if (e.data === '[DONE]') {
        upstreamDone = true // re-sent after settlement
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(e.data)
      } catch {
        send(terminated(e.raw))
        return
      }
      collect(payload)
      const end = protocol.end(payload)
      if (end !== 'none') state.end = end
      if (protocol.isUsageOnly(payload) && !prepared.clientWantsUsage) return
      const stripped = withoutCost(payload)
      send(stripped ? `${e.event !== null ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(stripped)}\n\n` : terminated(e.raw))
    }, (raw) => {
      if (!upstreamDone) send(terminated(raw)) // keepalives keep proxies and clients waiting
    })

    let status: SettleStatus
    let charge = true
    if (!upstreamBody) {
      status = 'error' // a success status with no stream: nothing was produced
      charge = false
    } else {
      try {
        const reader = upstreamBody.getReader()
        while (!upstreamDone) {
          const { done, value } = await reader.read()
          if (done) break
          parser.push(decoder.decode(value, { stream: true }))
        }
        if (upstreamDone) reader.cancel().catch(() => {})
        else {
          parser.push(decoder.decode())
          parser.end()
        }
        // An answer is complete only when the upstream said so; a stream that
        // simply ends was cut short, and is settled (and reported) as such.
        status = state.end === 'failed' ? 'error' : upstreamDone || state.end === 'ok' ? 'ok' : 'aborted'
      } catch {
        // Client abort, time limit, or the upstream dropped mid-answer: the
        // answer was cut short, and what it produced is still charged.
        status = 'aborted'
      }
    }
    cleanup()
    const { event, settled } = await finish(status, charge)
    if (status === 'ok') {
      if (req.emitUsageEvent && settled) send(`event: chatui-usage\ndata: ${JSON.stringify(event)}\n\n`)
      send('data: [DONE]\n\n')
    }
    try {
      controller.close()
    } catch {}
  }
  const stream = new ReadableStream<Uint8Array>({
    start: run,
    cancel() {
      if (followClient) ac.abort()
    },
  })
  return new Response(stream, { status: 200, headers: SSE_HEADERS })
}

/** OpenAI chat completions through the metered relay. */
export const relayChat = (deps: RelayDeps, req: RelayRequest): Promise<Response> => relay(deps, chatProtocol, req)
/** OpenAI Responses API through the metered relay. */
export const relayResponses = (deps: RelayDeps, req: RelayRequest): Promise<Response> => relay(deps, responsesProtocol, req)
