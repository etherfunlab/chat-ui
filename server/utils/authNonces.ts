import type { Queryable } from './queryable'

/**
 * Inserts a sign-in nonce (10-minute expiry) and opportunistically purges
 * long-expired rows: the endpoint is unauthenticated, so the table would
 * otherwise grow without bound. The purge is capped per call and skips rows
 * another request is already deleting, so a flood cannot turn each sign-in
 * into an unbounded, contended DELETE.
 */
export async function insertNonce(
  db: Queryable,
  p: { nonce: string, wallet: string, issuedAt: string },
): Promise<void> {
  await db.query(
    `DELETE FROM auth_nonces WHERE nonce IN (
       SELECT nonce FROM auth_nonces
       WHERE expires_at < now() - interval '1 hour'
       LIMIT 100 FOR UPDATE SKIP LOCKED
     )`,
  )
  await db.query(
    `INSERT INTO auth_nonces (nonce, wallet, issued_at, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')`,
    [p.nonce, p.wallet, p.issuedAt],
  )
}

/**
 * Atomic consume: replay (used_at), expiry and wallet binding all live in one
 * UPDATE, so there is no check-then-use window. Returns the stored issued-at
 * as the ISO string the signed message was built with.
 */
export async function consumeNonce(
  db: Queryable,
  nonce: string,
  wallet: string,
): Promise<{ issuedAt: string } | undefined> {
  const { rows } = await db.query(
    `UPDATE auth_nonces SET used_at = now()
     WHERE nonce = $1 AND wallet = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING issued_at`,
    [nonce, wallet],
  )
  const row = rows[0] as { issued_at: Date | string } | undefined
  return row ? { issuedAt: new Date(row.issued_at).toISOString() } : undefined
}
