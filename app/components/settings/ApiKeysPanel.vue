<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApiKeys } from '~/composables/useApiKeys'

const { t } = useI18n()
const { keys, loading, error, refresh, create, revoke } = useApiKeys()

const name = ref('')
const newKey = ref<string | null>(null)
const copied = ref(false)
const baseUrl = computed(() => (typeof location === 'undefined' ? '/v1' : `${location.origin}/v1`))

onMounted(refresh)

async function createKey(): Promise<void> {
  const n = name.value.trim()
  if (!n || loading.value) return
  const key = await create(n)
  if (key) {
    newKey.value = key
    copied.value = false
    name.value = ''
  }
}

async function copyKey(): Promise<void> {
  if (!newKey.value) return
  try {
    await navigator.clipboard.writeText(newKey.value)
    copied.value = true
  } catch {
    // No clipboard here (insecure context or permission denied): the key stays on screen to select by hand.
    copied.value = false
  }
}

const day = (iso: string) => new Date(iso).toLocaleDateString()
</script>

<template>
  <div class="grid gap-2">
    <h3 class="text-[0.78rem] font-semibold text-ink-muted">{{ t('settings.apiKeys') }}</h3>
    <p class="text-[0.72rem] text-ink-muted">{{ t('settings.apiKeysHint') }}</p>
    <p class="break-all font-mono text-[0.78rem]">{{ baseUrl }}</p>

    <div v-if="newKey" data-role="new-key" class="grid gap-1.5 rounded-[0.75rem] bg-inset p-2.5">
      <p class="text-[0.72rem] text-ink-muted">{{ t('settings.keyShownOnce') }}</p>
      <p class="break-all font-mono text-[0.78rem]">{{ newKey }}</p>
      <button type="button" class="chip justify-self-start" data-role="copy-key" @click="copyKey">
        {{ copied ? t('chat.copied') : t('chat.copy') }}
      </button>
    </div>

    <ul v-if="keys.length" class="grid gap-1">
      <li
        v-for="k in keys" :key="k.id" data-role="key-row"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem]" :class="k.revokedAt ? 'text-ink-muted' : ''"
      >
        <span class="font-semibold">{{ k.name }}</span>
        <span class="font-mono">{{ k.prefix }}…</span>
        <span class="text-ink-muted">{{ day(k.createdAt) }}</span>
        <span class="text-ink-muted">
          {{ k.revokedAt ? t('settings.keyRevoked') : k.lastUsedAt ? t('settings.keyLastUsed', { date: day(k.lastUsedAt) }) : t('settings.keyNeverUsed') }}
        </span>
        <button
          v-if="!k.revokedAt" type="button" class="chip ml-auto" data-role="revoke-key" :disabled="loading"
          @click="revoke(k.id)"
        >
          {{ t('settings.revokeKey') }}
        </button>
      </li>
    </ul>

    <div class="flex flex-wrap items-center gap-1.5">
      <input
        v-model="name" data-role="key-name" :placeholder="t('settings.keyName')" :maxlength="40" :disabled="loading"
        class="min-w-0 flex-1 rounded-full border border-line bg-ground px-3 py-1.5 font-native text-[14px]"
        @keydown.enter.prevent="createKey"
      >
      <button
        type="button" data-role="create-key" :disabled="loading"
        class="rounded-full bg-brand px-3.5 py-1.5 text-[0.84rem] font-bold text-on-brand disabled:opacity-40"
        @click="createKey"
      >
        {{ t('settings.createKey') }}
      </button>
    </div>
    <p v-if="error" role="alert" class="text-[0.8rem] text-danger">{{ t(error) }}</p>
  </div>
</template>
