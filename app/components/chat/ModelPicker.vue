<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ModelEntry } from '#shared/models'

const props = defineProps<{ models: ModelEntry[], modelValue: string | undefined }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const { t } = useI18n()
const open = ref(false)

const current = computed(() => props.models.find(m => m.id === props.modelValue))
const price = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''))

function choose(id: string): void {
  open.value = false
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="relative min-w-0">
    <button
      type="button" class="flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[0.92rem] font-bold text-ink hover:bg-inset"
      aria-haspopup="menu" :aria-expanded="open" @click="open = !open"
    >
      <span class="truncate">{{ current?.name ?? '—' }}</span>
      <svg viewBox="0 0 24 24" class="size-3.5 flex-none text-ink-muted" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
    <div v-if="open" role="menu" class="menu absolute left-1/2 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <button
        v-for="m in models" :key="m.id" type="button" role="menuitemradio" :aria-checked="m.id === modelValue"
        class="menu-item" :class="m.id === modelValue ? 'menu-item-on' : ''" @click="choose(m.id)"
      >
        <span class="grid gap-0.5">
          <span>{{ m.name }}</span>
          <span class="text-[0.7rem] font-medium text-ink-muted tabular-nums">
            {{ t('chat.price', { input: price(m.pricing.input), output: price(m.pricing.output) }) }}
          </span>
        </span>
      </button>
    </div>
  </div>
</template>
