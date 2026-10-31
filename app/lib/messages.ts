import type { StoredMessage } from './store'

/**
 * Answers still marked `streaming` when a chat loads were cut off by an earlier
 * visit (tab closed mid-answer); they become `aborted`. `liveId` is the answer
 * streaming in this tab right now, which is left alone.
 */
export function settleStale(messages: StoredMessage[], liveId: string | null): { messages: StoredMessage[], changed: StoredMessage[] } {
  const changed: StoredMessage[] = []
  const out = messages.map((m) => {
    if (m.status !== 'streaming' || m.id === liveId) return m
    const fixed = { ...m, status: 'aborted' as const }
    changed.push(fixed)
    return fixed
  })
  return { messages: out, changed }
}
