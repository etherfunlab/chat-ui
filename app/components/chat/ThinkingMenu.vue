<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ModelEntry } from '#shared/models'
import type { ThinkingPref } from '~/lib/store'

const props = defineProps<{ model: ModelEntry, modelValue: ThinkingPref }>()
const emit = defineEmits<{ 'update:modelValue': [ThinkingPref] }>()
const { t } = useI18n()
const open = ref(false)

const r = computed(() => props.model.reasoning)
// Only the levels this model offers; "Off" only where thinking can be disabled.
const options = computed(() => [...(r.value.canDisable ? ['off'] : []), ...r.value.effortOptions])
const current = computed(() => (props.modelValue.enabled ? props.modelValue.effort ?? r.value.defaultEffort : 'off'))

function choose(option: string): void {
  open.value = false
  emit('update:modelValue', option === 'off'
    ? { enabled: false, effort: props.modelValue.effort ?? r.value.defaultEffort }
    : { enabled: true, effort: option })
}
</script>

<template>
  <span v-if="r.supported && r.effortOptions.length === 0" class="chip chip-on">
    {{ t('chat.thinkingOn') }}
  </span>
  <div v-else-if="r.supported" class="relative">
    <button
      type="button" data-role="thinking-chip" class="chip" :class="current === 'off' ? '' : 'chip-on'"
      aria-haspopup="menu" :aria-expanded="open" @click="open = !open"
    >
      {{ t('chat.thinkingChip', { level: t(`effort.${current}`) }) }}
    </button>
    <div v-if="open" role="menu" class="menu absolute bottom-full left-0 mb-2 w-48">
      <p class="px-2 pb-0.5 pt-1 text-[0.68rem] tracking-wide text-ink-muted">{{ t('chat.thinkingLevel') }}</p>
      <button
        v-for="o in options" :key="o" type="button" role="menuitemradio" :aria-checked="o === current"
        class="menu-item" :class="o === current ? 'menu-item-on' : ''" @click="choose(o)"
      >
        {{ t(`effort.${o}`) }}
      </button>
      <p v-if="!r.canDisable" class="mt-0.5 border-t border-line px-2 pb-1 pt-1.5 text-[0.68rem] leading-snug text-ink-muted">
        {{ t('chat.cannotDisable', { model: model.name }) }}
      </p>
    </div>
  </div>
</template>
