import type { H3Event } from 'h3'

/**
 * Session-cookie endpoints accept only same-origin browser requests.
 * X-Forwarded-* is honored so proxied deployments compare the public origin.
 */
export function assertSameOrigin(event: H3Event): void {
  const reqUrl = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
  const source = getHeader(event, 'origin') ?? getHeader(event, 'referer')
  if (!source) {
    throw createError({ statusCode: 403, statusMessage: 'Missing Origin/Referer' })
  }
  let sourceOrigin: string
  try {
    sourceOrigin = new URL(source).origin
  } catch {
    throw createError({ statusCode: 403, statusMessage: 'Malformed Origin/Referer' })
  }
  if (sourceOrigin !== reqUrl.origin) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request rejected' })
  }
}
