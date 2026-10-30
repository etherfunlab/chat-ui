import { describe, it, expect, vi, beforeEach } from 'vitest'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { buildSignInMessage } from '#shared/siws'

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('readBody', (event: { _body: unknown }) => event._body)
vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))
const assertSameOrigin = vi.fn()
const getServerConfig = vi.fn()
const query = vi.fn()
const sessionUpdate = vi.fn()
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin }))
vi.mock('#server/utils/config', () => ({ getServerConfig }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ query }) }))
vi.mock('#server/utils/session', () => ({
  useAppSession: async () => ({ data: {}, update: sessionUpdate, clear: vi.fn() }),
}))
vi.mock('#server/utils/appOrigin', () => ({ getAppUrl: () => new URL('https://chat.test/') }))

const { default: handler } = await import('./verify.post')
const evt = (body: unknown) => ({ _body: body }) as never

const kp = nacl.sign.keyPair()
const wallet = bs58.encode(kp.publicKey)
const nonce = 'test-nonce'
const issuedAt = '2026-10-30T10:00:00.000Z'
const message = buildSignInMessage({ domain: 'chat.test', address: wallet, nonce, issuedAt })
const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey))

function mockDb(consumedRow: { issued_at: Date } | undefined) {
  query.mockImplementation(async (sql: string) => {
    if (/UPDATE auth_nonces/i.test(sql)) return { rows: consumedRow ? [consumedRow] : [] }
    return { rows: [] }
  })
}

function insertedAccount(): boolean {
  return query.mock.calls.some(([sql]) => /INSERT INTO accounts/i.test(sql as string))
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerConfig.mockReturnValue({ billing: 'on', allowedWallets: new Set<string>() })
  mockDb({ issued_at: new Date(issuedAt) })
})

describe('POST /api/auth/verify', () => {
  it('verifies, creates the account, and writes the session', async () => {
    const out = await handler(evt({ wallet, nonce, signature }))
    expect(out).toEqual({ wallet })
    expect(insertedAccount()).toBe(true)
    expect(sessionUpdate).toHaveBeenCalledWith({ wallet })
  })

  it('consumes the nonce atomically with replay and expiry guards in the query', async () => {
    await handler(evt({ wallet, nonce, signature }))
    const consume = query.mock.calls.find(([sql]) => /UPDATE auth_nonces/i.test(sql as string))![0] as string
    expect(consume).toMatch(/used_at IS NULL/i)
    expect(consume).toMatch(/expires_at > now\(\)/i)
  })

  it('rejects a reused nonce', async () => {
    mockDb(undefined)
    await expect(handler(evt({ wallet, nonce, signature }))).rejects.toMatchObject({ statusCode: 401 })
    expect(insertedAccount()).toBe(false)
  })

  it('rejects a signature from a different key', async () => {
    const other = nacl.sign.keyPair()
    const badSig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), other.secretKey))
    await expect(handler(evt({ wallet, nonce, signature: badSig }))).rejects.toMatchObject({ statusCode: 401 })
    expect(insertedAccount()).toBe(false)
    expect(sessionUpdate).not.toHaveBeenCalled()
  })

  it('whitelist gate blocks and creates no account', async () => {
    getServerConfig.mockReturnValue({ billing: 'off', allowedWallets: new Set(['someone-else']) })
    await expect(handler(evt({ wallet, nonce, signature }))).rejects.toMatchObject({ statusCode: 403 })
    expect(insertedAccount()).toBe(false)
    expect(sessionUpdate).not.toHaveBeenCalled()
  })

  it('rejects cross-origin verify', async () => {
    assertSameOrigin.mockImplementationOnce(() => {
      throw Object.assign(new Error('Cross-origin request rejected'), { statusCode: 403 })
    })
    await expect(handler(evt({ wallet, nonce, signature }))).rejects.toMatchObject({ statusCode: 403 })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a malformed wallet with 400', async () => {
    await expect(handler(evt({ wallet: 'abc', nonce, signature }))).rejects.toMatchObject({ statusCode: 400 })
    expect(query).not.toHaveBeenCalled()
  })
})
