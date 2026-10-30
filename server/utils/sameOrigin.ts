import type { H3Event } from 'h3'
import { getAppUrl } from './appOrigin'

/**
 * Session-cookie endpoints accept only same-origin browser requests.
 * The reference origin comes from getAppUrl (PUBLIC_ORIGIN when configured).
 */
export function assertSameOrigin(event: H3Event): void {
  const reqUrl = getAppUrl(event)
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
