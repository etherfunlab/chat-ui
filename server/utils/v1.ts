import type { H3Event } from 'h3'
import { hashApiKey, parseBearer } from './apiKeys'
import { clientAbortSignal } from './abort'
import { keepAlive } from './keepAlive'
import type { RelayDeps, RelayRequest } from './relay'
import { getRelayDeps } from './relayDeps'
import { errorResponse } from './upstream/errors'

/** The sha256 of the Bearer key, or the 401 to send when there is none. Cookies are never consulted here. */
export function bearerHash(event: H3Event): string | Response {
  const key = parseBearer(getHeader(event, 'authorization'))
  if (!key) return errorResponse(401, 'missing_api_key', 'Send an API key as "Authorization: Bearer <key>"')
  return hashApiKey(key)
}

type RelayFn = (deps: RelayDeps, req: RelayRequest) => Promise<Response>

/**
 * A /v1 request through the relay: Bearer auth, drain on disconnect, no
 * web-only usage event. Whatever goes wrong, the client gets an
 * OpenAI-shaped error, never the platform's page.
 */
export async function relayV1(event: H3Event, relayFn: RelayFn): Promise<unknown> {
  const hash = bearerHash(event)
  if (hash instanceof Response) return sendWebResponse(event, hash)
  let res: Response
  try {
    const rawBody = (await readRawBody(event, 'utf8')) ?? ''
    res = await relayFn(getRelayDeps(), {
      auth: { keyHash: hash },
      rawBody,
      signal: clientAbortSignal(event),
      emitUsageEvent: false,
      disconnect: 'drain',
      keepAlive: work => keepAlive(event, work),
    })
  } catch (err) {
    // Metering only (no content): the message names the failure, never the request.
    console.error(`[v1] unexpected failure: ${(err as Error).name}: ${(err as Error).message}`)
    res = errorResponse(500, 'internal_error', 'Something went wrong on this server')
  }
  return sendWebResponse(event, res)
}
