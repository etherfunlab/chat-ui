// A local stand-in for the Venice API, for development and smoke tests without
// spending real credits. Run `bun run mock:upstream`, then start the app with
// VENICE_BASE_URL=http://localhost:8787 and MODELS limited to the fixture's
// four models (see the printed hint).
import { createServer, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.MOCK_UPSTREAM_PORT ?? 8787)
const fixturePath = fileURLToPath(new URL('../server/utils/__fixtures__/venice-models.json', import.meta.url))
const models = JSON.parse(readFileSync(fixturePath, 'utf8')) as { data: { id: string }[] }

const ANSWER = [
  'Here is a short comparison',
  ' ^1^:\n\n',
  '- **Solana**: a flat base fee plus an optional priority fee.\n',
  '- **Base**: L2 execution plus an L1 data fee ^2^.\n\n',
  'Query it in bulk:\n\n',
  '```bash\ncurl https://chat.example.com/v1/chat/completions \\\n  -H "Authorization: Bearer cu-..."\n```\n',
]
const REASONING = ['Comparing ', 'per-transfer ', 'costs on ', 'both chains.']
const CITATIONS = [
  { title: 'Fees on Solana', url: 'https://solana.com/docs/core/fees' },
  { title: 'Base fees', url: 'https://docs.base.org/fees' },
]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (req.method === 'GET' && url.pathname === '/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', ...models }))
    return
  }
  if (req.method !== 'POST' || (url.pathname !== '/chat/completions' && url.pathname !== '/responses')) {
    res.writeHead(404).end()
    return
  }

  let raw = ''
  for await (const part of req) raw += part
  if (url.pathname === '/responses') return serveResponses(raw, res)
  const body = JSON.parse(raw) as {
    stream?: boolean
    reasoning_effort?: string
    venice_parameters?: { enable_web_search?: string }
  }
  const search = body.venice_parameters?.enable_web_search === 'on'
  const thinking = body.reasoning_effort !== 'none'
  const text = search ? ANSWER.join('') : ANSWER.join('').replace(/ \^\d\^/g, '')
  const usage = { prompt_tokens: 812, completion_tokens: 164, completion_tokens_details: { reasoning_tokens: thinking ? 40 : 0 } }
  const cost = { usd: 0.006524, diem: 0 }

  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: text, reasoning_content: thinking ? REASONING.join('') : null } }],
      usage, cost, venice_parameters: { web_search_citations: search ? CITATIONS : [] },
    }))
    return
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
  send({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }], venice_parameters: { web_search_citations: search ? CITATIONS : [] } })
  if (thinking) {
    for (const r of REASONING) {
      await sleep(120)
      send({ choices: [{ index: 0, delta: { reasoning_content: r } }] })
    }
  }
  for (const piece of (search ? ANSWER : ANSWER.map(p => p.replace(/ \^\d\^/g, '')))) {
    await sleep(80)
    if (res.destroyed) return
    send({ choices: [{ index: 0, delta: { content: piece } }] })
  }
  send({ choices: [], usage, cost })
  res.end('data: [DONE]\n\n')
})

/** The Responses API shape: a response object, or its event stream ending in [DONE]. */
async function serveResponses(raw: string, res: ServerResponse): Promise<void> {
  const body = JSON.parse(raw) as { stream?: boolean }
  const text = ANSWER.join('').replace(/ \^\d\^/g, '')
  const usage = { input_tokens: 812, output_tokens: 164, total_tokens: 976, output_tokens_details: { reasoning_tokens: 40 } }
  const response = (status: string, output: unknown[]) => ({ id: 'resp_mock', object: 'response', status, output, usage })
  const message = { id: 'msg_mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }

  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(response('completed', [message])))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (type: string, extra: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`)
  send('response.created', { response: response('in_progress', []) })
  for (const piece of ANSWER.map(p => p.replace(/ \^\d\^/g, ''))) {
    await sleep(80)
    if (res.destroyed) return
    send('response.output_text.delta', { item_id: 'msg_mock', output_index: 0, content_index: 0, delta: piece })
  }
  send('response.completed', { response: response('completed', [message]) })
  res.end('data: [DONE]\n\n')
}

server.listen(PORT, () => {
  console.log(`mock upstream on http://localhost:${PORT}`)
  console.log(`VENICE_BASE_URL=http://localhost:${PORT} MODELS=${models.data.map(m => m.id).join(',')}`)
})
