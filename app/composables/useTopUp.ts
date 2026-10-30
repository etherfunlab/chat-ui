import { Transaction } from '@solana/web3.js'
import { useWallet } from 'solana-wallets-vue'

export type TopUpResult =
  | { status: 'confirmed', creditedMicro?: string }
  | { status: 'submitting' | 'expired' | 'pending' }
  | { status: 'failed', reason?: string }

export interface TopUpDeps {
  amount: string
  connectedWallet: string | null
  sessionWallet: string
  signTransaction: (tx: Transaction) => Promise<Transaction>
  fetcher: (url: string, opts?: { method?: 'POST', body?: Record<string, unknown> }) => Promise<never>
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))

/**
 * Pure top-up flow: intent → wallet signs the server-built transfer → submit.
 * Only the signed-in wallet may pay: the server builds the transfer from it,
 * so a different connected wallet could not sign it anyway.
 */
export async function performTopUp(d: TopUpDeps): Promise<TopUpResult> {
  if (d.connectedWallet !== d.sessionWallet) {
    throw new Error('The connected wallet differs from the signed-in wallet')
  }
  const { intentId, transactionBase64 } = await d.fetcher('/api/topup/intent', {
    method: 'POST',
    body: { amount: d.amount },
  }) as { intentId: string, transactionBase64: string }
  const signed = await d.signTransaction(Transaction.from(fromBase64(transactionBase64)))
  return await d.fetcher('/api/topup/submit', {
    method: 'POST',
    body: { intentId, signedTxBase64: toBase64(signed.serialize()) },
  }) as TopUpResult
}

const POLL_MS = 5_000
const POLL_LIMIT_MS = 120_000

export function useTopUp() {
  const { me, refreshMe } = useWalletAuth()
  const status = ref<string>('')
  const busy = ref(false)

  async function waitForConfirmation(): Promise<void> {
    const deadline = Date.now() + POLL_LIMIT_MS
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_MS))
      const { intents } = await $fetch<{ intents: { status: string }[] }>('/api/topup/reconcile', { method: 'POST' })
      if (!intents.some(i => i.status === 'submitting')) return
    }
  }

  async function topUp(amount: string): Promise<void> {
    if (!me.value) return
    const { publicKey, signTransaction } = useWallet()
    const sign = signTransaction.value
    if (!sign) throw new Error('This wallet cannot sign transactions')
    busy.value = true
    status.value = 'Waiting for wallet signature…'
    try {
      const result = await performTopUp({
        amount,
        connectedWallet: publicKey.value?.toBase58() ?? null,
        sessionWallet: me.value.wallet,
        signTransaction: sign,
        fetcher: $fetch as never,
      })
      if (result.status === 'submitting') {
        status.value = 'Confirming on chain…'
        await waitForConfirmation()
      }
      status.value = result.status === 'expired' ? 'The transaction expired. Please try again.'
        : result.status === 'failed' ? 'Top-up failed.'
          : 'Top-up complete.'
      await refreshMe()
    } catch (err) {
      const code = (err as { data?: { data?: { code?: string } } }).data?.data?.code
      status.value = code === 'insufficient_funds' ? 'Not enough USDC in this wallet.' : (err as Error).message
    } finally {
      busy.value = false
    }
  }

  return { status, busy, topUp }
}
