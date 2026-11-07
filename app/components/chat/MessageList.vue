<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { StoredMessage } from '~/lib/store'
import AssistantMessage from './AssistantMessage.vue'
import UserMessage from './UserMessage.vue'

const props = defineProps<{ messages: StoredMessage[] }>()
const scroller = ref<HTMLElement | null>(null)

// Follow the stream only while the reader is already at the bottom.
watch(() => props.messages, async () => {
  const el = scroller.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  await nextTick()
  if (atBottom) el.scrollTop = el.scrollHeight
}, { deep: true })
</script>

<template>
  <div ref="scroller" class="min-h-0 overflow-y-auto">
    <div class="mx-auto grid w-full max-w-3xl gap-5 px-4 py-6">
      <template v-for="m in messages" :key="m.id">
        <UserMessage v-if="m.role === 'user'" :message="m" />
        <AssistantMessage v-else :message="m" />
      </template>
    </div>
  </div>
</template>
