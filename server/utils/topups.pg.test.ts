// Integration tests: top-up intent SQL against real Postgres (PGlite).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../../tests/helpers/pg'
import type { Queryable } from './queryable'
import {
  claimIntent, createIntent, creditTopUp, failIntent, listIntents, reconcilableIntents, releaseClaim, setSignature,
} from './topups'

let db: Queryable
let pglite: PGlite

const intent = (id: string, wallet = 'W', reference = `ref-${id}`) => ({
  id, wallet, amountBase: 1_000_000n, reference, recipient: 'T', mint: 'M', blockhash: 'B', lastValidBlockHeight: 10,
})

async function balance(wallet = 'W'): Promise<number> {
  const { rows } = await pglite.query<{ b: string }>('SELECT balance_micro::text AS b FROM accounts WHERE wallet = $1', [wallet])
  return Number(rows[0]!.b)
}

beforeAll(async () => {
  ;({ db, pglite } = await createTestDb())
})

beforeEach(async () => {
  await pglite.exec('TRUNCATE topup_intents, usage_records, api_keys, accounts CASCADE')
  await pglite.exec(`INSERT INTO accounts (wallet) VALUES ('W'), ('X')`)
})

describe('top-up intents', () => {
  it('credits a signature at most once', async () => {
    await createIntent(db, intent('i1'))
    expect(await creditTopUp(db, 'i1', 'SIG1')).toBe(1_000_000)
    expect(await creditTopUp(db, 'i1', 'SIG1')).toBe(0)
    expect(await balance()).toBe(1_000_000)
  })

  it('rejects one signature for two intents', async () => {
    await createIntent(db, intent('i1'))
    await createIntent(db, intent('i2'))
    await creditTopUp(db, 'i1', 'SIG1')
    await expect(creditTopUp(db, 'i2', 'SIG1')).rejects.toThrow()
    expect(await balance()).toBe(1_000_000)
  })

  it('claims only the owner’s pending intent, once', async () => {
    await createIntent(db, intent('i1'))
    expect(await claimIntent(db, 'i1', 'X')).toBeNull()
    expect((await claimIntent(db, 'i1', 'W'))?.reference).toBe('ref-i1')
    expect(await claimIntent(db, 'i1', 'W')).toBeNull()
    await releaseClaim(db, 'i1')
    expect(await claimIntent(db, 'i1', 'W')).not.toBeNull()
  })

  it('does not credit a failed intent', async () => {
    await createIntent(db, intent('i1'))
    await failIntent(db, 'i1', 'amount not transferred')
    expect(await creditTopUp(db, 'i1', 'SIG1')).toBe(0)
    expect(await balance()).toBe(0)
  })

  it('lists reconcilable intents: submitting, and pending within the hour', async () => {
    await createIntent(db, intent('sub'))
    await claimIntent(db, 'sub', 'W')
    await setSignature(db, 'sub', 'SIGSUB')
    await createIntent(db, intent('fresh'))
    await createIntent(db, intent('old'))
    await pglite.exec(`UPDATE topup_intents SET created_at = now() - interval '2 hours' WHERE id = 'old'`)
    await createIntent(db, intent('other', 'X'))
    const ids = (await reconcilableIntents(db, 'W')).map(i => i.id).sort()
    expect(ids).toEqual(['fresh', 'sub'])
  })

  it('lists a wallet’s intents newest first with string amounts', async () => {
    await createIntent(db, intent('a'))
    await createIntent(db, intent('b'))
    await pglite.exec(`UPDATE topup_intents SET created_at = now() - interval '1 minute' WHERE id = 'a'`)
    const list = await listIntents(db, 'W', 50)
    expect(list.map(i => i.id)).toEqual(['b', 'a'])
    expect(list[0]).toMatchObject({ amountMicro: '1000000', status: 'pending', txSignature: null })
  })
})
