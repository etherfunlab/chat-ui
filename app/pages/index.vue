<script setup lang="ts">
const { t } = useI18n()
const { me, refreshMe } = useWalletAuth()
useTheme()

onMounted(() => { refreshMe() })

// On load and after sign-in: finish top-ups an earlier visit left in flight.
watch(() => me.value?.wallet, (wallet) => {
  if (wallet) resumePendingTopUps({ me: me.value, fetcher: $fetch as never, refreshMe })
})
</script>

<template>
  <ClientOnly>
    <ChatAppShell v-if="me" :key="me.wallet" :wallet="me.wallet" />
    <main v-else class="grid min-h-dvh place-items-center p-6">
      <div class="grid w-full max-w-sm gap-6">
        <h1 class="text-[1.6rem] font-bold">chat-ui</h1>
        <AuthSignInPanel />
      </div>
    </main>
    <template #fallback>
      <p class="p-6 text-ink-muted">{{ t('app.loadingWallet') }}</p>
    </template>
  </ClientOnly>
</template>
