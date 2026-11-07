<script setup lang="ts">
import type { StoredMessage } from '~/lib/store'

defineProps<{ message: StoredMessage }>()
const { t } = useI18n()
</script>

<template>
  <div class="grid justify-items-end gap-1.5">
    <div
      v-if="message.images.length"
      class="flex flex-wrap justify-end gap-1.5 max-w-[84%]"
    >
      <img
        v-for="(src, i) in message.images" :key="i" :src="src" alt=""
        class="h-28 w-auto max-w-full rounded-[0.75rem] border border-line object-cover"
      >
    </div>
    <div
      v-if="message.text"
      class="max-w-[84%] rounded-[1.5rem] rounded-br-[0.375rem] bg-brand px-3 py-2 font-native text-[16px] leading-[1.25] text-on-brand whitespace-pre-wrap break-words"
    >
      {{ message.text }}
    </div>
    <span
      v-if="message.omittedImages > 0"
      class="rounded-full border border-dashed border-line px-2.5 py-0.5 text-[0.72rem] text-ink-muted"
    >
      {{ t('chat.imageNotSent', { n: message.omittedImages }, message.omittedImages) }}
    </span>
  </div>
</template>
