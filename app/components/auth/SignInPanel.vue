<script setup lang="ts">
import { useWallet } from 'solana-wallets-vue'

const { wallets, select, connected, connecting, publicKey, disconnect } = useWallet()
const { me, signIn, signOut } = useWalletAuth()

const errorMsg = ref('')
const busy = ref(false)

const detected = computed(() =>
  wallets.value.filter(w => w.readyState === 'Installed'),
)

const inWalletBrowser = computed(() => {
  if (import.meta.server) return false
  return /Phantom|Solflare/i.test(navigator.userAgent)
})

const shortAddress = computed(() => {
  const w = me.value?.wallet
  return w ? `${w.slice(0, 4)}…${w.slice(-4)}` : ''
})

function deepLink(base: 'phantom' | 'solflare'): string {
  if (import.meta.server) return '#'
  const url = encodeURIComponent(location.href)
  const ref = encodeURIComponent(location.origin)
  return base === 'phantom'
    ? `https://phantom.app/ul/browse/${url}?ref=${ref}`
    : `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`
}

async function onSignIn() {
  errorMsg.value = ''
  busy.value = true
  try {
    await signIn()
  } catch (err) {
    errorMsg.value = (err as { data?: { statusMessage?: string }, message?: string }).data?.statusMessage
      ?? (err as Error).message ?? 'Sign-in failed'
  } finally {
    busy.value = false
  }
}

async function onDisconnect() {
  await signOut().catch(() => {})
  await disconnect().catch(() => {})
}
</script>

<template>
  <section>
    <p v-if="inWalletBrowser && !me">
      Conversations are stored only in this browser. Moving elsewhere? Use export / import.
    </p>

    <!-- Signed in -->
    <div v-if="me">
      <span>{{ shortAddress }}</span>
      <button type="button" @click="onDisconnect">Sign out</button>
    </div>

    <!-- Wallet connected, not signed in -->
    <div v-else-if="connected && publicKey">
      <button type="button" :disabled="busy" @click="onSignIn">
        {{ busy ? 'Signing in…' : 'Sign in with wallet' }}
      </button>
    </div>

    <!-- Wallets detected, none connected -->
    <div v-else-if="detected.length > 0">
      <button
        v-for="w in detected"
        :key="w.adapter.name"
        type="button"
        :disabled="connecting"
        @click="select(w.adapter.name)"
      >
        Connect {{ w.adapter.name }}
      </button>
    </div>

    <!-- No wallet available -->
    <div v-else>
      <p>No Solana wallet detected.</p>
      <ul>
        <li><a :href="deepLink('phantom')">Open in Phantom</a></li>
        <li><a :href="deepLink('solflare')">Open in Solflare</a></li>
        <li><a href="https://phantom.app/download" target="_blank" rel="noopener">Install Phantom</a></li>
        <li><a href="https://solflare.com/download" target="_blank" rel="noopener">Install Solflare</a></li>
      </ul>
    </div>

    <p v-if="errorMsg" role="alert">{{ errorMsg }}</p>
  </section>
</template>
