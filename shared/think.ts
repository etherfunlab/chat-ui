const OPEN = '<think>'
const CLOSE = '</think>'

/** Length of the longest suffix of `s` that is a proper prefix of `tag`. */
function partialTagLength(s: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
    if (s.endsWith(tag.slice(0, k))) return k
  }
  return 0
}

/**
 * Separates a leading `<think>…</think>` block (models that write their
 * reasoning into the content stream) from the answer. Only a block at the very
 * start counts — after leading whitespace at most — so an answer that merely
 * mentions the tag stays text. Tags may be split across any two deltas; only a
 * possible partial tag is held back, so streaming stays live.
 */
export function createThinkSplitter(): {
  push(content: string): { text: string, reasoning: string }
  end(): { text: string, reasoning: string }
} {
  let state: 'start' | 'think' | 'text' = 'start'
  let pending = ''

  return {
    push(content) {
      let buf = pending + content
      pending = ''
      let text = ''
      let reasoning = ''
      for (;;) {
        if (state === 'text') {
          text += buf
          break
        }
        if (state === 'start') {
          const lead = buf.length - buf.trimStart().length
          const rest = buf.slice(lead)
          if (rest.startsWith(OPEN)) {
            text += buf.slice(0, lead)
            buf = rest.slice(OPEN.length)
            state = 'think'
            continue
          }
          if (OPEN.startsWith(rest)) {
            pending = buf // whitespace and maybe the start of the tag
            break
          }
          state = 'text'
          continue
        }
        const idx = buf.indexOf(CLOSE)
        if (idx !== -1) {
          reasoning += buf.slice(0, idx)
          buf = buf.slice(idx + CLOSE.length)
          state = 'text'
          continue
        }
        const hold = partialTagLength(buf, CLOSE)
        reasoning += buf.slice(0, buf.length - hold)
        pending = buf.slice(buf.length - hold)
        break
      }
      return { text, reasoning }
    },
    end() {
      const rest = pending
      pending = ''
      return state === 'think' ? { text: '', reasoning: rest } : { text: rest, reasoning: '' }
    },
  }
}
