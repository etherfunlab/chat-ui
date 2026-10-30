<script setup lang="ts">
import { formatUsd } from '#shared/money'

const { t } = useI18n()
const { me } = useWalletAuth()
const { status, busy, topUp } = useTopUp()
const amount = ref('10')

const statusText = computed(() => {
  const s = status.value
  if (!s) return ''
  return 'key' in s ? t(s.key) : s.text
})
</script>

<template>
  <section v-if="me && me.billing === 'on'">
    <p>{{ t('topup.balance', { amount: formatUsd(me.availableMicro) }) }}</p>
    <form @submit.prevent="topUp(amount)">
      <label>
        {{ t('topup.amountLabel') }}
        <input id="topup-amount" v-model="amount" inputmode="decimal" :disabled="busy">
      </label>
      <button type="submit" :disabled="busy">
        {{ busy ? t('topup.working') : t('topup.submit') }}
      </button>
    </form>
    <p v-if="statusText" role="status">{{ statusText }}</p>
  </section>
</template>
