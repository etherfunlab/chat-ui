export interface SseEvent {
  /** The `event:` field, or null for the default message event. */
  event: string | null
  /** `data:` lines joined with "\n". */
  data: string
  /** The event exactly as received, including its terminating blank line. */
  raw: string
}

const BOUNDARY = /\r\n\r\n|\n\n|\r\r/

function parseEvent(raw: string): SseEvent | null {
  let event: string | null = null
  const data: string[] = []
  for (const line of raw.split(/\r\n|\n|\r/)) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
  }
  return data.length ? { event, data: data.join('\n'), raw } : null
}

/**
 * Incremental Server-Sent Events parser. Network chunks may split an event
 * anywhere — mid-line, mid-JSON, between CR and LF — so input is buffered
 * until a blank line closes the event.
 */
export function createSseParser(onEvent: (e: SseEvent) => void): { push(chunk: string): void, end(): void } {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk
      for (let m = BOUNDARY.exec(buffer); m; m = BOUNDARY.exec(buffer)) {
        const raw = buffer.slice(0, m.index + m[0].length)
        buffer = buffer.slice(raw.length)
        const e = parseEvent(raw)
        if (e) onEvent(e)
      }
    },
    end() {
      if (buffer.trim()) {
        const e = parseEvent(buffer)
        if (e) onEvent(e)
      }
      buffer = ''
    },
  }
}
