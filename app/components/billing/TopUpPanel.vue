<script setup lang="ts">
import { formatUsd } from '#shared/money'

const { me } = useWalletAuth()
const { status, busy, topUp } = useTopUp()
const amount = ref('10')
</script>

<template>
  <section v-if="me && me.billing === 'on'">
    <p>Balance: {{ formatUsd(me.availableMicro) }}</p>
    <form @submit.prevent="topUp(amount)">
      <label>
        Top up (USDC)
        <input v-model="amount" inputmode="decimal" :disabled="busy">
      </label>
      <button type="submit" :disabled="busy">
        {{ busy ? 'Working…' : 'Top up' }}
      </button>
    </form>
    <p v-if="status" role="status">{{ status }}</p>
  </section>
</template>
