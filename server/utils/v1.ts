import type { H3Event } from 'h3'
import { waitUntil } from '@vercel/functions'
import { hashApiKey, parseBearer } from './apiKeys'
import { clientAbortSignal } from './abort'
import type { RelayDeps, RelayRequest } from './relay'
import { getRelayDeps } from './relayDeps'
import { errorResponse } from './upstream/errors'

/** The sha256 of the Bearer key, or the 401 to send when there is none. Cookies are never consulted here. */
export function bearerHash(event: H3Event): string | Response {
  const key = parseBearer(getHeader(event, 'authorization'))
  if (!key) return errorResponse(401, 'missing_api_key', 'Send an API key as "Authorization: Bearer <key>"')
  return hashApiKey(key)
}

/**
 * Lets server-side work outlive the response: on Vercel the function would
 * otherwise be frozen once the client is gone, before the upstream was read
 * to the end and the charge settled. Elsewhere this is a no-op.
 */
export function keepAlive(event: H3Event, work: Promise<unknown>): void {
  event.waitUntil(work)
  waitUntil(work)
}

type RelayFn = (deps: RelayDeps, req: RelayRequest) => Promise<Response>

/** A /v1 request through the relay: Bearer auth, drain on disconnect, no web-only usage event. */
export async function relayV1(event: H3Event, relayFn: RelayFn): Promise<unknown> {
  const hash = bearerHash(event)
  if (hash instanceof Response) return sendWebResponse(event, hash)
  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const res = await relayFn(getRelayDeps(), {
    auth: { keyHash: hash },
    rawBody,
    signal: clientAbortSignal(event),
    emitUsageEvent: false,
    disconnect: 'drain',
    keepAlive: work => keepAlive(event, work),
  })
  return sendWebResponse(event, res)
}
