import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals } from '../../tests/helpers/h3'
import { hashApiKey } from './apiKeys'

stubH3Globals()
const readRawBody = vi.fn()
const sendWebResponse = vi.fn((_e: unknown, res: Response) => res)
vi.stubGlobal('readRawBody', readRawBody)
vi.stubGlobal('sendWebResponse', sendWebResponse)
vi.stubGlobal('getHeader', (e: { headers: Record<string, string> }, name: string) => e.headers[name])

const vercelWaitUntil = vi.fn()
const signal = new AbortController().signal
vi.mock('@vercel/functions', () => ({ waitUntil: vercelWaitUntil }))
vi.mock('#server/utils/relayDeps', () => ({ getRelayDeps: () => ({ marker: 'deps' }) }))
vi.mock('#server/utils/abort', () => ({ clientAbortSignal: () => signal }))

const { bearerHash, keepAlive, relayV1 } = await import('./v1')

const KEY = `cu-${'k'.repeat(43)}`
const event = (headers: Record<string, string> = {}) => ({ headers, waitUntil: vi.fn() }) as never

beforeEach(() => {
  vi.clearAllMocks()
  readRawBody.mockResolvedValue('{"model":"m"}')
})

describe('bearerHash', () => {
  it('hashes the Bearer key', () => {
    expect(bearerHash(event({ authorization: `Bearer ${KEY}` }))).toBe(hashApiKey(KEY))
  })

  it('answers 401 missing_api_key when the header is absent or not a Bearer key', async () => {
    const cases: Record<string, string>[] = [{}, { authorization: `Basic ${KEY}` }, { authorization: 'Bearer nope' }]
    for (const headers of cases) {
      const res = bearerHash(event(headers))
      expect(res).toBeInstanceOf(Response)
      expect((res as Response).status).toBe(401)
      expect((await (res as Response).json()).error.code).toBe('missing_api_key')
    }
  })
})

describe('keepAlive', () => {
  it('hands the work to both the Nitro event and the Vercel runtime', () => {
    const e = event()
    const work = Promise.resolve()
    keepAlive(e, work)
    expect((e as { waitUntil: ReturnType<typeof vi.fn> }).waitUntil).toHaveBeenCalledWith(work)
    expect(vercelWaitUntil).toHaveBeenCalledWith(work)
  })
})

describe('relayV1', () => {
  it('relays by key hash in drain mode without the usage event', async () => {
    const relayFn = vi.fn().mockResolvedValue(new Response('ok'))
    const e = event({ authorization: `Bearer ${KEY}` })
    const res = await relayV1(e, relayFn)
    expect(relayFn).toHaveBeenCalledWith({ marker: 'deps' }, expect.objectContaining({
      auth: { keyHash: hashApiKey(KEY) }, rawBody: '{"model":"m"}', signal, emitUsageEvent: false, disconnect: 'drain',
    }))
    const work = Promise.resolve()
    relayFn.mock.calls[0]![1].keepAlive(work)
    expect(vercelWaitUntil).toHaveBeenCalledWith(work)
    expect(sendWebResponse).toHaveBeenCalledWith(e, expect.any(Response))
    expect(await (res as Response).text()).toBe('ok')
  })

  it('ignores the session cookie', async () => {
    const relayFn = vi.fn()
    const res = await relayV1(event({ cookie: 'cu_session=sealed' }), relayFn)
    expect((res as Response).status).toBe(401)
    expect(relayFn).not.toHaveBeenCalled()
    expect(readRawBody).not.toHaveBeenCalled()
  })

  it('treats an empty body as an empty string', async () => {
    readRawBody.mockResolvedValue(undefined)
    const relayFn = vi.fn().mockResolvedValue(new Response('ok'))
    await relayV1(event({ authorization: `Bearer ${KEY}` }), relayFn)
    expect(relayFn.mock.calls[0]![1].rawBody).toBe('')
  })
})
