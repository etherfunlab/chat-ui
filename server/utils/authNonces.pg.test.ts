// Integration tests: the real nonce SQL against a real Postgres (PGlite),
// with the real migration files applied.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../../tests/helpers/pg'
import type { Queryable } from './queryable'
import { insertNonce, consumeNonce } from './authNonces'

let db: Queryable
let pglite: PGlite

beforeAll(async () => {
  ;({ db, pglite } = await createTestDb())
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

  it('bounds the purge to 100 expired rows per insert', async () => {
    await db.query(`DELETE FROM auth_nonces`)
    await pglite.query(
      `INSERT INTO auth_nonces (nonce, wallet, issued_at, expires_at)
       SELECT 'flood-' || g, 'W9', now(), now() - interval '2 hours' FROM generate_series(1, 150) g`,
    )
    await insertNonce(db as never, { nonce: 'after-flood', wallet: 'W1', issuedAt })
    const { rows } = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_nonces WHERE nonce LIKE 'flood-%'`,
    )
    expect(rows[0]!.n).toBe(50)
  })

  it('purges rows expired more than an hour ago on insert', async () => {
    await insertNonce(db as never, { nonce: 'old', wallet: 'W1', issuedAt })
    await db.query(`UPDATE auth_nonces SET expires_at = now() - interval '2 hours' WHERE nonce = 'old'`)
    await insertNonce(db as never, { nonce: 'fresh', wallet: 'W1', issuedAt })
    const { rows } = await db.query(`SELECT nonce FROM auth_nonces WHERE nonce = 'old'`)
    expect(rows).toHaveLength(0)
  })
})
