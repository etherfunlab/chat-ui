<script setup lang="ts">
import { ref } from 'vue'
import type { StoredSession } from '~/lib/store'

defineProps<{ sessions: StoredSession[], activeId: string | null }>()
const emit = defineEmits<{ select: [string], create: [], delete: [string] }>()
const { t } = useI18n()
const confirming = ref<string | null>(null)
</script>

<template>
  <nav class="grid content-start gap-1 p-2">
    <button type="button" class="chip mb-2 justify-center py-1.5" @click="emit('create')">
      {{ t('chat.newChat') }}
    </button>
    <div
      v-for="s in sessions" :key="s.id"
      class="group flex items-center gap-1 rounded-[0.6rem] pr-1"
      :class="s.id === activeId ? 'bg-tint text-tint-ink' : 'hover:bg-card'"
    >
      <button type="button" class="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[0.86rem]" @click="emit('select', s.id)">
        {{ s.title || t('chat.untitled') }}
      </button>
      <template v-if="confirming === s.id">
        <button type="button" class="px-1.5 text-[0.74rem] font-semibold text-danger-ink" @click="emit('delete', s.id); confirming = null">
          {{ t('chat.yes') }}
        </button>
        <button type="button" class="px-1.5 text-[0.74rem] text-ink-muted" @click="confirming = null">
          {{ t('chat.no') }}
        </button>
      </template>
      <button
        v-else type="button" class="icon-button size-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
        :aria-label="t('chat.deleteChat')" @click="confirming = s.id"
      >
        <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
        </svg>
      </button>
    </div>
  </nav>
</template>
