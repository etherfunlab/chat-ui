<script setup lang="ts">
const { me, refreshMe } = useWalletAuth()

onMounted(() => { refreshMe() })

// On load and after sign-in: finish top-ups an earlier visit left in flight.
watch(() => me.value?.wallet, (wallet) => {
  if (wallet) resumePendingTopUps({ me: me.value, fetcher: $fetch as never, refreshMe })
})
</script>

<template>
  <main>
    <h1>chat-ui</h1>
    <ClientOnly>
      <AuthSignInPanel />
      <BillingTopUpPanel />
      <template #fallback>
        <p>Loading wallet…</p>
      </template>
    </ClientOnly>
    <p v-if="me">Chat interface lands here.</p>
  </main>
</template>
