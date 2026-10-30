import bs58 from 'bs58'
import { useWallet } from 'solana-wallets-vue'

export interface Me {
  wallet: string
  balanceMicro: string
}

export interface SignInDeps {
  publicKeyB58: string
  signMessage: (bytes: Uint8Array) => Promise<Uint8Array>
  fetcher: (url: string, opts?: { method?: 'POST'; body?: Record<string, unknown> }) => Promise<never>
}

/** Pure sign-in flow: nonce → sign the exact message bytes → verify. */
export async function performSignIn(deps: SignInDeps): Promise<{ wallet: string }> {
  const { message, nonce } = await deps.fetcher('/api/auth/nonce', {
    method: 'POST',
    body: { wallet: deps.publicKeyB58 },
  }) as { message: string, nonce: string }
  const signature = bs58.encode(await deps.signMessage(new TextEncoder().encode(message)))
  return await deps.fetcher('/api/auth/verify', {
    method: 'POST',
    body: { wallet: deps.publicKeyB58, nonce, signature },
  }) as { wallet: string }
}

export function useWalletAuth() {
  const me = useState<Me | null>('me', () => null)

  async function refreshMe(): Promise<void> {
    me.value = await $fetch<Me>('/api/me').catch(() => null)
  }

  async function signIn(): Promise<void> {
    // Resolved lazily: the wallet store exists only on the client.
    const { publicKey, signMessage } = useWallet()
    const pk = publicKey.value
    const sign = signMessage.value
    if (!pk || !sign) throw new Error('Wallet not connected')
    await performSignIn({ publicKeyB58: pk.toBase58(), signMessage: sign, fetcher: $fetch as never })
    await refreshMe()
  }

  async function signOut(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    me.value = null
  }

  return { me, signIn, signOut, refreshMe }
}
