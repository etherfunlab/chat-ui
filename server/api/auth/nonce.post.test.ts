import { describe, it, expect, vi, beforeEach } from 'vitest'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { buildSignInMessage } from '#shared/siws'

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('readBody', (event: { _body: unknown }) => event._body)
vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))
const assertSameOrigin = vi.fn()
const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }))
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ query }) }))
vi.mock('#server/utils/appOrigin', () => ({ getAppUrl: () => new URL('https://chat.test/') }))

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
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO auth_nonces/i.test(sql as unknown as string))
    expect(insert).toBeDefined()
    const [, params] = insert as unknown as [string, unknown[]]
    expect(params[0]).toBe(out.nonce)
    expect(params[1]).toBe(wallet)
    expect(out.message).toBe(buildSignInMessage({
      domain: 'chat.test', address: wallet, nonce: out.nonce, issuedAt: params[2] as string,
    }))
  })
})
