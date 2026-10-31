<script setup lang="ts">
import { ref, watch } from 'vue'
import { downloadJson } from '~/lib/download'
import { MAX_IMPORT_BYTES, type StoredSession } from '~/lib/store'
import type { ThemePref } from '~/composables/useTheme'

const props = defineProps<{ open: boolean, wallet: string, session: StoredSession | null, globalPrompt: string }>()
const emit = defineEmits<{
  'close': []
  'update:globalPrompt': [string]
  'update:sessionPrompt': [string | null]
  'sessionsChanged': []
}>()
const { t } = useI18n()
const { pref, setPref } = useTheme()
const { signOut } = useWalletAuth()
const store = useChatStore()

const global = ref(props.globalPrompt)
const local = ref(props.session?.systemPrompt ?? '')
const notice = ref('')
watch(() => [props.open, props.globalPrompt, props.session?.id] as const, () => {
  global.value = props.globalPrompt
  local.value = props.session?.systemPrompt ?? ''
  notice.value = ''
})

function save(): void {
  emit('update:globalPrompt', global.value)
  if (props.session) emit('update:sessionPrompt', local.value.trim() ? local.value : null)
  notice.value = t('settings.saved')
}

async function exportChats(onlyCurrent: boolean): Promise<void> {
  const file = await store.exportSessions(props.wallet, onlyCurrent && props.session ? [props.session.id] : undefined)
  downloadJson(`chat-ui-${new Date().toISOString().slice(0, 10)}.json`, file)
}

async function importChats(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > MAX_IMPORT_BYTES) {
    notice.value = t('settings.importFailed')
    return
  }
  try {
    const result = await store.importSessions(props.wallet, JSON.parse(await file.text()))
    notice.value = t('settings.imported', result)
    emit('sessionsChanged')
  } catch {
    notice.value = t('settings.importFailed')
  }
}

const themes: { value: ThemePref, label: string }[] = [
  { value: 'system', label: 'settings.themeSystem' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeNight' },
]
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-30 grid place-items-center bg-scrim p-4" @click.self="emit('close')">
    <section role="dialog" aria-modal="true" :aria-label="t('settings.title')" class="menu max-h-[90vh] w-full max-w-lg overflow-y-auto p-5">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-[1.05rem] font-bold">{{ t('settings.title') }}</h2>
        <button type="button" class="icon-button" :aria-label="t('settings.close')" @click="emit('close')">×</button>
      </div>

      <div class="grid gap-6">
        <div class="grid gap-2">
          <h3 class="text-[0.78rem] font-semibold text-ink-muted">{{ t('settings.theme') }}</h3>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="o in themes" :key="o.value" type="button" class="chip" :class="pref === o.value ? 'chip-on' : ''"
              :aria-pressed="pref === o.value" @click="setPref(o.value)"
            >
              {{ t(o.label) }}
            </button>
          </div>
        </div>

        <div class="grid gap-2">
          <label for="settings-global-prompt" class="text-[0.78rem] font-semibold text-ink-muted">{{ t('settings.systemPrompt') }}</label>
          <textarea id="settings-global-prompt" v-model="global" rows="3" class="rounded-[0.75rem] border border-line bg-ground p-2.5 font-native text-[14px]" />
          <p class="text-[0.72rem] text-ink-muted">{{ t('settings.systemPromptHint') }}</p>
          <template v-if="session">
            <label for="settings-session-prompt" class="mt-2 text-[0.78rem] font-semibold text-ink-muted">{{ t('settings.sessionPrompt') }}</label>
            <textarea id="settings-session-prompt" v-model="local" rows="3" class="rounded-[0.75rem] border border-line bg-ground p-2.5 font-native text-[14px]" />
            <p class="text-[0.72rem] text-ink-muted">{{ t('settings.sessionPromptHint') }}</p>
          </template>
          <button type="button" class="justify-self-start rounded-full bg-brand px-3.5 py-1.5 text-[0.84rem] font-bold text-on-brand" @click="save">
            {{ t('settings.save') }}
          </button>
        </div>

        <div class="grid gap-2">
          <h3 class="text-[0.78rem] font-semibold text-ink-muted">{{ t('settings.data') }}</h3>
          <p class="text-[0.72rem] text-ink-muted">{{ t('settings.dataHint') }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button type="button" class="chip" @click="exportChats(false)">{{ t('settings.exportAll') }}</button>
            <button v-if="session" type="button" class="chip" @click="exportChats(true)">{{ t('settings.exportCurrent') }}</button>
            <label class="chip cursor-pointer">
              {{ t('settings.import') }}
              <input id="settings-import" type="file" accept="application/json,.json" hidden @change="importChats">
            </label>
          </div>
        </div>

        <BillingTopUpPanel />

        <div class="grid gap-2">
          <h3 class="text-[0.78rem] font-semibold text-ink-muted">{{ t('settings.account') }}</h3>
          <p class="break-all font-mono text-[0.78rem]">{{ wallet }}</p>
          <button type="button" class="chip justify-self-start" @click="signOut">{{ t('settings.signOut') }}</button>
        </div>

        <p v-if="notice" role="status" class="text-[0.8rem] text-ink-muted">{{ notice }}</p>
      </div>
    </section>
  </div>
</template>
