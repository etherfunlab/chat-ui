import { describe, it, expect, vi, beforeEach } from 'vitest'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { buildSignInMessage } from '#shared/siws'

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('readBody', (event: { _body: unknown }) => event._body)
vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))
vi.stubGlobal('getRequestURL', () => new URL('https://chat.test/api/auth/nonce'))

const assertSameOrigin = vi.fn()
const query = vi.fn(async () => ({ rows: [] }))
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ query }) }))

const { default: handler } = await import('./nonce.post')
const evt = (body: unknown) => ({ _body: body }) as never
const wallet = bs58.encode(nacl.sign.keyPair().publicKey)

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/auth/nonce', () => {
  it('rejects an invalid wallet address with 400', async () => {
    await expect(handler(evt({ wallet: 'abc' }))).rejects.toMatchObject({ statusCode: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('stores the nonce and returns the exact message to sign', async () => {
    const out = await handler(evt({ wallet }))
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO auth_nonces/i), expect.any(Array))
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(params[0]).toBe(out.nonce)
    expect(params[1]).toBe(wallet)
    expect(out.message).toBe(buildSignInMessage({
      domain: 'chat.test', address: wallet, nonce: out.nonce, issuedAt: params[2] as string,
    }))
  })
})
