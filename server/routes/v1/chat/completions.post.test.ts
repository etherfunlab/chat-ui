import { describe, it, expect, vi } from 'vitest'
import { stubH3Globals } from '../../../../tests/helpers/h3'

stubH3Globals()
const relayV1 = vi.fn().mockResolvedValue('sent')
vi.mock('#server/utils/v1', () => ({ relayV1 }))
vi.mock('#server/utils/relay', () => ({ relayChat: 'relayChat', relayResponses: 'relayResponses' }))

const { default: handler } = await import('./completions.post')

describe('POST /v1/chat/completions', () => {
  it('relays through the chat protocol with Bearer auth', async () => {
    const evt = {} as never
    expect(await handler(evt)).toBe('sent')
    expect(relayV1).toHaveBeenCalledWith(evt, 'relayChat')
  })
})
