import bs58 from 'bs58'
import { useWallet } from 'solana-wallets-vue'
import { buildSignInMessage } from '#shared/siws'

export interface Me {
  wallet: string
  balanceMicro: string
}

export interface SignInDeps {
  publicKeyB58: string
  /** The host the user sees in the address bar (location.host). */
  domain: string
  signMessage: (bytes: Uint8Array) => Promise<Uint8Array>
  fetcher: (url: string, opts?: { method?: 'POST'; body?: Record<string, unknown> }) => Promise<never>
}

/**
 * Pure sign-in flow: nonce → sign → verify. The client signs only a message
 * it rebuilt itself for the domain in the address bar; a server-supplied text
 * that differs (other domain, other wallet, arbitrary wording) is refused
 * before the wallet is ever asked.
 */
export async function performSignIn(deps: SignInDeps): Promise<{ wallet: string }> {
  const { message: serverMessage, nonce, issuedAt } = await deps.fetcher('/api/auth/nonce', {
    method: 'POST',
    body: { wallet: deps.publicKeyB58 },
  }) as { message: string, nonce: string, issuedAt: string }
  const message = buildSignInMessage({ domain: deps.domain, address: deps.publicKeyB58, nonce, issuedAt })
  if (message !== serverMessage) {
    throw new Error('Sign-in message does not match this site; refusing to sign')
  }
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
    await performSignIn({
      publicKeyB58: pk.toBase58(),
      domain: location.host,
      signMessage: sign,
      fetcher: $fetch as never,
    })
    await refreshMe()
  }

  async function signOut(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    me.value = null
  }

  return { me, signIn, signOut, refreshMe }
}
