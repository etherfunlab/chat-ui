import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))

const assertSameOrigin = vi.fn()
const sessionClear = vi.fn()
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin }))
vi.mock('#server/utils/session', () => ({
  useAppSession: async () => ({ data: {}, update: vi.fn(), clear: sessionClear }),
}))

const { default: handler } = await import('./logout.post')

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/auth/logout', () => {
  it('clears the session', async () => {
    const out = await handler({} as never)
    expect(sessionClear).toHaveBeenCalled()
    expect(out).toEqual({ ok: true })
  })

  it('rejects cross-origin logout', async () => {
    assertSameOrigin.mockImplementation(() => {
      throw Object.assign(new Error('x'), { statusCode: 403 })
    })
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(sessionClear).not.toHaveBeenCalled()
  })
})
