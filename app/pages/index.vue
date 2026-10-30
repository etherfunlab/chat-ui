<script setup lang="ts">
const { me, refreshMe } = useWalletAuth()
onMounted(() => { refreshMe() })
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
