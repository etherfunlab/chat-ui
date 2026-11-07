import { describe, it, expect, vi, afterEach } from 'vitest'
import { createVeniceUpstream } from './venice'

afterEach(() => { vi.unstubAllGlobals() })

describe('createVeniceUpstream', () => {
  it('posts JSON to the base URL with the bearer key and the caller’s signal', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const upstream = createVeniceUpstream({ veniceBaseUrl: 'https://api.example/v1', veniceApiKey: 'vk' } as never)
    const signal = new AbortController().signal
    await upstream('/chat/completions', { model: 'm' }, signal)
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer vk' },
      body: '{"model":"m"}',
      signal,
    })
  })
})
