import { describe, it, expect, vi } from 'vitest'
import bs58 from 'bs58'
import { performSignIn } from './useWalletAuth'

const SIG = new Uint8Array([1, 2, 3])

function deps(overrides: Partial<Record<string, unknown>> = {}) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/auth/nonce') return { message: 'MSG', nonce: 'N' }
    if (url === '/api/auth/verify') return { wallet: 'W' }
    throw new Error(`unexpected ${url}`)
  })
  const signMessage = vi.fn(async () => SIG)
  return { publicKeyB58: 'W', signMessage, fetcher, ...overrides } as never
}

describe('performSignIn', () => {
  it('requests a nonce, signs the exact message, and verifies with a bs58 signature', async () => {
    const d = deps()
    const out = await performSignIn(d)
    expect(out).toEqual({ wallet: 'W' })

    const fetcher = (d as { fetcher: ReturnType<typeof vi.fn> }).fetcher
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/auth/nonce', {
      method: 'POST', body: { wallet: 'W' },
    })
    const signMessage = (d as { signMessage: ReturnType<typeof vi.fn> }).signMessage
    expect(signMessage).toHaveBeenCalledWith(new TextEncoder().encode('MSG'))
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/auth/verify', {
      method: 'POST', body: { wallet: 'W', nonce: 'N', signature: bs58.encode(SIG) },
    })
  })

  it('propagates a verify rejection', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/auth/nonce') return { message: 'MSG', nonce: 'N' }
      throw Object.assign(new Error('Wallet not allowed'), { statusCode: 403 })
    })
    await expect(performSignIn(deps({ fetcher }))).rejects.toMatchObject({ statusCode: 403 })
  })
})
