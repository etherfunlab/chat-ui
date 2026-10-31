import type { Ref } from 'vue'
import type { ModelEntry } from '#shared/models'
import { createChatSender } from '~/lib/chatSender'
import { streamChat } from '~/lib/chatStream'
import { settleStale } from '~/lib/messages'
import type { StoredMessage, StoredSession } from '~/lib/store'

/**
 * Reactive messages of the shown session, plus send / stop. One answer streams
 * at a time; `sending` is true only in the chat it belongs to, `busy` anywhere.
 * The turn logic lives in createChatSender.
 */
export function useChat(sessionId: Ref<string | null>) {
  const store = useChatStore()
  const { refreshMe } = useWalletAuth()
  const messages = ref<StoredMessage[]>([])
  const streamingIn = ref<string | null>(null)
  let liveAnswerId: string | null = null
  let controller: AbortController | null = null

  const sending = computed(() => streamingIn.value !== null && streamingIn.value === sessionId.value)
  const busy = computed(() => streamingIn.value !== null)

  const sender = createChatSender({
    store,
    stream: streamChat,
    now: Date.now,
    newId: () => crypto.randomUUID(),
    refreshMe,
  })

  async function reload(id: string | null): Promise<void> {
    if (!id) {
      messages.value = []
      return
    }
    const list = await store.listMessages(id)
    if (sessionId.value !== id) return // switched away while loading
    const { messages: fixed, changed } = settleStale(list, liveAnswerId)
    for (const m of changed) void store.putMessage(m)
    messages.value = fixed
  }
  watch(sessionId, id => reload(id), { immediate: true })

  async function send(o: { session: StoredSession, model: ModelEntry, text: string, images: string[], systemPrompt: string | null }) {
    if (streamingIn.value) return
    const sid = o.session.id
    streamingIn.value = sid
    controller = new AbortController()
    try {
      await sender.send({
        ...o,
        signal: controller.signal,
        onUpdate: (answer) => {
          liveAnswerId = answer.id
          if (sessionId.value !== sid) return
          const idx = messages.value.findIndex(m => m.id === answer.id)
          if (idx >= 0) {
            messages.value[idx] = answer
            return
          }
          // First update: the user message is stored by now; pull it in.
          messages.value = [...messages.value, answer]
          void store.listMessages(sid).then((list) => {
            if (sessionId.value !== sid) return
            const live = messages.value.find(m => m.id === answer.id) ?? answer
            messages.value = list.map(m => (m.id === answer.id ? live : m))
          })
        },
      })
    } finally {
      streamingIn.value = null
      liveAnswerId = null
      controller = null
      await reload(sessionId.value)
    }
  }

  /** Stops the answer streaming in this chat (or in `id`, when given). */
  function stop(id: string | null = sessionId.value): void {
    if (id !== null && streamingIn.value === id) controller?.abort()
  }

  return { messages, sending, busy, send, stop }
}
