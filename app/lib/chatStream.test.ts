import { describe, it, expect, vi } from 'vitest'
import { ChatApiError, streamChat } from './chatStream'

const enc = new TextEncoder()

function sseResponse(chunks: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const data = (p: unknown) => `data: ${JSON.stringify(p)}\n\n`
const delta = (d: Record<string, unknown>) => data({ choices: [{ index: 0, delta: d }] })
const body = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }], stream: true as const }

function run(chunks: string[]) {
  const deltas: { text: string, reasoning: string }[] = []
  const onCitations = vi.fn()
  const onUsage = vi.fn()
  const fetchImpl = vi.fn(async () => sseResponse(chunks))
  const p = streamChat({
    body, signal: new AbortController().signal, fetchImpl: fetchImpl as never,
    onDelta: d => deltas.push(d), onCitations, onUsage,
  })
  return { p, deltas, onCitations, onUsage, fetchImpl }
}

const joined = (ds: { text: string, reasoning: string }[]) =>
  ({ text: ds.map(d => d.text).join(''), reasoning: ds.map(d => d.reasoning).join('') })

describe('streamChat', () => {
  it('posts the body to /api/chat and separates reasoning from text', async () => {
    const { p, deltas, fetchImpl } = run([
      delta({ reasoning_content: 'plan ' }),
      delta({ reasoning_content: 'it' }),
      delta({ content: 'Hello' }),
      delta({ content: ' world' }),
      'data: [DONE]\n\n',
    ])
    await p
    expect(fetchImpl).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
      method: 'POST', body: JSON.stringify(body), credentials: 'same-origin',
    }))
    expect(joined(deltas)).toEqual({ text: 'Hello world', reasoning: 'plan it' })
  })

  it('routes <think> content into reasoning', async () => {
    const { p, deltas } = run([delta({ content: '<thi' }), delta({ content: 'nk>why</think>Answer' }), 'data: [DONE]\n\n'])
    await p
    expect(joined(deltas)).toEqual({ text: 'Answer', reasoning: 'why' })
  })

  it('reports citations once and the usage event', async () => {
    const citations = [{ title: 'A', url: 'https://a.example', content: 'x' }, { title: 'bad' }]
    const usage = { usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2, reasoningTokens: 0, webSearch: true }, costMicro: '33' }
    const { p, onCitations, onUsage } = run([
      data({ choices: [{ index: 0, delta: { content: '' } }], venice_parameters: { web_search_citations: citations } }),
      data({ choices: [{ index: 0, delta: { content: 'x' } }], venice_parameters: { web_search_citations: citations } }),
      `event: chatui-usage\ndata: ${JSON.stringify(usage)}\n\n`,
      'data: [DONE]\n\n',
    ])
    await p
    expect(onCitations).toHaveBeenCalledTimes(1)
    expect(onCitations).toHaveBeenCalledWith([{ title: 'A', url: 'https://a.example' }])
    expect(onUsage).toHaveBeenCalledWith(usage)
  })

  it('throws ChatApiError from an OpenAI-shaped error body', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Balance too low', type: 'x', code: 'insufficient_balance' } }), { status: 402 }))
    await expect(streamChat({ body, signal: new AbortController().signal, fetchImpl: fetchImpl as never, onDelta() {}, onCitations() {}, onUsage() {} }))
      .rejects.toEqual(expect.objectContaining({ name: 'ChatApiError', status: 402, code: 'insufficient_balance', message: 'Balance too low' }))
  })

  it('throws ChatApiError from an h3 error body (e.g. expired session)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Unauthorized' }), { status: 401 }))
    const err = await streamChat({ body, signal: new AbortController().signal, fetchImpl: fetchImpl as never, onDelta() {}, onCitations() {}, onUsage() {} }).catch(e => e)
    expect(err).toBeInstanceOf(ChatApiError)
    expect(err).toMatchObject({ status: 401, code: 'http_401', message: 'Unauthorized' })
  })

  it('propagates an abort', async () => {
    const ac = new AbortController()
    const fetchImpl = vi.fn(async (_u: string, init: { signal: AbortSignal }) => new Response(new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(delta({ content: 'partial' })))
        init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
      },
    }), { status: 200 }))
    const deltas: unknown[] = []
    const p = streamChat({ body, signal: ac.signal, fetchImpl: fetchImpl as never, onDelta: d => { deltas.push(d); ac.abort() }, onCitations() {}, onUsage() {} })
    await expect(p).rejects.toThrow()
    expect(deltas).toHaveLength(1)
  })
})
