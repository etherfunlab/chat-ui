// Integration tests: the real nonce SQL against a real Postgres (PGlite),
// with the real migration files applied.
import { describe, it, expect, beforeAll } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { runMigrations } from '../../scripts/migrate'
import { insertNonce, consumeNonce } from './authNonces'

const pglite = new PGlite()

// PGlite's query() is a prepared statement (single statement only); route
// param-less SQL (multi-statement migration files) through exec().
const db = {
  query: async (sql: string, params?: unknown[]) => {
    if (params?.length) return pglite.query(sql, params)
    const results = await pglite.exec(sql)
    return results.at(-1) ?? { rows: [] }
  },
}

beforeAll(async () => {
  const dir = fileURLToPath(new URL('../db/migrations', import.meta.url))
  const files = await Promise.all(
    (await readdir(dir)).filter(n => n.endsWith('.sql')).map(async name => ({
      name,
      sql: await readFile(join(dir, name), 'utf8'),
    })),
  )
  const applied = await runMigrations(db as never, files)
  expect(applied.length).toBeGreaterThanOrEqual(1)
})

const issuedAt = '2026-10-30T10:00:00.123Z'

describe('nonce lifecycle against real SQL', () => {
  it('consumes once with an exact issued-at round-trip, then never again', async () => {
    await insertNonce(db as never, { nonce: 'n1', wallet: 'W1', issuedAt })
    const first = await consumeNonce(db as never, 'n1', 'W1')
    expect(first?.issuedAt).toBe(issuedAt)
    expect(await consumeNonce(db as never, 'n1', 'W1')).toBeUndefined()
  })

  it('rejects an expired nonce', async () => {
    await insertNonce(db as never, { nonce: 'n2', wallet: 'W1', issuedAt })
    await db.query(`UPDATE auth_nonces SET expires_at = now() - interval '1 second' WHERE nonce = 'n2'`)
    expect(await consumeNonce(db as never, 'n2', 'W1')).toBeUndefined()
  })

  it('rejects a nonce presented by a different wallet', async () => {
    await insertNonce(db as never, { nonce: 'n3', wallet: 'W1', issuedAt })
    expect(await consumeNonce(db as never, 'n3', 'W2')).toBeUndefined()
    // still consumable by its own wallet afterwards
    expect(await consumeNonce(db as never, 'n3', 'W1')).toBeDefined()
  })

  it('purges rows expired more than an hour ago on insert', async () => {
    await insertNonce(db as never, { nonce: 'old', wallet: 'W1', issuedAt })
    await db.query(`UPDATE auth_nonces SET expires_at = now() - interval '2 hours' WHERE nonce = 'old'`)
    await insertNonce(db as never, { nonce: 'fresh', wallet: 'W1', issuedAt })
    const { rows } = await db.query(`SELECT nonce FROM auth_nonces WHERE nonce = 'old'`)
    expect(rows).toHaveLength(0)
  })
})
