import type { ServerConfig } from '../config'
import type { RelayDeps } from '../relay'

/** The upstream call: the API key stays on this side of the relay. */
export function createVeniceUpstream(config: Pick<ServerConfig, 'veniceBaseUrl' | 'veniceApiKey'>): RelayDeps['upstream'] {
  return (path, body, signal) => fetch(`${config.veniceBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.veniceApiKey}` },
    body: JSON.stringify(body),
    signal,
  })
}
