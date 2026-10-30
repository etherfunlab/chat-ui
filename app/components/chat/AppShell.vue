<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { thinkingFor } from '~/lib/thinking'
import type { StoredSession, ThinkingPref } from '~/lib/store'
import ChatHeader from './ChatHeader.vue'
import Composer from './Composer.vue'
import MessageList from './MessageList.vue'
import SessionList from './SessionList.vue'
import SettingsDialog from './SettingsDialog.vue'

const props = defineProps<{ wallet: string }>()
const { t } = useI18n()
const store = useChatStore()
const { me } = useWalletAuth()
const { models, error: modelsError, load: loadModels, byId } = useModels()

const sessions = ref<StoredSession[]>([])
const activeId = ref<string | null>(null)
const draft = ref<StoredSession | null>(null) // a new chat not yet stored
const sidebarOpen = ref(false)
const settingsOpen = ref(false)
const globalPrompt = ref('')

const session = computed(() => sessions.value.find(s => s.id === activeId.value) ?? draft.value)
const model = computed(() => byId(session.value?.model) ?? models.value[0])
const { messages, sending, send, stop } = useChat(activeId)

async function refreshSessions(): Promise<void> {
  sessions.value = await store.listSessions(props.wallet)
}

function newDraft(): StoredSession {
  const m = models.value[0]
  const now = Date.now()
  return {
    id: crypto.randomUUID(), wallet: props.wallet, title: '', model: m?.id ?? '', systemPrompt: null,
    thinking: m ? thinkingFor(m, null) : { enabled: true, effort: null }, webSearch: false, createdAt: now, updatedAt: now,
  }
}

function startNewChat(): void {
  draft.value = newDraft()
  activeId.value = null
  sidebarOpen.value = false
}

function selectSession(id: string): void {
  draft.value = null
  activeId.value = id
  sidebarOpen.value = false
}

async function deleteSession(id: string): Promise<void> {
  await store.deleteSession(id)
  if (activeId.value === id) startNewChat()
  await refreshSessions()
}

/** Saves a change to the current chat (a draft stays a draft until its first message). */
async function updateSession(patch: Partial<StoredSession>): Promise<void> {
  const s = session.value
  if (!s) return
  const next = { ...s, ...patch }
  if (draft.value && s.id === draft.value.id) {
    draft.value = next
    return
  }
  await store.putSession({ ...next, updatedAt: Date.now() })
  await refreshSessions()
}

function changeModel(id: string): void {
  const m = byId(id)
  if (!m || !session.value) return
  // Switching to a model that cannot turn thinking off turns it back on.
  void updateSession({ model: id, thinking: thinkingFor(m, session.value.thinking) })
}

async function onSend(input: { text: string, images: string[] }): Promise<void> {
  let s = session.value
  const m = model.value
  if (!s || !m) return
  if (draft.value && s.id === draft.value.id) {
    s = { ...draft.value, model: m.id }
    await store.putSession(s)
    draft.value = null
    activeId.value = s.id
    await refreshSessions()
  }
  await send({ session: s, model: m, text: input.text, images: input.images, systemPrompt: s.systemPrompt ?? (globalPrompt.value.trim() || null) })
  await refreshSessions()
}

async function saveGlobalPrompt(v: string): Promise<void> {
  globalPrompt.value = v
  await store.setSetting(props.wallet, 'systemPrompt', v)
}

onMounted(async () => {
  await loadModels()
  globalPrompt.value = (await store.getSetting(props.wallet, 'systemPrompt')) ?? ''
  await refreshSessions()
  if (sessions.value[0]) activeId.value = sessions.value[0].id
  else startNewChat()
})
</script>

<template>
  <div class="grid h-dvh md:grid-cols-[16rem_1fr]">
    <!-- Sidebar: a column on desktop, a drawer on narrow screens -->
    <div v-if="sidebarOpen" class="fixed inset-0 z-20 bg-scrim md:hidden" @click="sidebarOpen = false" />
    <aside
      class="fixed inset-y-0 left-0 z-20 w-64 overflow-y-auto border-r border-line bg-cool md:static md:z-auto md:w-auto"
      :class="sidebarOpen ? 'block' : 'hidden md:block'"
    >
      <SessionList :sessions="sessions" :active-id="activeId" @select="selectSession" @create="startNewChat" @delete="deleteSession" />
    </aside>

    <main class="grid min-h-0 min-w-0 grid-rows-[auto_1fr_auto]">
      <ChatHeader
        :models="models" :model-id="model?.id" :balance-micro="me?.billing === 'on' ? me.availableMicro : null"
        @update:model-id="changeModel" @toggle-sidebar="sidebarOpen = !sidebarOpen" @open-settings="settingsOpen = true"
      />
      <MessageList v-if="messages.length" :messages="messages" />
      <div v-else class="grid place-items-center px-6 text-center text-[0.95rem] text-ink-muted">
        <p v-if="modelsError" role="alert" class="text-danger-ink">{{ t('chat.modelsUnavailable') }}</p>
        <p v-else-if="model">{{ t('chat.empty', { model: model.name }) }}</p>
      </div>
      <Composer
        v-if="session"
        :model="model" :thinking="session.thinking" :web-search="session.webSearch" :sending="sending"
        @send="onSend" @stop="stop"
        @update:thinking="(v: ThinkingPref) => updateSession({ thinking: v })"
        @update:web-search="(v: boolean) => updateSession({ webSearch: v })"
      />
    </main>

    <SettingsDialog
      :open="settingsOpen" :wallet="wallet" :session="activeId ? session : null" :global-prompt="globalPrompt"
      @close="settingsOpen = false"
      @update:global-prompt="saveGlobalPrompt"
      @update:session-prompt="(v: string | null) => updateSession({ systemPrompt: v })"
      @sessions-changed="refreshSessions"
    />
  </div>
</template>
