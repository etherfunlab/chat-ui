import { describe, it, expect, vi } from 'vitest'

vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))

const headers = new Map<string, string>()
vi.stubGlobal('getHeader', (_e: unknown, name: string) => headers.get(name))
vi.stubGlobal('getRequestURL', () => new URL('https://chat.test/api/auth/verify'))

const { assertSameOrigin } = await import('./sameOrigin')
const evt = {} as never

describe('assertSameOrigin', () => {
  it('passes a same-origin request', () => {
    headers.clear()
    headers.set('origin', 'https://chat.test')
    expect(() => assertSameOrigin(evt)).not.toThrow()
  })

  it('rejects a cross-origin request with 403', () => {
    headers.clear()
    headers.set('origin', 'https://evil.example')
    expect(() => assertSameOrigin(evt)).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('falls back to referer and rejects a missing source', () => {
    headers.clear()
    headers.set('referer', 'https://chat.test/some/page')
    expect(() => assertSameOrigin(evt)).not.toThrow()
    headers.clear()
    expect(() => assertSameOrigin(evt)).toThrow(expect.objectContaining({ statusCode: 403 }))
  })
})
