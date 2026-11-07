/**
 * /v1 is an API for any origin, authenticated by Bearer key alone, so it is
 * open to cross-origin callers without credentials. /api stays same-origin
 * (its cookie-bound handlers check that themselves).
 */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/v1/')) return
  setResponseHeaders(event, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': 86400,
  })
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return send(event)
  }
})
