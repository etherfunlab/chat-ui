// Integration tests: the ledger functions against real Postgres (PGlite).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../../tests/helpers/pg'
import type { Queryable } from './queryable'
import { openCharge, settleCharge } from './ledger'
import { ZERO_USAGE } from '#shared/billing'

let db: Queryable
let pglite: PGlite
let seq = 0
const nextId = () => `c${++seq}`

async function account(wallet: string): Promise<{ balance: number, held: number }> {
  const { rows } = await pglite.query<{ b: string, h: string }>(
    'SELECT balance_micro::text AS b, held_micro::text AS h FROM accounts WHERE wallet = $1', [wallet],
  )
  return { balance: Number(rows[0]!.b), held: Number(rows[0]!.h) }
}

async function record(id: string) {
  const { rows } = await pglite.query<Record<string, unknown>>('SELECT * FROM usage_records WHERE id = $1', [id])
  return rows[0]
}

const base = { keyHash: null, billing: true, allowed: null, endpoint: 'chat' as const, model: 'm' }

beforeAll(async () => {
  ;({ db, pglite } = await createTestDb())
})

beforeEach(async () => {
  await pglite.exec('TRUNCATE usage_records, api_keys, accounts CASCADE')
  await pglite.query(`INSERT INTO accounts (wallet, balance_micro) VALUES ('W', 1000000)`)
})

describe('openCharge', () => {
  it('holds the requested amount when affordable', async () => {
    const r = await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 300_000, minMicro: 50_000 })
    expect(r).toEqual({ status: 'ok', wallet: 'W', apiKeyId: null, holdMicro: 300_000 })
    expect(await account('W')).toEqual({ balance: 1_000_000, held: 300_000 })
  })

  it('caps the hold at the available balance', async () => {
    const r = await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 2_000_000, minMicro: 50_000 })
    expect(r).toMatchObject({ status: 'ok', holdMicro: 1_000_000 })
  })

  it('rejects when available is below the minimum', async () => {
    const id = nextId()
    const r = await openCharge(db, { ...base, id, wallet: 'W', wantMicro: 2_000_000, minMicro: 1_000_001 })
    expect(r).toEqual({ status: 'insufficient_balance', wallet: 'W', availableMicro: 1_000_000 })
    expect(await record(id)).toBeUndefined()
    expect((await account('W')).held).toBe(0)
  })

  it('sees earlier holds when sizing the next one', async () => {
    await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 800_000, minMicro: 1 })
    const r = await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 500_000, minMicro: 1 })
    expect(r).toMatchObject({ status: 'ok', holdMicro: 200_000 })
    expect((await account('W')).held).toBe(1_000_000)
  })

  it('releases stale holds', async () => {
    await pglite.query(`UPDATE accounts SET held_micro = 400000 WHERE wallet = 'W'`)
    await pglite.query(
      `INSERT INTO usage_records (id, wallet, endpoint, model, status, hold_micro, created_at)
       VALUES ('stale', 'W', 'chat', 'm', 'pending', 400000, now() - interval '20 minutes')`,
    )
    const r = await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 1_000_000, minMicro: 1 })
    expect(r).toMatchObject({ status: 'ok', holdMicro: 1_000_000 })
    expect(await record('stale')).toMatchObject({ status: 'error' })
    expect((await account('W')).held).toBe(1_000_000)
  })

  it('does not release a fresh pending hold', async () => {
    await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 600_000, minMicro: 1 })
    const r = await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 1_000_000, minMicro: 1 })
    expect(r).toMatchObject({ status: 'ok', holdMicro: 400_000 })
  })

  it('rejects a negative balance left by an earlier overdraft', async () => {
    await pglite.query(`UPDATE accounts SET balance_micro = -50 WHERE wallet = 'W'`)
    const r = await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 100, minMicro: 1 })
    expect(r).toEqual({ status: 'insufficient_balance', wallet: 'W', availableMicro: -50 })
  })
})

describe('settleCharge', () => {
  it('settle is idempotent', async () => {
    const id = nextId()
    await openCharge(db, { ...base, id, wallet: 'W', wantMicro: 300_000, minMicro: 1 })
    const usage = { ...ZERO_USAGE, inputTokens: 1000, outputTokens: 500 }
    expect(await settleCharge(db, { id, status: 'ok', costMicro: 120_000, billing: true, usage })).toBe('settled')
    expect(await settleCharge(db, { id, status: 'ok', costMicro: 120_000, billing: true, usage })).toBe('noop')
    expect(await account('W')).toEqual({ balance: 880_000, held: 0 })
    expect(await record(id)).toMatchObject({ status: 'ok', input_tokens: 1000, output_tokens: 500 })
  })

  it('allows a small overdraft when cost exceeds hold', async () => {
    await pglite.query(`UPDATE accounts SET balance_micro = 100 WHERE wallet = 'W'`)
    const id = nextId()
    await openCharge(db, { ...base, id, wallet: 'W', wantMicro: 100, minMicro: 1 })
    await settleCharge(db, { id, status: 'ok', costMicro: 150, billing: true, usage: ZERO_USAGE })
    expect(await account('W')).toEqual({ balance: -50, held: 0 })
  })

  it('cannot settle a stale-released charge', async () => {
    await pglite.query(`UPDATE accounts SET held_micro = 400000 WHERE wallet = 'W'`)
    await pglite.query(
      `INSERT INTO usage_records (id, wallet, endpoint, model, status, hold_micro, created_at)
       VALUES ('late', 'W', 'chat', 'm', 'pending', 400000, now() - interval '20 minutes')`,
    )
    await openCharge(db, { ...base, id: nextId(), wallet: 'W', wantMicro: 1, minMicro: 1 })
    expect(await settleCharge(db, { id: 'late', status: 'ok', costMicro: 5, billing: true, usage: ZERO_USAGE }))
      .toBe('noop')
  })

  it('records web search on the usage row', async () => {
    const id = nextId()
    await openCharge(db, { ...base, id, wallet: 'W', wantMicro: 10, minMicro: 1 })
    await settleCharge(db, { id, status: 'ok', costMicro: 10, billing: true, usage: { ...ZERO_USAGE, webSearch: true } })
    expect(await record(id)).toMatchObject({ web_search: true })
  })
})

describe('billing off', () => {
  it('billing off: no hold, no deduction, usage recorded', async () => {
    const id = nextId()
    const r = await openCharge(db, { ...base, id, wallet: 'W', billing: false, wantMicro: 999_999_999, minMicro: 999_999_999 })
    expect(r).toMatchObject({ status: 'ok', holdMicro: 0 })
    await settleCharge(db, { id, status: 'ok', costMicro: 5_000, billing: false, usage: ZERO_USAGE })
    expect(await account('W')).toEqual({ balance: 1_000_000, held: 0 })
    expect(Number((await record(id))!.cost_micro)).toBe(5_000)
  })
})

describe('API keys', () => {
  beforeEach(async () => {
    await pglite.query(
      `INSERT INTO api_keys (id, wallet, name, key_hash, key_prefix) VALUES ('k1', 'W', 'cli', 'h1', 'cu-abc')`,
    )
  })

  it('resolves the wallet from an API key and stamps last_used_at', async () => {
    const r = await openCharge(db, { ...base, id: nextId(), wallet: null, keyHash: 'h1', wantMicro: 10, minMicro: 1 })
    expect(r).toEqual({ status: 'ok', wallet: 'W', apiKeyId: 'k1', holdMicro: 10 })
    const { rows } = await pglite.query<{ t: string | null }>(`SELECT last_used_at AS t FROM api_keys WHERE id = 'k1'`)
    expect(rows[0]!.t).not.toBeNull()
  })

  it('rejects revoked or unknown keys', async () => {
    await pglite.query(`UPDATE api_keys SET revoked_at = now() WHERE id = 'k1'`)
    expect(await openCharge(db, { ...base, id: nextId(), wallet: null, keyHash: 'h1', wantMicro: 1, minMicro: 1 }))
      .toEqual({ status: 'invalid_key' })
    expect(await openCharge(db, { ...base, id: nextId(), wallet: null, keyHash: 'nope', wantMicro: 1, minMicro: 1 }))
      .toEqual({ status: 'invalid_key' })
  })

  it('enforces the allow list for key-resolved wallets', async () => {
    const r = await openCharge(db, {
      ...base, id: nextId(), wallet: null, keyHash: 'h1', billing: false, allowed: ['OTHER'], wantMicro: 1, minMicro: 1,
    })
    expect(r).toEqual({ status: 'forbidden', wallet: 'W' })
  })
})
