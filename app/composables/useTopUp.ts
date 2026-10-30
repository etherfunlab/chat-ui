import { Transaction } from '@solana/web3.js'
import { useWallet } from 'solana-wallets-vue'
import type { Me } from './useWalletAuth'

export type TopUpStatus = 'pending' | 'submitting' | 'confirmed' | 'failed' | 'expired'

export type TopUpResult =
  | { status: 'confirmed', creditedMicro?: string }
  | { status: 'submitting' | 'expired' | 'pending' }
  | { status: 'failed', reason?: string }

type Fetcher = (url: string, opts?: { method?: 'POST', body?: Record<string, unknown> }) => Promise<unknown>

export interface TopUpDeps {
  amount: string
  connectedWallet: string | null
  sessionWallet: string
  signTransaction: (tx: Transaction) => Promise<Transaction>
  fetcher: Fetcher
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))

/**
 * Pure top-up flow: intent → wallet signs the server-built transfer → submit.
 * Only the signed-in wallet may pay: the server builds the transfer from it,
 * so a different connected wallet could not sign it anyway.
 */
export async function performTopUp(d: TopUpDeps): Promise<TopUpResult & { intentId: string }> {
  if (d.connectedWallet !== d.sessionWallet) {
    throw Object.assign(new Error('The connected wallet differs from the signed-in wallet'), { code: 'wallet_mismatch' })
  }
  const { intentId, transactionBase64 } = await d.fetcher('/api/topup/intent', {
    method: 'POST',
    body: { amount: d.amount },
  }) as { intentId: string, transactionBase64: string }
  const signed = await d.signTransaction(Transaction.from(fromBase64(transactionBase64)))
  const result = await d.fetcher('/api/topup/submit', {
    method: 'POST',
    body: { intentId, signedTxBase64: toBase64(signed.serialize()) },
  }) as TopUpResult
  return { ...result, intentId }
}

const isFinal = (s: string) => s !== 'pending' && s !== 'submitting'

/**
 * Polls reconcile until THIS intent reaches a final status, or the time limit
 * passes (then 'submitting': the payment may still land; reconcile on the
 * next visit finishes it).
 */
export async function waitForIntent(
  intentId: string,
  o: { fetcher: Fetcher, sleep: (ms: number) => Promise<void>, now: () => number, limitMs: number, pollMs?: number },
): Promise<string> {
  const deadline = o.now() + o.limitMs
  while (o.now() < deadline) {
    await o.sleep(o.pollMs ?? 5_000)
    try {
      const { intents } = await o.fetcher('/api/topup/reconcile', { method: 'POST' }) as { intents: { id: string, status: string }[] }
      const mine = intents.find(i => i.id === intentId)
      if (mine) {
        if (isFinal(mine.status)) return mine.status
        continue
      }
      // Already settled by an earlier run: reconcile no longer lists it.
      const list = await o.fetcher('/api/topup') as { intents: { id: string, status: string }[] }
      const found = list.intents.find(i => i.id === intentId)
      if (found && isFinal(found.status)) return found.status
    } catch {
      // transient — keep polling
    }
  }
  return 'submitting'
}

/** The i18n key describing a top-up's final status. */
export function topUpMessage(status: string): string {
  switch (status) {
    case 'confirmed': return 'topup.status.confirmed'
    case 'submitting': return 'topup.status.submitting'
    case 'expired': return 'topup.status.expired'
    case 'failed': return 'topup.status.failed'
    default: return 'topup.status.notSubmitted'
  }
}

/** What the panel shows: an i18n key, or upstream text with no translation. */
export type TopUpStatusText = { key: string } | { text: string } | null

/**
 * Finishes top-ups left in flight by an earlier visit (closed tab, slow chain).
 * Runs in the background on page load and after sign-in; never throws.
 */
export async function resumePendingTopUps(o: { me: Me | null, fetcher: Fetcher, refreshMe: () => Promise<void> }): Promise<void> {
  if (!o.me || o.me.billing !== 'on') return
  try {
    await o.fetcher('/api/topup/reconcile', { method: 'POST' })
    await o.refreshMe()
  } catch {
    // retried on the next visit
  }
}

export function useTopUp() {
  const { me, refreshMe } = useWalletAuth()
  const status = ref<TopUpStatusText>(null)
  const busy = ref(false)

  async function topUp(amount: string): Promise<void> {
    if (!me.value) return
    busy.value = true
    status.value = { key: 'topup.waitingSignature' }
    try {
      const { publicKey, signTransaction } = useWallet()
      const sign = signTransaction.value
      if (!sign) throw Object.assign(new Error('This wallet cannot sign transactions'), { code: 'cannot_sign' })
      const result = await performTopUp({
        amount,
        connectedWallet: publicKey.value?.toBase58() ?? null,
        sessionWallet: me.value.wallet,
        signTransaction: sign,
        fetcher: $fetch as never,
      })
      let final: string = result.status
      if (final === 'submitting') {
        status.value = { key: 'topup.confirming' }
        final = await waitForIntent(result.intentId, {
          fetcher: $fetch as never,
          sleep: ms => new Promise(r => setTimeout(r, ms)),
          now: Date.now,
          limitMs: 120_000,
        })
      }
      status.value = { key: topUpMessage(final) }
      await refreshMe()
    } catch (err) {
      const e = err as { code?: string, data?: { data?: { code?: string } }, message?: string }
      const code = e.data?.data?.code ?? e.code
      status.value = code === 'insufficient_funds' ? { key: 'topup.insufficientFunds' }
        : code === 'wallet_mismatch' ? { key: 'topup.walletMismatch' }
          : code === 'cannot_sign' ? { key: 'topup.cannotSign' }
            : { text: e.message ?? 'Top-up failed' }
    } finally {
      busy.value = false
    }
  }

  return { status, busy, topUp }
}
