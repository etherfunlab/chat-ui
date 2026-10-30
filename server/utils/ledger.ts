import type { Usage } from '#shared/billing'
import type { Queryable } from './queryable'

export type OpenChargeResult =
  | { status: 'ok', wallet: string, apiKeyId: string | null, holdMicro: number }
  | { status: 'invalid_key' }
  | { status: 'forbidden', wallet: string | null }
  | { status: 'insufficient_balance', wallet: string, availableMicro: number }

export interface OpenChargeArgs {
  id: string
  /** Session wallet; null when authenticating by API key. */
  wallet: string | null
  /** sha256 hex of the API key; null for session requests. */
  keyHash: string | null
  billing: boolean
  /** BILLING=off allow list; null when billing is on. */
  allowed: string[] | null
  wantMicro: number
  minMicro: number
  endpoint: 'chat' | 'responses'
  model: string
}

interface OpenChargeRow {
  r_status: string
  r_wallet: string | null
  r_api_key_id: string | null
  r_hold: string | null
  r_available: string | null
}

/** Authenticates and places a hold in a single round trip (see open_charge). */
export async function openCharge(db: Queryable, a: OpenChargeArgs): Promise<OpenChargeResult> {
  const { rows } = await db.query(
    `SELECT * FROM open_charge($1::text, $2::text, $3::text, $4::boolean, $5::text[],
                               $6::bigint, $7::bigint, $8::text, $9::text)`,
    [a.id, a.wallet, a.keyHash, a.billing, a.allowed, a.wantMicro, a.minMicro, a.endpoint, a.model],
  )
  const r = rows[0] as unknown as OpenChargeRow
  switch (r.r_status) {
    case 'ok':
      return { status: 'ok', wallet: r.r_wallet!, apiKeyId: r.r_api_key_id, holdMicro: Number(r.r_hold) }
    case 'invalid_key':
      return { status: 'invalid_key' }
    case 'forbidden':
      return { status: 'forbidden', wallet: r.r_wallet }
    case 'insufficient_balance':
      return { status: 'insufficient_balance', wallet: r.r_wallet!, availableMicro: Number(r.r_available) }
    default:
      throw new Error(`open_charge returned unknown status ${r.r_status}`)
  }
}

export interface SettleArgs {
  id: string
  status: 'ok' | 'aborted' | 'error'
  costMicro: number
  billing: boolean
  usage: Usage
}

/** Settles exactly once; a retry or a stale-released charge returns 'noop'. */
export async function settleCharge(db: Queryable, a: SettleArgs): Promise<'settled' | 'noop'> {
  const { rows } = await db.query(
    'SELECT settle_charge($1::text, $2::text, $3::bigint, $4::boolean, $5::jsonb) AS r',
    [a.id, a.status, a.costMicro, a.billing, JSON.stringify(a.usage)],
  )
  return (rows[0] as { r: 'settled' | 'noop' }).r
}
