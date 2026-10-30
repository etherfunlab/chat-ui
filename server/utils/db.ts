import pg from 'pg'
import { getServerConfig } from './config'

let pool: pg.Pool | undefined

export function getPool(): pg.Pool {
  if (!pool) {
    // Small cap: many serverless instances share one Postgres endpoint, so
    // point DATABASE_URL at a pooled connection string (e.g. Neon's -pooler).
    pool = new pg.Pool({ connectionString: getServerConfig().databaseUrl, max: 3 })
    // pg-pool re-emits idle-client errors on the pool; without a listener the
    // process dies. Providers drop idle connections routinely. Message only —
    // never payloads.
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message)
    })
  }
  return pool
}

export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
