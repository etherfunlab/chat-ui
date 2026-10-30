import { describe, it, expect, vi } from 'vitest'
import bs58 from 'bs58'
import { buildSignInMessage } from '#shared/siws'
import { performSignIn } from './useWalletAuth'

const SIG = new Uint8Array([1, 2, 3])
const DOMAIN = 'chat.test'
const ISSUED = '2026-10-30T10:00:00.000Z'
const GOOD_MESSAGE = buildSignInMessage({ domain: DOMAIN, address: 'W', nonce: 'N', issuedAt: ISSUED })

function deps(nonceResponse: Record<string, unknown> = { message: GOOD_MESSAGE, nonce: 'N', issuedAt: ISSUED }) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/auth/nonce') return nonceResponse
    if (url === '/api/auth/verify') return { wallet: 'W' }
    throw new Error(`unexpected ${url}`)
  })
  const signMessage = vi.fn(async () => SIG)
  return { publicKeyB58: 'W', domain: DOMAIN, signMessage, fetcher }
}

describe('performSignIn', () => {
  it('signs the locally rebuilt message and verifies with a bs58 signature', async () => {
    const d = deps()
    const out = await performSignIn(d as never)
    expect(out).toEqual({ wallet: 'W' })
    expect(d.fetcher).toHaveBeenNthCalledWith(1, '/api/auth/nonce', {
      method: 'POST', body: { wallet: 'W' },
    })
    expect(d.signMessage).toHaveBeenCalledWith(new TextEncoder().encode(GOOD_MESSAGE))
    expect(d.fetcher).toHaveBeenNthCalledWith(2, '/api/auth/verify', {
      method: 'POST', body: { wallet: 'W', nonce: 'N', signature: bs58.encode(SIG) },
    })
  })

  it('refuses to sign a server message that differs from the local rebuild', async () => {
    const d = deps({ message: 'Attacker-chosen authorization text', nonce: 'N', issuedAt: ISSUED })
    await expect(performSignIn(d as never)).rejects.toThrow(/does not match/)
    expect(d.signMessage).not.toHaveBeenCalled()
  })

  it('refuses a message signed for another domain', async () => {
    const other = buildSignInMessage({ domain: 'phish.example', address: 'W', nonce: 'N', issuedAt: ISSUED })
    const d = deps({ message: other, nonce: 'N', issuedAt: ISSUED })
    await expect(performSignIn(d as never)).rejects.toThrow(/does not match/)
    expect(d.signMessage).not.toHaveBeenCalled()
  })

  it('propagates a verify rejection', async () => {
    const d = deps()
    d.fetcher.mockImplementation(async (url: string) => {
      if (url === '/api/auth/nonce') return { message: GOOD_MESSAGE, nonce: 'N', issuedAt: ISSUED }
      throw Object.assign(new Error('Wallet not allowed'), { statusCode: 403 })
    })
    await expect(performSignIn(d as never)).rejects.toMatchObject({ statusCode: 403 })
  })
})
