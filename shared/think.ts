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
 * Separates `<think>…</think>` spans (models that write their reasoning into
 * the content stream) from the answer text. Tags may be split across any two
 * deltas; only a possible partial tag is held back, everything else is
 * emitted immediately so streaming stays live.
 */
export function createThinkSplitter(): {
  push(content: string): { text: string, reasoning: string }
  end(): { text: string, reasoning: string }
} {
  let inThink = false
  let pending = ''

  return {
    push(content) {
      let buf = pending + content
      pending = ''
      let text = ''
      let reasoning = ''
      for (;;) {
        const tag = inThink ? CLOSE : OPEN
        const idx = buf.indexOf(tag)
        if (idx !== -1) {
          if (inThink) reasoning += buf.slice(0, idx)
          else text += buf.slice(0, idx)
          buf = buf.slice(idx + tag.length)
          inThink = !inThink
          continue
        }
        const hold = partialTagLength(buf, tag)
        const out = buf.slice(0, buf.length - hold)
        if (inThink) reasoning += out
        else text += out
        pending = buf.slice(buf.length - hold)
        break
      }
      return { text, reasoning }
    },
    end() {
      const rest = pending
      pending = ''
      return inThink ? { text: '', reasoning: rest } : { text: rest, reasoning: '' }
    },
  }
}
