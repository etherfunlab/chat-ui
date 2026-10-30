import type { H3Event } from 'h3'
import { getServerConfig } from './config'

/**
 * The app's own URL, used as the SIWS signing domain and the same-origin
 * reference. When PUBLIC_ORIGIN is configured it wins: X-Forwarded-* headers
 * are attacker-controlled behind a naive reverse proxy, and a signed-in
 * domain that follows them lets a phishing relay mint valid sign-ins.
 */
export function getAppUrl(event: H3Event): URL {
  const { publicOrigin } = getServerConfig()
  if (publicOrigin) return new URL(publicOrigin)
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
}
