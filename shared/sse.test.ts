import { describe, it, expect } from 'vitest'
import { createSseParser } from './sse'

function collect() {
  const events: { event: string | null, data: string, raw: string }[] = []
  const parser = createSseParser(e => events.push(e))
  return { events, parser }
}

describe('createSseParser', () => {
  it('reassembles events split across chunks', () => {
    const { events, parser } = collect()
    parser.push('data: {"a":')
    parser.push('1}\n')
    expect(events).toHaveLength(0)
    parser.push('\n')
    expect(events).toEqual([{ event: null, data: '{"a":1}', raw: 'data: {"a":1}\n\n' }])
  })

  it('handles CRLF line endings and multi-line data', () => {
    const { events, parser } = collect()
    parser.push('event: chatui-usage\r\ndata: line1\r\ndata: line2\r\n\r\n')
    expect(events).toHaveLength(1)
    expect(events[0]!.event).toBe('chatui-usage')
    expect(events[0]!.data).toBe('line1\nline2')
  })

  it('keeps the raw event text for pass-through', () => {
    const { events, parser } = collect()
    const raw = 'data: {"choices":[{"delta":{"content":"hé"}}]}\n\n'
    parser.push(raw)
    expect(events[0]!.raw).toBe(raw)
  })

  it('ignores comment lines and events without data', () => {
    const { events, parser } = collect()
    parser.push(': keep-alive\n\n')
    parser.push('data: x\n\n')
    expect(events.map(e => e.data)).toEqual(['x'])
  })

  it('hands comment-only events to the optional second callback', () => {
    const other: string[] = []
    const events: string[] = []
    const parser = createSseParser(e => events.push(e.data), raw => other.push(raw))
    parser.push(': keepalive\n\ndata: x\n\n')
    expect(other).toEqual([': keepalive\n\n'])
    expect(events).toEqual(['x'])
  })

  it('emits several events from one chunk and flushes a trailing event on end()', () => {
    const { events, parser } = collect()
    parser.push('data: 1\n\ndata: 2\n\ndata: 3')
    expect(events.map(e => e.data)).toEqual(['1', '2'])
    parser.end()
    expect(events.map(e => e.data)).toEqual(['1', '2', '3'])
  })

  it('strips exactly one space after the colon', () => {
    const { events, parser } = collect()
    parser.push('data:  two spaces\n\ndata:none\n\n')
    expect(events.map(e => e.data)).toEqual([' two spaces', 'none'])
  })
})
