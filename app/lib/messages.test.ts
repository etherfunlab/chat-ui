import { describe, it, expect } from 'vitest'
import type { StoredMessage } from './store'
import { settleStale } from './messages'

const m = (id: string, status: StoredMessage['status']) => ({ id, status }) as StoredMessage

describe('settleStale', () => {
  it('marks answers left streaming by an earlier visit as aborted', () => {
    const { messages, changed } = settleStale([m('a', 'done'), m('b', 'streaming')], null)
    expect(messages.map(x => x.status)).toEqual(['done', 'aborted'])
    expect(changed.map(x => x.id)).toEqual(['b'])
  })

  it('leaves the answer that is streaming right now alone', () => {
    const { messages, changed } = settleStale([m('b', 'streaming')], 'b')
    expect(messages[0]!.status).toBe('streaming')
    expect(changed).toEqual([])
  })
})
