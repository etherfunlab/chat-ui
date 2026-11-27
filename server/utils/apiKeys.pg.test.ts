import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../../tests/helpers/pg'
import {
  MAX_KEYS_PER_WALLET, createApiKey, hashApiKey, listApiKeys, revokeApiKey, walletForKey,
} from './apiKeys'
import type { ServerConfig } from './config'
import type { Queryable } from './queryable'

let db: Queryable
let pglite: PGlite

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  billing: 'on',
  databaseUrl: 'postgres://x',
  sessionSecret: 's'.repeat(32),
  veniceApiKey: 'vk',
  veniceBaseUrl: 'https://upstream.test',
  models: [],
  allowedWallets: new Set(),
  markupBps: 0,
  markupExemptWallets: new Set(),
  searchFeeMicro: 0,
  solanaRpcUrl: '',
  solanaTreasury: '',
  usdcMint: '',
  ...over,
})

beforeAll(async () => {
  ;({ db, pglite } = await createTestDb())
})

beforeEach(async () => {
  await pglite.exec('TRUNCATE usage_records, api_keys, accounts CASCADE')
  await pglite.exec(`INSERT INTO accounts (wallet, balance_micro) VALUES ('W', 0), ('X', 0)`)
})

describe('createApiKey', () => {
  it('stores only the hash and prefix, never the key', async () => {
    const { row, key } = await createApiKey(db, 'W', '  laptop ')
    expect(row).toMatchObject({ name: 'laptop', prefix: key.slice(0, 10), lastUsedAt: null, revokedAt: null })
    const { rows } = await pglite.query<{ key_hash: string, key_prefix: string, t: string }>(
      'SELECT key_hash, key_prefix, api_keys::text AS t FROM api_keys WHERE id = $1', [row.id])
    expect(rows[0]!.key_hash).toBe(hashApiKey(key))
    expect(rows[0]!.t).not.toContain(key)
  })

  it('rejects an empty or over-long name', async () => {
    await expect(createApiKey(db, 'W', '   ')).rejects.toMatchObject({ status: 400, code: 'invalid_key_name' })
    await expect(createApiKey(db, 'W', 'n'.repeat(41))).rejects.toMatchObject({ status: 400, code: 'invalid_key_name' })
    await expect(createApiKey(db, 'W', 'n'.repeat(40))).resolves.toBeTruthy()
  })

  it('caps active keys per wallet; revoking one frees a slot', async () => {
    for (let i = 0; i < MAX_KEYS_PER_WALLET; i++) await createApiKey(db, 'W', `k${i}`)
    await expect(createApiKey(db, 'W', 'one more')).rejects.toMatchObject({ status: 400, code: 'too_many_keys' })
    const first = (await listApiKeys(db, 'W')).at(-1)!
    expect(await revokeApiKey(db, 'W', first.id)).toBe(true)
    await expect(createApiKey(db, 'W', 'one more')).resolves.toBeTruthy()
  })
})

describe('listApiKeys / revokeApiKey', () => {
  it('lists only this wallet, newest first, including revoked keys', async () => {
    const a = await createApiKey(db, 'W', 'a')
    await pglite.query(`UPDATE api_keys SET created_at = created_at - interval '1 minute' WHERE id = $1`, [a.row.id])
    const b = await createApiKey(db, 'W', 'b')
    await createApiKey(db, 'X', 'other')
    await revokeApiKey(db, 'W', a.row.id)
    const list = await listApiKeys(db, 'W')
    expect(list.map(k => k.name)).toEqual(['b', 'a'])
    expect(list[0]!.id).toBe(b.row.id)
    expect(list[1]!.revokedAt).not.toBeNull()
  })

  it('does not revoke another wallet\'s key or an already revoked one', async () => {
    const { row } = await createApiKey(db, 'W', 'a')
    expect(await revokeApiKey(db, 'X', row.id)).toBe(false)
    expect(await revokeApiKey(db, 'W', row.id)).toBe(true)
    expect(await revokeApiKey(db, 'W', row.id)).toBe(false)
  })
})

describe('walletForKey', () => {
  it('resolves the wallet of an active key', async () => {
    const { key } = await createApiKey(db, 'W', 'a')
    expect(await walletForKey(db, config(), hashApiKey(key))).toBe('W')
    expect(await walletForKey(db, config(), hashApiKey('cu-nope'))).toBeNull()
  })

  it('ignores revoked keys', async () => {
    const { row, key } = await createApiKey(db, 'W', 'a')
    await revokeApiKey(db, 'W', row.id)
    expect(await walletForKey(db, config(), hashApiKey(key))).toBeNull()
  })

  it('re-checks the allow list when billing is off', async () => {
    const { key } = await createApiKey(db, 'W', 'a')
    const off = config({ billing: 'off', allowedWallets: new Set(['X']) })
    expect(await walletForKey(db, off, hashApiKey(key))).toBeNull()
    expect(await walletForKey(db, config({ billing: 'off', allowedWallets: new Set(['W']) }), hashApiKey(key))).toBe('W')
  })
})
