import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals } from '../../tests/helpers/h3'

stubH3Globals()
const readRawBody = vi.fn()
const sendWebResponse = vi.fn((_e: unknown, res: Response) => res)
vi.stubGlobal('readRawBody', readRawBody)
vi.stubGlobal('sendWebResponse', sendWebResponse)

const assertSameOrigin = vi.fn()
const requireWallet = vi.fn()
const relayChat = vi.fn()
const signal = new AbortController().signal
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin }))
vi.mock('#server/utils/session', () => ({ requireWallet }))
vi.mock('#server/utils/relay', () => ({ relayChat }))
vi.mock('#server/utils/relayDeps', () => ({ getRelayDeps: () => ({ marker: 'deps' }) }))
vi.mock('#server/utils/abort', () => ({ clientAbortSignal: () => signal }))

const { default: handler } = await import('./chat.post')
const evt = {} as never

beforeEach(() => {
  vi.clearAllMocks()
  requireWallet.mockResolvedValue('W')
  readRawBody.mockResolvedValue('{"model":"m"}')
  relayChat.mockResolvedValue(new Response('ok'))
})

describe('POST /api/chat', () => {
  it('relays the raw body for the signed-in wallet with the usage event on', async () => {
    const res = await handler(evt)
    expect(relayChat).toHaveBeenCalledWith({ marker: 'deps' }, {
      auth: { wallet: 'W' }, rawBody: '{"model":"m"}', signal, emitUsageEvent: true,
    })
    expect(sendWebResponse).toHaveBeenCalledWith(evt, expect.any(Response))
    expect(await (res as Response).text()).toBe('ok')
  })

  it('treats an empty body as an empty string', async () => {
    readRawBody.mockResolvedValue(undefined)
    await handler(evt)
    expect(relayChat.mock.calls[0]![1].rawBody).toBe('')
  })

  it('rejects cross-origin requests before reading anything', async () => {
    assertSameOrigin.mockImplementationOnce(() => { throw Object.assign(new Error('x'), { statusCode: 403 }) })
    await expect(handler(evt)).rejects.toMatchObject({ statusCode: 403 })
    expect(relayChat).not.toHaveBeenCalled()
  })

  it('rejects a request without a session', async () => {
    requireWallet.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
    await expect(handler(evt)).rejects.toMatchObject({ statusCode: 401 })
    expect(relayChat).not.toHaveBeenCalled()
  })
})
