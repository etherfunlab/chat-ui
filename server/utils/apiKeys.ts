import { createHash, randomBytes } from 'node:crypto'
import type { ServerConfig } from './config'
import type { Queryable } from './queryable'
import { RelayError } from './upstream/errors'

/** Active (unrevoked) keys one wallet may hold. */
export const MAX_KEYS_PER_WALLET = 20
export const MAX_KEY_NAME = 40

const KEY_PREFIX = 'cu-'
/** "cu-" + 32 random bytes as base64url. */
const KEY_LENGTH = KEY_PREFIX.length + 43
const DISPLAY_PREFIX_LENGTH = 10

export interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generateApiKey(): { key: string, prefix: string, hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), hash: hashApiKey(key) }
}

/** The key from an `Authorization: Bearer <key>` header, or null when absent or malformed. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim())
  const key = m?.[1]
  if (!key || !key.startsWith(KEY_PREFIX) || key.length !== KEY_LENGTH) return null
  return key
}

interface DbRow {
  id: string
  name: string
  key_prefix: string
  created_at: string | Date
  last_used_at: string | Date | null
  revoked_at: string | Date | null
}

const iso = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString())

const toRow = (r: DbRow): ApiKeyRow => ({
  id: r.id,
  name: r.name,
  prefix: r.key_prefix,
  createdAt: iso(r.created_at)!,
  lastUsedAt: iso(r.last_used_at),
  revokedAt: iso(r.revoked_at),
})

const ROW_COLUMNS = 'id, name, key_prefix, created_at, last_used_at, revoked_at'

/** Creates a key; the plaintext is returned here and never stored. */
export async function createApiKey(db: Queryable, wallet: string, name: string): Promise<{ row: ApiKeyRow, key: string }> {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length === 0 || trimmed.length > MAX_KEY_NAME) {
    throw new RelayError(400, 'invalid_key_name', `Key name must be 1–${MAX_KEY_NAME} characters`)
  }
  const { rows: active } = await db.query(
    'SELECT count(*)::int AS n FROM api_keys WHERE wallet = $1 AND revoked_at IS NULL', [wallet])
  if ((active[0] as { n: number }).n >= MAX_KEYS_PER_WALLET) {
    throw new RelayError(400, 'too_many_keys', `At most ${MAX_KEYS_PER_WALLET} active keys per account; revoke one first`)
  }
  const generated = generateApiKey()
  const { rows } = await db.query(
    `INSERT INTO api_keys (id, wallet, name, key_hash, key_prefix)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${ROW_COLUMNS}`,
    [crypto.randomUUID(), wallet, trimmed, generated.hash, generated.prefix],
  )
  return { row: toRow(rows[0] as unknown as DbRow), key: generated.key }
}

/** Every key of a wallet, newest first, revoked ones included. */
export async function listApiKeys(db: Queryable, wallet: string): Promise<ApiKeyRow[]> {
  const { rows } = await db.query(
    `SELECT ${ROW_COLUMNS} FROM api_keys WHERE wallet = $1 ORDER BY created_at DESC, id DESC`, [wallet])
  return (rows as unknown as DbRow[]).map(toRow)
}

/** Revokes one of the wallet's active keys; false when there was nothing to revoke. */
export async function revokeApiKey(db: Queryable, wallet: string, id: string): Promise<boolean> {
  const { rows } = await db.query(
    'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND wallet = $2 AND revoked_at IS NULL RETURNING id',
    [id, wallet])
  return rows.length > 0
}

/**
 * The wallet behind an active key hash, or null. Like the session cookie, a
 * key on a BILLING=off deployment is re-checked against the allow list on
 * every use.
 */
export async function walletForKey(db: Queryable, config: ServerConfig, hash: string): Promise<string | null> {
  const { rows } = await db.query('SELECT wallet FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL', [hash])
  const wallet = (rows[0] as { wallet: string } | undefined)?.wallet ?? null
  if (!wallet) return null
  if (config.billing === 'off' && !config.allowedWallets.has(wallet)) return null
  return wallet
}
