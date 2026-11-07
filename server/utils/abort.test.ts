import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { clientAbortSignal } from './abort'

function fakeEvent() {
  const res = Object.assign(new EventEmitter(), { writableFinished: false })
  return { event: { node: { res } } as never, res }
}

describe('clientAbortSignal', () => {
  it('aborts when the connection closes before the response finished', () => {
    const { event, res } = fakeEvent()
    const signal = clientAbortSignal(event)
    res.emit('close')
    expect(signal.aborted).toBe(true)
  })

  it('does not abort when the response finished normally', () => {
    const { event, res } = fakeEvent()
    const signal = clientAbortSignal(event)
    res.writableFinished = true
    res.emit('close')
    expect(signal.aborted).toBe(false)
  })
})
