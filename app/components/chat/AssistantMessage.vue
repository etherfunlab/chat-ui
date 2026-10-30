<script setup lang="ts">
import { computed } from 'vue'
import { formatCost } from '#shared/money'
import { renderMarkdown } from '~/lib/markdown'
import type { StoredMessage } from '~/lib/store'
import ThinkingBlock from './ThinkingBlock.vue'

const props = defineProps<{ message: StoredMessage }>()
const { t } = useI18n()

const html = computed(() => renderMarkdown(props.message.text, props.message.citations, { copy: t('chat.copy') }))
const thinkingLive = computed(() => props.message.status === 'streaming' && !props.message.text)
const waiting = computed(() => props.message.status === 'streaming' && !props.message.text && !props.message.reasoning)
const meta = computed(() => {
  const u = props.message.usage
  if (!u) return ''
  const tokens = (u.usage.inputTokens + u.usage.outputTokens).toLocaleString('en-US')
  return t('chat.meta', { tokens, cost: formatCost(u.costMicro) })
})

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function onClick(e: MouseEvent): Promise<void> {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]')
  const code = button?.closest('.code-block')?.querySelector('code')
  if (!button || !code) return
  try {
    await navigator.clipboard.writeText(code.textContent ?? '')
    button.textContent = t('chat.copied')
    setTimeout(() => {
      button.textContent = t('chat.copy')
    }, 1500)
  } catch {
    // Clipboard refused: select the code so the user can copy it by hand.
    const range = document.createRange()
    range.selectNodeContents(code)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }
}
</script>

<template>
  <div class="grid gap-3 min-w-0">
    <p v-if="waiting" class="text-[0.78rem] font-semibold text-waiting">
      {{ t('chat.waiting') }}
    </p>
    <ThinkingBlock
      v-if="message.reasoning"
      :reasoning="message.reasoning"
      :streaming="thinkingLive"
      :ms="message.reasoningMs"
    />
    <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown escapes all raw HTML -->
    <div v-if="message.text" class="md min-w-0 font-native text-[16px] leading-[1.45] text-ink" @click="onClick" v-html="html" />
    <div v-if="message.citations.length" class="flex flex-wrap gap-1.5">
      <a
        v-for="(c, i) in message.citations" :key="c.url" :href="c.url" :title="c.title"
        target="_blank" rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 rounded-full border border-line py-1 pl-1.5 pr-2.5 text-[0.74rem] font-semibold text-ink"
      >
        <span class="grid size-4 place-items-center rounded-full bg-tint text-[0.62rem] text-tint-ink">{{ i + 1 }}</span>
        {{ host(c.url) }}
      </a>
    </div>
    <p v-if="message.status === 'aborted'" class="text-[0.78rem] text-ink-muted">
      {{ t('chat.stopped') }}
    </p>
    <p v-if="message.status === 'error'" role="alert" class="text-[0.86rem] text-danger-ink">
      {{ message.error }}
    </p>
    <p v-if="meta" class="text-[0.7rem] text-ink-muted tabular-nums">
      {{ meta }}
    </p>
  </div>
</template>
