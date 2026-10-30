import { describe, it, expect } from 'vitest'
import { createThinkSplitter } from './think'

function run(chunks: string[]) {
  const s = createThinkSplitter()
  let text = ''
  let reasoning = ''
  for (const c of chunks) {
    const out = s.push(c)
    text += out.text
    reasoning += out.reasoning
  }
  const tail = s.end()
  return { text: text + tail.text, reasoning: reasoning + tail.reasoning }
}

describe('createThinkSplitter', () => {
  it('splits think tags across deltas', () => {
    expect(run(['Hi <thi', 'nk>plan</th', 'ink> done'])).toEqual({ text: 'Hi  done', reasoning: 'plan' })
  })

  it('passes text through when there are no think tags', () => {
    expect(run(['plain ', 'text < 5 and a > b'])).toEqual({ text: 'plain text < 5 and a > b', reasoning: '' })
  })

  it('handles a whole block in one delta and text after it', () => {
    expect(run(['<think>a\nb</think>answer'])).toEqual({ text: 'answer', reasoning: 'a\nb' })
  })

  it('flushes an unterminated think block as reasoning on end()', () => {
    expect(run(['<think>still thinking'])).toEqual({ text: '', reasoning: 'still thinking' })
  })

  it('emits text as soon as it cannot be the start of a tag', () => {
    const s = createThinkSplitter()
    expect(s.push('Hello').text).toBe('Hello')
    expect(s.push(' <t').text).toBe(' ')
    expect(s.push('able>').text).toBe('<table>')
  })

  it('handles one character per delta', () => {
    const chars = [...'x<think>yz</think>w']
    expect(run(chars)).toEqual({ text: 'xw', reasoning: 'yz' })
  })
})
