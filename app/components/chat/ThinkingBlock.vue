<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ reasoning: string, streaming: boolean, ms: number | null }>()
const { t } = useI18n()

// DESIGN.md §5: open while the model is thinking, then collapse to one line.
const open = ref(props.streaming)
watch(() => props.streaming, (s) => {
  open.value = s
})

const label = computed(() => (props.streaming
  ? t('chat.thinking')
  : t('chat.thoughtFor', { s: Math.max(1, Math.round((props.ms ?? 0) / 1000)) })))
</script>

<template>
  <div class="grid gap-1.5 min-w-0">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 justify-self-start text-[0.78rem] font-semibold text-ink-muted"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg
        viewBox="0 0 24 24" class="size-3.5 transition-transform" :class="open ? '' : '-rotate-90'"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M6 9l6 6 6-6" /></svg>
      {{ label }}
    </button>
    <div v-if="open" class="border-l-2 border-line pl-2.5 font-native text-[13.5px] leading-normal text-ink-muted whitespace-pre-wrap break-words">
      {{ reasoning }}
    </div>
  </div>
</template>
