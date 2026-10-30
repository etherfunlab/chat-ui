import { getCatalog } from './catalog'
import { getServerConfig } from './config'
import { getPool } from './db'
import type { RelayDeps } from './relay'
import { createVeniceUpstream } from './upstream/venice'

export function getRelayDeps(): RelayDeps {
  const config = getServerConfig()
  return {
    config,
    db: getPool(),
    catalog: getCatalog(),
    upstream: createVeniceUpstream(config),
    newId: () => crypto.randomUUID(),
  }
}
