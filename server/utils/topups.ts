import type { Queryable } from './queryable'

export type TopUpStatus = 'pending' | 'submitting' | 'confirmed' | 'failed'

export interface TopUpIntent {
  id: string
  wallet: string
  amountBase: bigint
  reference: string
  recipient: string
  mint: string
  blockhash: string
  lastValidBlockHeight: number
  status: TopUpStatus
  txSignature: string | null
}

const COLUMNS = `id, wallet, amount_base::text AS amount_base, reference, recipient, mint, blockhash,
  last_valid_block_height::text AS last_valid_block_height, status, tx_signature`

function toIntent(r: Record<string, unknown>): TopUpIntent {
  return {
    id: r.id as string,
    wallet: r.wallet as string,
    amountBase: BigInt(r.amount_base as string),
    reference: r.reference as string,
    recipient: r.recipient as string,
    mint: r.mint as string,
    blockhash: r.blockhash as string,
    lastValidBlockHeight: Number(r.last_valid_block_height),
    status: r.status as TopUpStatus,
    txSignature: (r.tx_signature as string | null) ?? null,
  }
}

export async function createIntent(
  db: Queryable,
  i: Omit<TopUpIntent, 'status' | 'txSignature'>,
): Promise<void> {
  await db.query(
    `INSERT INTO topup_intents (id, wallet, amount_base, reference, recipient, mint, status, blockhash, last_valid_block_height)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
    [i.id, i.wallet, i.amountBase.toString(), i.reference, i.recipient, i.mint, i.blockhash, i.lastValidBlockHeight],
  )
}

/**
 * Atomically moves the caller's own pending intent to submitting and records
 * the signature of the transaction about to be broadcast, so a send that
 * fails ambiguously can still be found and credited later.
 */
export async function claimIntent(
  db: Queryable,
  id: string,
  wallet: string,
  signature: string,
): Promise<TopUpIntent | null> {
  const { rows } = await db.query(
    `UPDATE topup_intents SET status = 'submitting', tx_signature = $3
     WHERE id = $1 AND wallet = $2 AND status = 'pending'
     RETURNING ${COLUMNS}`,
    [id, wallet, signature],
  )
  return rows[0] ? toIntent(rows[0]) : null
}

export async function getIntentStatus(db: Queryable, id: string, wallet: string): Promise<TopUpStatus | null> {
  const { rows } = await db.query('SELECT status FROM topup_intents WHERE id = $1 AND wallet = $2', [id, wallet])
  return (rows[0]?.status as TopUpStatus | undefined) ?? null
}

/**
 * Returns a claimed intent to pending after the cluster definitively rejected
 * its transaction, forgetting that signature so the user can sign again.
 */
export async function releaseClaim(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE topup_intents SET status = 'pending', tx_signature = NULL WHERE id = $1 AND status = 'submitting'`,
    [id],
  )
}

export async function failIntent(db: Queryable, id: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE topup_intents SET status = 'failed', error = $2 WHERE id = $1 AND status IN ('pending', 'submitting')`,
    [id, reason],
  )
}

/** Confirms and credits exactly once; returns micro-USD credited (0 if not creditable). */
export async function creditTopUp(db: Queryable, id: string, signature: string): Promise<number> {
  const { rows } = await db.query('SELECT credit_topup($1, $2)::text AS credited', [id, signature])
  return Number(rows[0]!.credited)
}

/** Intents worth re-checking on chain: submitting ones, and pending ones from the last hour. */
export async function reconcilableIntents(db: Queryable, wallet: string): Promise<TopUpIntent[]> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM topup_intents
     WHERE wallet = $1 AND (status = 'submitting' OR (status = 'pending' AND created_at > now() - interval '1 hour'))
     ORDER BY created_at DESC LIMIT 20`,
    [wallet],
  )
  return rows.map(toIntent)
}

export interface TopUpListItem {
  id: string
  amountMicro: string
  status: TopUpStatus
  txSignature: string | null
  createdAt: string
}

export async function listIntents(db: Queryable, wallet: string, limit: number): Promise<TopUpListItem[]> {
  const { rows } = await db.query(
    `SELECT id, amount_base::text AS amount, status, tx_signature, created_at
     FROM topup_intents WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2`,
    [wallet, limit],
  )
  return rows.map(r => ({
    id: r.id as string,
    amountMicro: r.amount as string,
    status: r.status as TopUpStatus,
    txSignature: (r.tx_signature as string | null) ?? null,
    createdAt: new Date(r.created_at as string | Date).toISOString(),
  }))
}
