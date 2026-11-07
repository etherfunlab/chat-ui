import { createStore, type ChatStore } from '~/lib/store'

let instance: ChatStore | null = null

/** The browser's conversation store (IndexedDB); client-only. */
export function useChatStore(): ChatStore {
  if (!instance) instance = createStore()
  return instance
}
