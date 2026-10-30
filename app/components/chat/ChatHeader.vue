<script setup lang="ts">
import type { ModelEntry } from '#shared/models'
import { formatUsd } from '#shared/money'
import ModelPicker from './ModelPicker.vue'

defineProps<{ models: ModelEntry[], modelId: string | undefined, balanceMicro: string | null }>()
const emit = defineEmits<{ 'update:modelId': [string], 'toggleSidebar': [], 'openSettings': [] }>()
const { t } = useI18n()
</script>

<template>
  <header class="flex items-center gap-2 border-b border-line px-3 py-2">
    <button type="button" class="icon-button md:hidden" :aria-label="t('chat.menu')" @click="emit('toggleSidebar')">
      <svg viewBox="0 0 24 24" class="size-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h10" />
      </svg>
    </button>
    <div class="flex min-w-0 flex-1 justify-center">
      <ModelPicker :models="models" :model-value="modelId" @update:model-value="emit('update:modelId', $event)" />
    </div>
    <button
      v-if="balanceMicro !== null" type="button"
      class="flex-none rounded-full border border-line px-2.5 py-1 text-[0.78rem] font-semibold tabular-nums text-ink"
      @click="emit('openSettings')"
    >
      {{ formatUsd(balanceMicro) }}
    </button>
    <button type="button" class="icon-button" :aria-label="t('chat.settings')" @click="emit('openSettings')">
      <svg viewBox="0 0 24 24" class="size-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    </button>
  </header>
</template>
