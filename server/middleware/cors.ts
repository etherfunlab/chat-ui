/**
 * /v1 is an API for any origin, authenticated by Bearer key alone, so it is
 * open to cross-origin callers without credentials. A preflight is granted
 * whatever headers it asks for: SDKs send their own telemetry headers, and
 * without credentials there is nothing a header name could unlock. /api
 * stays same-origin (its cookie-bound handlers check that themselves).
 */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/v1/')) return
  const requested = getHeader(event, 'access-control-request-headers')
  setResponseHeaders(event, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': requested || 'authorization, content-type',
    'access-control-max-age': 86400,
  })
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return send(event)
  }
})
