import type { Ref } from 'vue'
import type { ModelEntry } from '#shared/models'
import { createChatSender } from '~/lib/chatSender'
import { streamChat } from '~/lib/chatStream'
import type { StoredMessage, StoredSession } from '~/lib/store'

/** Reactive messages of one session, plus send / stop. The turn logic lives in createChatSender. */
export function useChat(sessionId: Ref<string | null>) {
  const store = useChatStore()
  const { refreshMe } = useWalletAuth()
  const messages = ref<StoredMessage[]>([])
  const sending = ref(false)
  let controller: AbortController | null = null

  const sender = createChatSender({
    store,
    stream: streamChat,
    now: Date.now,
    newId: () => crypto.randomUUID(),
    refreshMe,
  })

  async function reload(id: string | null): Promise<void> {
    messages.value = id ? await store.listMessages(id) : []
  }
  watch(sessionId, id => reload(id), { immediate: true })

  async function send(o: { session: StoredSession, model: ModelEntry, text: string, images: string[], systemPrompt: string | null }) {
    if (sending.value) return
    sending.value = true
    controller = new AbortController()
    const sid = o.session.id
    try {
      await sender.send({
        ...o,
        signal: controller.signal,
        onUpdate: (answer) => {
          if (sessionId.value !== sid) return
          const idx = messages.value.findIndex(m => m.id === answer.id)
          if (idx >= 0) {
            messages.value[idx] = answer
            return
          }
          // First update: the user message is stored by now; pull it in.
          messages.value = [...messages.value, answer]
          void store.listMessages(sid).then((list) => {
            const live = messages.value.find(m => m.id === answer.id) ?? answer
            messages.value = list.map(m => (m.id === answer.id ? live : m))
          })
        },
      })
      if (sessionId.value === sid) await reload(sid)
    } finally {
      sending.value = false
      controller = null
    }
  }

  function stop(): void {
    controller?.abort()
  }

  return { messages, sending, send, stop }
}
