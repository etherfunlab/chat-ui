<script setup lang="ts">
import { computed } from 'vue'
import { ThinkingBlock, type ThinkingLabels } from '@etherfunlab/vue-llm-ui'
import { formatCost } from '#shared/money'
import { safeHttpUrl } from '#shared/url'
import { renderMarkdown } from '~/lib/markdown'
import type { StoredMessage } from '~/lib/store'

const props = defineProps<{ message: StoredMessage }>()
const { t } = useI18n()

const html = computed(() => renderMarkdown(props.message.text, props.message.citations, { copy: t('chat.copy') }))
const sources = computed(() => props.message.citations
  .map((c, i) => ({ n: i + 1, title: c.title, url: safeHttpUrl(c.url) }))
  .filter((c): c is { n: number, title: string, url: string } => c.url !== null))
// DESIGN.md §5. Before the answer starts: a request that asked for thinking, or
// one that got thinking text anyway, shows the live window; the rest wait.
// Whitespace alone is not an answer: some models emit a newline before they think.
const answerStarted = computed(() => props.message.text.trim() !== '')
const beforeAnswer = computed(() => props.message.status === 'streaming' && !answerStarted.value)
const thinking = computed(() => beforeAnswer.value && (props.message.thinkingRequested === true || !!props.message.reasoning))
const waiting = computed(() => beforeAnswer.value && !thinking.value)
// A finished answer whose thinking was never timed (a tab closed mid-thinking,
// an import) still gets its summary, so the thinking text stays reachable.
const thinkingMs = computed(() => (props.message.status === 'streaming' ? props.message.reasoningMs : props.message.reasoningMs ?? 0))
const thinkingLabels = computed<ThinkingLabels>(() => ({
  thinking: t('chat.thinking'),
  elapsed: n => t('chat.thinkingElapsed', { n }),
  done: n => t('chat.thoughtFor', { n }),
}))
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
      v-if="thinking || message.reasoning"
      :text="message.reasoning"
      :active="thinking"
      :ms="thinkingMs"
      :labels="thinkingLabels"
    />
    <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown escapes all raw HTML -->
    <div v-if="answerStarted" class="md min-w-0 font-native text-[16px] leading-[1.45] text-ink" @click="onClick" v-html="html" />
    <div v-if="sources.length" class="flex flex-wrap gap-1.5">
      <a
        v-for="c in sources" :key="c.n" :href="c.url" :title="c.title"
        target="_blank" rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 rounded-full border border-line py-1 pl-1.5 pr-2.5 text-[0.74rem] font-semibold text-ink"
      >
        <span class="grid size-4 place-items-center rounded-full bg-tint text-[0.62rem] text-tint-ink">{{ c.n }}</span>
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
