import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { runMigrations } from '../../scripts/migrate'
import type { Queryable } from '../../server/utils/queryable'

/**
 * A fresh in-process Postgres with every migration applied. PGlite's query()
 * is a prepared statement (single statement only), so parameterless SQL —
 * e.g. multi-statement migration files — goes through exec().
 */
export async function createTestDb(): Promise<{ db: Queryable, pglite: PGlite }> {
  const pglite = new PGlite()
  const db: Queryable = {
    query: async (sql: string, params?: unknown[]) => {
      if (params?.length) return pglite.query(sql, params) as never
      const results = await pglite.exec(sql)
      return (results.at(-1) ?? { rows: [] }) as never
    },
  }
  const dir = fileURLToPath(new URL('../../server/db/migrations', import.meta.url))
  const files = await Promise.all(
    (await readdir(dir)).filter(n => n.endsWith('.sql')).map(async name => ({
      name,
      sql: await readFile(join(dir, name), 'utf8'),
    })),
  )
  await runMigrations(db as never, files)
  return { db, pglite }
}
