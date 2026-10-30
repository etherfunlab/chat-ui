import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('getRequestURL', (_e: unknown, opts?: Record<string, unknown>) => {
  return opts?.xForwardedHost
    ? new URL('https://forwarded.example/api/x')
    : new URL('https://direct.example/api/x')
})

const getServerConfig = vi.fn()
vi.mock('#server/utils/config', () => ({ getServerConfig }))

const { getAppUrl } = await import('./appOrigin')
const evt = {} as never

beforeEach(() => {
  getServerConfig.mockReturnValue({ publicOrigin: undefined })
})

describe('getAppUrl', () => {
  it('uses the forwarded request URL when PUBLIC_ORIGIN is unset', () => {
    expect(getAppUrl(evt).origin).toBe('https://forwarded.example')
  })

  it('uses PUBLIC_ORIGIN when set, ignoring forwarded headers', () => {
    getServerConfig.mockReturnValue({ publicOrigin: 'https://chat.example.com' })
    expect(getAppUrl(evt).origin).toBe('https://chat.example.com')
    expect(getAppUrl(evt).host).toBe('chat.example.com')
  })
})
