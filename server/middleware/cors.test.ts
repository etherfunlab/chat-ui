import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals } from '../../tests/helpers/h3'

stubH3Globals()
const setResponseHeaders = vi.fn()
const setResponseStatus = vi.fn()
const send = vi.fn()
vi.stubGlobal('setResponseHeaders', setResponseHeaders)
vi.stubGlobal('setResponseStatus', setResponseStatus)
vi.stubGlobal('send', send)

const { default: middleware } = await import('./cors')
const event = (path: string, method = 'GET') => ({ path, method }) as never

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

  it('leaves /api and everything else alone', async () => {
    await middleware(event('/api/me'))
    await middleware(event('/v1extra'))
    await middleware(event('/'))
    expect(setResponseHeaders).not.toHaveBeenCalled()
  })
})
