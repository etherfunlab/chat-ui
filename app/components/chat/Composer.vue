<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ModelEntry } from '#shared/models'
import { downscaleImage } from '~/lib/images'
import type { ThinkingPref } from '~/lib/store'
import ThinkingMenu from './ThinkingMenu.vue'

const props = defineProps<{
  model: ModelEntry | undefined
  thinking: ThinkingPref
  webSearch: boolean
  /** An answer is streaming in this chat. */
  sending: boolean
  /** An answer is streaming in another chat; one at a time. */
  locked?: boolean
}>()
const emit = defineEmits<{
  'send': [{ text: string, images: string[] }]
  'stop': []
  'update:thinking': [ThinkingPref]
  'update:webSearch': [boolean]
}>()
const { t } = useI18n()

const text = ref('')
const images = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const imageError = ref('')

const canAttach = computed(() => !!props.model?.vision && images.value.length < (props.model?.maxImages ?? 0))
const canSend = computed(() => !!props.model && !props.sending && !props.locked
  && (text.value.trim() !== '' || images.value.length > 0))

function submit(): void {
  if (!canSend.value) return
  emit('send', { text: text.value.trim(), images: images.value })
  text.value = ''
  images.value = []
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
  e.preventDefault()
  submit()
}

async function onFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const room = (props.model?.maxImages ?? 0) - images.value.length
  imageError.value = ''
  for (const file of [...(input.files ?? [])].slice(0, Math.max(0, room))) {
    try {
      images.value.push(await downscaleImage(file))
    } catch {
      imageError.value = t('chat.imageUnreadable')
    }
  }
  input.value = ''
}
</script>

<template>
  <div class="mx-auto grid w-full max-w-3xl gap-2 px-4 pb-4 pt-2">
    <div v-if="images.length" class="flex flex-wrap gap-2">
      <div v-for="(src, i) in images" :key="i" class="relative">
        <img :src="src" alt="" class="h-16 w-auto rounded-[0.75rem] border border-line object-cover">
        <button
          type="button" class="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-panel text-[0.7rem] text-ink border border-line"
          :aria-label="t('chat.removeImage')" @click="images.splice(i, 1)"
        >
          ×
        </button>
      </div>
    </div>
    <p v-if="imageError" role="alert" class="text-[0.78rem] text-danger-ink">{{ imageError }}</p>

    <div class="flex flex-wrap items-center gap-1.5">
      <ThinkingMenu v-if="model" :model="model" :model-value="thinking" @update:model-value="emit('update:thinking', $event)" />
      <button
        type="button" data-role="web-chip" class="chip" :class="webSearch ? 'chip-on' : ''"
        :disabled="!model?.webSearch" :aria-pressed="webSearch" @click="emit('update:webSearch', !webSearch)"
      >
        {{ t('chat.webSearch') }}
      </button>
      <button type="button" data-role="image-chip" class="chip" :disabled="!canAttach" @click="fileInput?.click()">
        {{ t('chat.image') }}
      </button>
      <input id="composer-images" ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles">
    </div>

    <div class="flex items-end gap-1.5 rounded-[1.5rem] border border-line bg-ground py-1.5 pl-3.5 pr-1.5">
      <textarea
        id="composer-text" v-model="text" rows="1" :placeholder="t('chat.placeholder', { model: model?.name ?? '' })"
        class="field-sizing-content max-h-48 min-h-8 flex-1 resize-none bg-transparent py-1 font-native text-[15px] leading-normal text-ink outline-none placeholder:text-ink-muted"
        @keydown="onKeydown"
      />
      <button
        type="button" data-role="send"
        class="grid h-8 min-w-8 place-items-center rounded-full bg-brand px-2 text-[0.78rem] font-bold text-on-brand disabled:opacity-40"
        :disabled="!sending && !canSend" :aria-label="sending ? t('chat.stop') : t('chat.send')"
        @click="sending ? emit('stop') : submit()"
      >
        <span v-if="sending">{{ t('chat.stop') }}</span>
        <svg v-else viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>
