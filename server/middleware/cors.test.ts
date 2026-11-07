import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals } from '../../tests/helpers/h3'

stubH3Globals()
const setResponseHeaders = vi.fn()
const setResponseStatus = vi.fn()
const send = vi.fn()
vi.stubGlobal('setResponseHeaders', setResponseHeaders)
vi.stubGlobal('setResponseStatus', setResponseStatus)
vi.stubGlobal('send', send)

vi.stubGlobal('getHeader', (e: { headers: Record<string, string> }, name: string) => e.headers[name])

const { default: middleware } = await import('./cors')
const event = (path: string, method = 'GET', headers: Record<string, string> = {}) => ({ path, method, headers }) as never

beforeEach(() => vi.clearAllMocks())

describe('CORS middleware', () => {
  it('opens /v1 to any origin without credentials', async () => {
    await middleware(event('/v1/models'))
    expect(setResponseHeaders).toHaveBeenCalledWith(expect.anything(), {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': 86400,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('answers a preflight with 204 and nothing else', async () => {
    await middleware(event('/v1/chat/completions', 'OPTIONS'))
    expect(setResponseHeaders).toHaveBeenCalled()
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 204)
    expect(send).toHaveBeenCalled()
  })

  it('allows whatever headers a preflight asks for, as the SDKs send their own', async () => {
    await middleware(event('/v1/chat/completions', 'OPTIONS', { 'access-control-request-headers': 'authorization, x-stainless-os, content-type' }))
    expect(setResponseHeaders).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      'access-control-allow-headers': 'authorization, x-stainless-os, content-type',
    }))
  })

  it('leaves /api and everything else alone', async () => {
    await middleware(event('/api/me'))
    await middleware(event('/v1extra'))
    await middleware(event('/'))
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })
})
