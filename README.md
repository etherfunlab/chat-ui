# chat-ui

Self-hostable web3 LLM interface. A Solana wallet is the account: sign in with
a wallet signature, top up with USDC, and chat with upstream models whose API
key never leaves the server. Conversations live only in your browser. The same
deployment doubles as an OpenAI-compatible API.

> Work in progress. Design doc: `docs/superpowers/specs/2026-10-30-chat-ui-design.md`.

## Development

```bash
bun install
cp .env.example .env   # fill in the blanks
bun run migrate
bun run dev
```

## API

Any deployment is also an OpenAI-compatible API at `https://<your-domain>/v1`.
Sign in on the web, open Settings → API keys, and create a key; it is shown
once. Requests made with the key are billed to that wallet.

```bash
curl https://<your-domain>/v1/chat/completions \
  -H "Authorization: Bearer cu-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-5-5","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

| Endpoint | Notes |
|---|---|
| `POST /v1/chat/completions` | Streaming and non-streaming. Accepts `model`, `messages`, `stream`, `stream_options`, `max_tokens` / `max_completion_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`, `seed`, `reasoning_effort` (or `reasoning.effort`), `tools`, `tool_choice`, `parallel_tool_calls`, `response_format`, `prompt_cache_key`, `prompt_cache_retention`. `messages` are forwarded as sent, `cache_control` annotations included. Thinking comes back in `reasoning_content`. |
| `POST /v1/responses` | OpenAI Responses API, streaming and non-streaming. Accepts `model`, `input`, `instructions`, `stream`, `max_output_tokens`, `temperature`, `top_p`, `reasoning`, `tools`, `tool_choice`, `parallel_tool_calls`, `text`, `include`, `prompt_cache_retention`. Stateless: `store` is always `false`, and `previous_response_id`, `background` and `conversation` are rejected. Send the full `input` each turn; keep reasoning across turns with `include: ["reasoning.encrypted_content"]`. |
| `GET /v1/models` | The models this deployment offers, in display order. |

Other fields are dropped. `venice_parameters` passes only `enable_web_search`
(`on` / `off` / `auto`) and `enable_web_citations`; on `/v1/responses` a
`web_search` tool also turns search on. `reasoning_effort` must be one the
model offers; `none` only where the model can turn thinking off.

Errors are OpenAI-shaped: `{"error":{"code":…,"message":…,"type":…}}`.

| Status | `code` |
|---|---|
| 400 | `invalid_request`, `invalid_json`, `model_not_found`, `invalid_reasoning_effort`, `model_not_vision`, `too_many_images`, `unsupported_parameter`, `upstream_rejected` |
| 401 | `missing_api_key`, `invalid_api_key` |
| 402 | `insufficient_balance` |
| 403 | `wallet_not_allowed` (private deployments) |
| 413 | `request_too_large` |
| 429 | `upstream_rate_limited` |
| 502 / 503 | `upstream_unavailable`, `upstream_error`, `upstream_auth`, `catalog_unavailable`, `ledger_unavailable` |

Limits and billing:

- Request bodies are capped at 4.5 MB (the hosting platform's limit). Agents
  with very long contexts hit this first; trim history or drop images.
- A streamed answer is read to the end and billed on real usage even if the
  client disconnects. Hanging up does not stop the charge.
- The upstream's `cost` field is not returned. The charge for each request is
  the upstream cost plus this deployment's markup; see the usage page.
- `/v1` is open to any origin (CORS) with a Bearer key. Browser sessions use
  `/api` and are same-origin only.

## License

MIT © EtherFun Lab
