// Integration tests: the relay against a real ledger (PGlite) and a scripted upstream.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../../tests/helpers/pg'
import fixture from './__fixtures__/venice-models.json'
import { createCatalog } from './catalog'
import type { ServerConfig } from './config'
import type { Queryable } from './queryable'
import { relayChat, type RelayDeps } from './relay'

let db: Queryable
let pglite: PGlite
let seq = 0

const enc = new TextEncoder()
const OPUS = 'claude-opus-5-5'
const KEY = 'vk-secret-key-123'

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  billing: 'on',
  databaseUrl: 'postgres://x',
  sessionSecret: 's'.repeat(32),
  veniceApiKey: KEY,
  veniceBaseUrl: 'https://upstream.test',
  models: [OPUS],
  allowedWallets: new Set(),
  markupBps: 1000,
  markupExemptWallets: new Set(['VIP']),
  searchFeeMicro: 10000,
  solanaRpcUrl: 'https://rpc.test',
  solanaTreasury: 'T',
  usdcMint: 'M',
  ...over,
})

const catalog = createCatalog({
  fetchModels: async () => fixture,
  modelIds: [OPUS, 'deepseek-v4-1-flash-1017-uncensored', 'gemini-4-argon', 'openai-gpt-61-sol'],
})

interface Call { path: string, body: Record<string, unknown>, signal: AbortSignal }

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta }], ...extra })}\n\n`
const usageChunk = (u: Record<string, unknown>, cost?: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [], usage: u, ...(cost ? { cost } : {}) })}\n\n`
const DONE = 'data: [DONE]\n\n'

function scripted(chunks: string[], o: { hang?: boolean, status?: number, json?: unknown, text?: string, throws?: boolean } = {}) {
  const calls: Call[] = []
  const upstream: RelayDeps['upstream'] = async (path, body, signal) => {
    calls.push({ path, body: body as Record<string, unknown>, signal })
    if (o.throws) throw new TypeError('fetch failed')
    if (o.status && o.status !== 200) return new Response(o.text ?? '', { status: o.status })
    if (o.json !== undefined) return new Response(JSON.stringify(o.json), { status: 200, headers: { 'content-type': 'application/json' } })
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        if (o.hang) signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
        else c.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return { upstream, calls }
}

function deps(upstream: RelayDeps['upstream'], over: Partial<RelayDeps> = {}): RelayDeps {
  return { config: config(), db, catalog, upstream, newId: () => `r${++seq}`, ...over }
}

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ model: OPUS, stream: true, messages: [{ role: 'user', content: 'hello' }], ...over })

const req = (rawBody: string, over: Record<string, unknown> = {}) =>
  ({ auth: { wallet: 'W' }, rawBody, signal: new AbortController().signal, emitUsageEvent: true, ...over }) as Parameters<typeof relayChat>[1]

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
  await pglite.exec(`INSERT INTO accounts (wallet, balance_micro) VALUES ('W', 1000000), ('VIP', 1000000)`)
})

describe('relayChat — streaming', () => {
  it('streams through, settles with reported cost, and emits the usage event before [DONE]', async () => {
    const { upstream } = scripted([
      chunk({ content: 'Hel' }),
      chunk({ content: 'lo' }),
      usageChunk({ prompt_tokens: 100, completion_tokens: 20 }, { usd: 0.001, diem: 0 }),
      DONE,
    ])
    const res = await relayChat(deps(upstream), req(body()))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const text = await res.text()
    expect(text).toContain('"content":"Hel"')
    expect(text).toContain('"content":"lo"')
    expect(text).not.toContain('"prompt_tokens"') // client did not ask for the usage chunk
    const usageAt = text.indexOf('event: chatui-usage')
    expect(usageAt).toBeGreaterThan(-1)
    expect(text.indexOf('data: [DONE]')).toBeGreaterThan(usageAt)
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
    const usageLine = text.slice(usageAt).split('\n')[1]!.slice('data: '.length)
    expect(JSON.parse(usageLine)).toMatchObject({ costMicro: '1100', usage: { inputTokens: 100, outputTokens: 20 } })
    expect(await account()).toEqual({ balance: 1_000_000 - 1100, held: 0 })
    expect(await lastRecord()).toMatchObject({ status: 'ok', input_tokens: 100, output_tokens: 20 })
  })

  it('forwards the usage chunk when the client asked for it', async () => {
    const { upstream } = scripted([chunk({ content: 'x' }), usageChunk({ prompt_tokens: 1, completion_tokens: 1 }), DONE])
    const res = await relayChat(deps(upstream), req(body({ stream_options: { include_usage: true } })))
    expect(await res.text()).toContain('"prompt_tokens":1')
  })

  it('omits the usage event when emitUsageEvent is false', async () => {
    const { upstream } = scripted([chunk({ content: 'x' }), usageChunk({ prompt_tokens: 1, completion_tokens: 1 }), DONE])
    const text = await (await relayChat(deps(upstream), req(body(), { emitUsageEvent: false }))).text()
    expect(text).not.toContain('chatui-usage')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('falls back to token pricing when the upstream reports no cost', async () => {
    const { upstream } = scripted([chunk({ content: 'x' }), usageChunk({ prompt_tokens: 100, completion_tokens: 20 }), DONE])
    await (await relayChat(deps(upstream), req(body()))).text()
    // opus: 100 × $4/M + 20 × $20/M = 800 micro, ×1.1
    expect(await account()).toEqual({ balance: 1_000_000 - 880, held: 0 })
  })

  it('estimates usage when the stream carries none', async () => {
    const { upstream } = scripted([chunk({ content: 'Hello world, this is the answer.' }), DONE])
    await (await relayChat(deps(upstream), req(body()))).text()
    const r = await lastRecord()
    expect(r).toMatchObject({ status: 'ok' })
    expect(Number(r!.cost_micro)).toBeGreaterThan(0)
    expect(Number(r!.output_tokens)).toBeGreaterThan(0)
    expect((await account()).held).toBe(0)
  })

  it('settles an aborted stream from what was received', async () => {
    const { upstream, calls } = scripted([chunk({ content: 'partial answer' })], { hang: true })
    const client = new AbortController()
    const res = await relayChat(deps(upstream), req(body(), { signal: client.signal }))
    const reader = res.body!.getReader()
    await reader.read()
    client.abort()
    await vi.waitFor(async () => expect((await lastRecord())!.status).toBe('aborted'))
    expect(calls[0]!.signal.aborted).toBe(true)
    expect(Number((await lastRecord())!.cost_micro)).toBeGreaterThan(0)
    expect((await account()).held).toBe(0)
  })

  it('aborts the upstream after the relay time limit', async () => {
    const { upstream, calls } = scripted([chunk({ content: 'slow' })], { hang: true })
    const res = await relayChat(deps(upstream, { maxMs: 50 }), req(body()))
    await res.text()
    expect(calls[0]!.signal.aborted).toBe(true)
    expect((await lastRecord())!.status).toBe('aborted')
    expect((await account()).held).toBe(0)
  })

  it('treats a mid-stream upstream failure as cut short, charging what was received', async () => {
    const calls: Call[] = []
    const upstream: RelayDeps['upstream'] = async (path, b, signal) => {
      calls.push({ path, body: b as Record<string, unknown>, signal })
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(chunk({ content: 'some text' })))
          c.error(new Error('connection reset'))
        },
      })
      return new Response(stream, { status: 200 })
    }
    await (await relayChat(deps(upstream), req(body()))).text().catch(() => '')
    await vi.waitFor(async () => expect((await lastRecord())!.status).toBe('aborted'))
    expect((await account()).held).toBe(0)
  })
})

describe('relayChat — stream robustness', () => {
  it('settles an upstream success without a body as an error', async () => {
    const upstream: RelayDeps['upstream'] = async () => new Response(null, { status: 204 })
    await (await relayChat(deps(upstream), req(body()))).text()
    expect(await lastRecord()).toMatchObject({ status: 'error' })
    expect((await account()).held).toBe(0)
  })

  it('treats a stream that ends without [DONE] or finish_reason as cut short', async () => {
    const { upstream } = scripted([chunk({ content: 'half an ans' })])
    const text = await (await relayChat(deps(upstream), req(body()))).text()
    expect(text).not.toContain('data: [DONE]')
    expect(await lastRecord()).toMatchObject({ status: 'aborted' })
  })

  it('completes when finish_reason arrives even without [DONE]', async () => {
    const { upstream } = scripted([`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'all' }, finish_reason: 'stop' }] })}\n\n`])
    const text = await (await relayChat(deps(upstream), req(body()))).text()
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
    expect(await lastRecord()).toMatchObject({ status: 'ok' })
  })

  it('stops at the upstream [DONE]', async () => {
    const { upstream } = scripted([chunk({ content: 'answer' }), DONE, chunk({ content: 'AFTER-DONE' })])
    const text = await (await relayChat(deps(upstream), req(body()))).text()
    expect(text).not.toContain('AFTER-DONE')
  })

  it('forwards upstream comments such as keepalives', async () => {
    const { upstream } = scripted([': keepalive\n\n', chunk({ content: 'x' }), DONE])
    expect(await (await relayChat(deps(upstream), req(body()))).text()).toContain(': keepalive\n\n')
  })

  it('terminates an unterminated last event before injecting its own', async () => {
    const { upstream } = scripted([chunk({ content: 'x' }), `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`])
    const text = await (await relayChat(deps(upstream), req(body()))).text()
    expect(text).toMatch(/"finish_reason":"stop"\}\]\}\n\nevent: chatui-usage\n/)
  })

  it('withholds the usage event when settlement keeps failing', async () => {
    const failing: Queryable = {
      query: (sql: string, params?: unknown[]) => (sql.includes('settle_charge') ? Promise.reject(new Error('db down')) : db.query(sql, params)),
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { upstream } = scripted([chunk({ content: 'x' }), usageChunk({ prompt_tokens: 1, completion_tokens: 1 }), DONE])
    const text = await (await relayChat(deps(upstream, { db: failing }), req(body()))).text()
    expect(text).not.toContain('chatui-usage')
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it('never lets a stalled error body hold up settlement', async () => {
    const upstream: RelayDeps['upstream'] = async () => new Response(new ReadableStream({ start() {} }), { status: 500 })
    const res = await relayChat(deps(upstream, { errorBodyMs: 50 }), req(body()))
    expect(res.status).toBe(502)
    expect(await lastRecord()).toMatchObject({ status: 'error' })
  })
})

describe('relayChat — holds and limits', () => {
  it('caps max_completion_tokens to what the hold affords', async () => {
    await pglite.exec(`UPDATE accounts SET balance_micro = 50000 WHERE wallet = 'W'`)
    const { upstream, calls } = scripted([chunk({ content: 'x' }), DONE])
    await (await relayChat(deps(upstream), req(body()))).text()
    const maxOut = calls[0]!.body.max_completion_tokens as number
    expect(maxOut).toBeGreaterThan(1000)
    expect(maxOut).toBeLessThan(128000)
  })

  it('always sends max_completion_tokens, also with billing off', async () => {
    const { upstream, calls } = scripted([chunk({ content: 'x' }), DONE])
    const off = config({ billing: 'off', allowedWallets: new Set(['W']) })
    await (await relayChat(deps(upstream, { config: off }), req(body()))).text()
    expect(calls[0]!.body.max_completion_tokens).toBe(128000)
    expect(await account()).toEqual({ balance: 1_000_000, held: 0 })
    expect(Number((await lastRecord())!.cost_micro)).toBeGreaterThan(0)
  })

  it('refuses with 402 insufficient_balance and calls no upstream', async () => {
    await pglite.exec(`UPDATE accounts SET balance_micro = 0 WHERE wallet = 'W'`)
    const { upstream, calls } = scripted([])
    const res = await relayChat(deps(upstream), req(body()))
    expect(res.status).toBe(402)
    expect((await res.json()).error.code).toBe('insufficient_balance')
    expect(calls).toHaveLength(0)
  })

  it('rejects a body over 4.5MB with 413 before touching the ledger', async () => {
    const { upstream, calls } = scripted([])
    const huge = body({ messages: [{ role: 'user', content: 'x'.repeat(4_600_000) }] })
    const res = await relayChat(deps(upstream), req(huge))
    expect(res.status).toBe(413)
    expect((await res.json()).error.code).toBe('request_too_large')
    expect(calls).toHaveLength(0)
    expect(await lastRecord()).toBeUndefined()
  })

  it('returns prepareChat errors as OpenAI-shaped 400s', async () => {
    const res = await relayChat(deps(scripted([]).upstream), req(body({ model: 'nope' })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { message: expect.any(String), type: 'invalid_request_error', code: 'model_not_found' } })
  })

  it('rejects invalid JSON with 400 invalid_json', async () => {
    const res = await relayChat(deps(scripted([]).upstream), req('{not json'))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_json')
  })
})

describe('relayChat — billing rules', () => {
  it('caps an implausible reported cost at twice the token-price cost', async () => {
    const { upstream } = scripted([chunk({ content: 'x' }), usageChunk({ prompt_tokens: 100, completion_tokens: 20 }, { usd: 100 }), DONE])
    await (await relayChat(deps(upstream), req(body()))).text()
    // token-price cost 800 micro → cap 1600, ×1.1
    expect((await account()).balance).toBe(1_000_000 - 1760)
  })

  it('applies the wallet markup at settlement', async () => {
    // 100 in / 20 out = 800 micro at list prices; the reported 1000 is within the 2× cap.
    const script = () => scripted([chunk({ content: 'x' }), usageChunk({ prompt_tokens: 100, completion_tokens: 20 }, { usd: 0.001 }), DONE])
    await (await relayChat(deps(script().upstream), req(body(), { auth: { wallet: 'VIP' } }))).text()
    expect((await account('VIP')).balance).toBe(1_000_000 - 1000)
    await (await relayChat(deps(script().upstream), req(body()))).text()
    expect((await account('W')).balance).toBe(1_000_000 - 1100)
  })

  it('charges web search for on, and for auto only when citations came back', async () => {
    const citations = { venice_parameters: { web_search_citations: [{ title: 'A', url: 'https://a.example' }] } }
    const run = async (mode: string, withCitations: boolean) => {
      const first = withCitations ? chunk({ content: '' }, citations) : chunk({ content: '' })
      const { upstream } = scripted([first, chunk({ content: 'x' }), usageChunk({ prompt_tokens: 100, completion_tokens: 20 }), DONE])
      await (await relayChat(deps(upstream), req(body({ venice_parameters: { enable_web_search: mode } })))).text()
      return lastRecord()
    }
    // 800 micro of tokens + 10000 search fee, ×1.1
    const on = await run('on', false)
    expect(on).toMatchObject({ web_search: true })
    expect(Number(on!.cost_micro)).toBe(11880)
    expect(await run('auto', true)).toMatchObject({ web_search: true })
    const auto = await run('auto', false)
    expect(auto).toMatchObject({ web_search: false })
    expect(Number(auto!.cost_micro)).toBe(880)
  })
})

describe('relayChat — upstream failures', () => {
  it('maps upstream 401 to 502 upstream_auth without echoing the upstream body', async () => {
    const { upstream } = scripted([], { status: 401, text: '{"error":"secret-upstream-detail"}' })
    const res = await relayChat(deps(upstream), req(body()))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text).error.code).toBe('upstream_auth')
    expect(text).not.toContain('secret-upstream-detail')
  })

  it('settles error with zero cost on an upstream failure', async () => {
    const { upstream } = scripted([], { throws: true })
    const res = await relayChat(deps(upstream), req(body()))
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
    const r = await lastRecord()
    expect(r).toMatchObject({ status: 'error' })
    expect(Number(r!.cost_micro)).toBe(0)
    expect(await account()).toEqual({ balance: 1_000_000, held: 0 })
  })

  it('passes an upstream 400 message through, scrubbed of the upstream key', async () => {
    const { upstream } = scripted([], { status: 400, text: JSON.stringify({ error: { message: `bad request for Bearer ${KEY}` } }) })
    const res = await relayChat(deps(upstream), req(body()))
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(JSON.parse(text).error.code).toBe('upstream_rejected')
    expect(text).not.toContain(KEY)
  })

  it('maps upstream 429 to 429 upstream_rate_limited', async () => {
    const res = await relayChat(deps(scripted([], { status: 429 }).upstream), req(body()))
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('upstream_rate_limited')
  })
})

describe('relayChat — non-streaming', () => {
  it('charges a non-stream request in full even when the client disconnects', async () => {
    const json = { choices: [{ index: 0, message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, cost: { usd: 0.0002, diem: 0 } }
    const { upstream, calls } = scripted([], { json })
    const client = new AbortController()
    client.abort()
    await relayChat(deps(upstream), req(body({ stream: false }), { signal: client.signal }))
    expect(calls[0]!.signal.aborted).toBe(false)
    expect(await lastRecord()).toMatchObject({ status: 'ok' })
    expect(await account()).toEqual({ balance: 1_000_000 - 220, held: 0 })
  })

  it('returns the upstream JSON and settles from it', async () => {
    const json = {
      choices: [{ index: 0, message: { role: 'assistant', content: 'done' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      cost: { usd: 0.0002, diem: 0 },
    }
    const { upstream } = scripted([], { json })
    const res = await relayChat(deps(upstream), req(body({ stream: false })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(json)
    expect(await account()).toEqual({ balance: 1_000_000 - 220, held: 0 })
  })
})
