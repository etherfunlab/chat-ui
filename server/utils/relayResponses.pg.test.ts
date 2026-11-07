// Integration tests: the Responses API through the relay, against a real ledger (PGlite).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../../tests/helpers/pg'
import fixture from './__fixtures__/venice-models.json'
import { createCatalog } from './catalog'
import type { ServerConfig } from './config'
import type { Queryable } from './queryable'
import { relayResponses, type RelayDeps } from './relay'

let db: Queryable
let pglite: PGlite
let seq = 0

const enc = new TextEncoder()
const OPUS = 'claude-opus-5-5'

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  billing: 'on',
  databaseUrl: 'postgres://x',
  sessionSecret: 's'.repeat(32),
  veniceApiKey: 'vk',
  veniceBaseUrl: 'https://upstream.test',
  models: [OPUS],
  allowedWallets: new Set(),
  markupBps: 1000,
  markupExemptWallets: new Set(),
  searchFeeMicro: 10000,
  solanaRpcUrl: 'https://rpc.test',
  solanaTreasury: 'T',
  usdcMint: 'M',
  ...over,
})

const catalog = createCatalog({ fetchModels: async () => fixture, modelIds: [OPUS] })

interface Call { path: string, body: Record<string, unknown>, signal: AbortSignal }

const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
const ev = (type: string, extra: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
const DONE = 'data: [DONE]\n\n'

function scripted(chunks: string[], o: { status?: number, json?: unknown, text?: string } = {}) {
  const calls: Call[] = []
  const upstream: RelayDeps['upstream'] = async (path, body, signal) => {
    calls.push({ path, body: body as Record<string, unknown>, signal })
    if (o.status && o.status !== 200) return new Response(o.text ?? '', { status: o.status })
    if (o.json !== undefined) return new Response(JSON.stringify(o.json), { status: 200, headers: { 'content-type': 'application/json' } })
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return { upstream, calls }
}

const deps = (upstream: RelayDeps['upstream']): RelayDeps => ({ config: config(), db, catalog, upstream, newId: () => `q${++seq}` })

const body = (over: Record<string, unknown> = {}) => JSON.stringify({ model: OPUS, stream: true, input: 'hello', ...over })

const req = (rawBody: string) => ({
  auth: { keyHash: 'h1' }, rawBody, signal: new AbortController().signal, emitUsageEvent: false, disconnect: 'drain' as const,
})

async function account(wallet = 'W') {
  const { rows } = await pglite.query<{ b: string, h: string }>(
    'SELECT balance_micro::text AS b, held_micro::text AS h FROM accounts WHERE wallet = $1', [wallet])
  return { balance: Number(rows[0]!.b), held: Number(rows[0]!.h) }
}

async function lastRecord() {
  const { rows } = await pglite.query<Record<string, unknown>>('SELECT * FROM usage_records ORDER BY created_at DESC, id DESC LIMIT 1')
  return rows[0]
}

beforeAll(async () => {
  ;({ db, pglite } = await createTestDb())
})

beforeEach(async () => {
  await pglite.exec('TRUNCATE usage_records, api_keys, topup_intents, accounts CASCADE')
  await pglite.exec(`INSERT INTO accounts (wallet, balance_micro) VALUES ('W', 1000000)`)
  await pglite.exec(`INSERT INTO api_keys (id, wallet, name, key_hash, key_prefix) VALUES ('k1', 'W', 'k', 'h1', 'cu-xxxxxxx')`)
})

describe('relayResponses', () => {
  it('streams a responses answer through, settles by usage and resends [DONE]', async () => {
    const { upstream, calls } = scripted([
      ev('response.created', { response: { id: 'r1', status: 'in_progress' } }),
      ev('response.output_text.delta', { delta: 'Hel' }),
      ev('response.output_text.delta', { delta: 'lo' }),
      ev('response.completed', { response: { id: 'r1', status: 'completed', output: [], usage } }),
      DONE,
    ])
    const res = await relayResponses(deps(upstream), req(body()))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(calls[0]!.path).toBe('/responses')
    expect(calls[0]!.body.max_output_tokens).toBeGreaterThan(0)
    expect(calls[0]!.body.store).toBe(false)
    expect(text).toContain('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n')
    expect(text).toContain('event: response.completed')
    expect(text).not.toContain('chatui-usage')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
    // opus: 100 × $4/M + 20 × $20/M = 800 micro, ×1.1
    expect(await account()).toEqual({ balance: 1_000_000 - 880, held: 0 })
    expect(await lastRecord()).toMatchObject({ status: 'ok', endpoint: 'responses', api_key_id: 'k1', input_tokens: 100, output_tokens: 20 })
  })

  it('settles an incomplete / failed response by its usage', async () => {
    const { upstream } = scripted([
      ev('response.output_text.delta', { delta: 'par' }),
      ev('response.failed', { response: { id: 'r1', status: 'failed', error: { code: 'server_error', message: 'x' }, usage } }),
      DONE,
    ])
    const text = await (await relayResponses(deps(upstream), req(body()))).text()
    expect(text).toContain('response.failed')
    const r = await lastRecord()
    expect(r).toMatchObject({ status: 'error', output_tokens: 20 })
    expect(Number(r!.cost_micro)).toBe(880)
    expect((await account()).held).toBe(0)

    const { upstream: u2 } = scripted([
      ev('response.incomplete', { response: { id: 'r2', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage } }),
      DONE,
    ])
    await (await relayResponses(deps(u2), req(body()))).text()
    expect(await lastRecord()).toMatchObject({ status: 'ok', output_tokens: 20 })
  })

  it('strips a cost nested in the completed event and still charges by it', async () => {
    const { upstream } = scripted([
      ev('response.output_text.delta', { delta: 'x' }),
      ev('response.completed', { response: { status: 'completed', output: [], usage, cost: { usd: 0.001, diem: 0 } } }),
      DONE,
    ])
    const text = await (await relayResponses(deps(upstream), req(body()))).text()
    expect(text).toContain('event: response.completed')
    expect(text).not.toContain('"cost"')
    expect((await account()).balance).toBe(1_000_000 - 1100)
  })

  it('charges the search fee for a web_search tool when no cost is reported', async () => {
    const { upstream } = scripted([ev('response.completed', { response: { status: 'completed', output: [], usage } }), DONE])
    await (await relayResponses(deps(upstream), req(body({ tools: [{ type: 'web_search' }] })))).text()
    const r = await lastRecord()
    expect(r).toMatchObject({ web_search: true })
    // 800 + 10000 search fee, ×1.1
    expect(Number(r!.cost_micro)).toBe(11880)
  })

  it('non-stream: returns the response object with cost removed and settles ok', async () => {
    const json = { id: 'r1', object: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }], usage }
    const { upstream } = scripted([], { json: { ...json, cost: { usd: 0.001, diem: 0 } } })
    const res = await relayResponses(deps(upstream), req(body({ stream: false })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(json)
    expect(await account()).toEqual({ balance: 1_000_000 - 1100, held: 0 })
    expect(await lastRecord()).toMatchObject({ status: 'ok' })
  })

  it('rejects previous_response_id with 400 before touching the ledger', async () => {
    const { upstream, calls } = scripted([])
    const res = await relayResponses(deps(upstream), req(body({ previous_response_id: 'r0' })))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('unsupported_parameter')
    expect(calls).toHaveLength(0)
    expect(await lastRecord()).toBeUndefined()
  })

  it('rejects a revoked or unknown key with 401', async () => {
    const res = await relayResponses(deps(scripted([]).upstream), { ...req(body()), auth: { keyHash: 'nope' } })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('invalid_api_key')
  })
})
