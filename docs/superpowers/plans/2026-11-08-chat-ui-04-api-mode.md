# chat-ui Plan 4/5 — API 模式

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `chat.etherfun.xyz` 当 OpenAI 兼容 API 接入其他终端：`POST /v1/chat/completions`、`POST /v1/responses`、`GET /v1/models`，凭 Bearer API key 鉴权；key 在设置里生成（只显示一次）、命名、吊销；计费走 Plan 2 账本，转发复用 Plan 3 的 `relayChat`。

**Architecture:** `relay.ts` 的转发核心抽成「协议无关的计量循环 + 协议适配器」：适配器负责整形请求、从 payload 里读 usage / 输出文本 / 完成标志 / 引用；`relayChat`、`relayResponses` 各绑一个适配器。`/v1/*` 与 `/api/chat` 的差别只在三处：鉴权（key hash 走 `open_charge` 一次往返）、客户端断开策略（网页中止上游，`/v1` 读完再结算）、不发 `chatui-usage` 事件。API key 明文只在生成时出现一次，库里只存 sha256。

**Tech Stack:** 沿用 Plan 1–3；新增 `@vercel/functions`（`waitUntil`，让 `/v1` 在客户端断开后继续读完上游并结算）。

**Spec:** `docs/superpowers/specs/2026-10-30-chat-ui-design.md` §「API 模式」「Responses API」「账户与登录」（key 只用于 `/v1/*`）、「计费」。

## Global Constraints

- Plan 1–3 的全部 Global Constraints 照旧（整数 micro-USD、不落对话内容、上游 key 不出现在任何响应 / 错误 / 日志、公开仓纪律、Conventional Commits、界面只用 `DESIGN.md` token、文案走 i18n 只写 `en`）。
- 账本约定（`ledger-contract-for-relay`）：`openCharge` 每次新 id；每条路径 settle 且只一次；总是显式设输出上限（chat 用 `max_completion_tokens`，responses 用 `max_output_tokens`）；冻结用 `config.markupBps`，结算用 `markupBpsFor`；上游报告的实收优先但封顶「价目 token 成本 × 2」。
- **客户端断开策略（用户 2026-10-31 拍板）**：`/api/chat` 维持现状——断开即中止上游，按可见输出估算；`/v1/*` 断开后不中止上游，继续读完（仍受 `RELAY_MAX_MS` 约束）、不再转发，按真实 usage / 上游实收结算。
- 上游的 `cost` 字段不透给任何客户端：转发前从 payload 剥掉（流式与非流式都剥）。
- `/v1/*` 只认 `Authorization: Bearer <key>`，不读 cookie、不查同源；`/api/*` 不认 Bearer。`/v1/*` 对任意来源开放 CORS（`Access-Control-Allow-Origin: *`，不带凭据）。
- `/v1/*` 的所有错误都是 OpenAI 形状（`errorResponse`），绝不抛 `createError` 让 Nitro 渲染默认错误页。错误码沿用 relay 现有的：`invalid_api_key`（401）、`insufficient_balance`（402）、`request_too_large`（413）、`wallet_not_allowed`（403）等；新增 `missing_api_key`（401）。
- API key：格式 `cu-` + 32 字节随机数的 base64url（共 46 字符）；库里存 `key_hash = sha256(key)` 的 hex 和 `key_prefix = key.slice(0, 10)`；每个钱包最多 20 把未吊销的 key；名字 trim 后 1–40 字符。
- Responses API：强制 `store: false`；带 `previous_response_id`、`background` 或 `conversation` 的请求 400（`unsupported_parameter`）；`include` 原样放行；`venice_parameters` 只放行 `enable_web_search`、`enable_web_citations`，并固定 `include_venice_system_prompt: false`。

## Review Focus

1. `/v1/chat/completions` 流式中客户端断开：上游不被中止，服务端读到 `[DONE]` 后按真实 usage 结算为 `ok`，冻结释放 → Task 3 `drains the upstream after a client disconnect and settles on real usage`。
2. 上游 payload 带 `cost` 字段：任何客户端都收不到它，但结算仍用它 → Task 3 `strips cost from forwarded payloads but still charges by it`。
3. Responses 流以 `response.incomplete` / `response.failed` 结尾：按其 `usage` 结算、不白拿；`failed` 记 `error` 状态 → Task 4 `settles an incomplete / failed response by its usage`。
4. 已吊销的 key 继续调用：`/v1/*` 全部 401，`/api/keys` 列表仍显示它（标吊销） → Task 1 `walletForKey ignores revoked keys`、Task 5 `rejects a revoked key`。
5. 带 cookie 不带 Bearer 打 `/v1/*`：401，不会因 session 放行 → Task 5 `ignores the session cookie`。

---

### Task 1: API key 原语与数据访问

**Files:**
- Create: `server/utils/apiKeys.ts`
- Test: `server/utils/apiKeys.test.ts`（纯函数）、`server/utils/apiKeys.pg.test.ts`（PGlite）

**Interfaces:**
- Produces:
  - `generateApiKey(): { key: string, prefix: string, hash: string }`（`crypto.randomBytes(32)` → base64url；`hash = hashApiKey(key)`）
  - `hashApiKey(key: string): string`（sha256 hex）
  - `parseBearer(header: string | undefined): string | null`：`Bearer <key>` 且 key 以 `cu-` 开头、长度 46 → 返回 key；否则 null
  - `MAX_KEYS_PER_WALLET = 20`、`MAX_KEY_NAME = 40`
  - `interface ApiKeyRow { id: string, name: string, prefix: string, createdAt: string, lastUsedAt: string | null, revokedAt: string | null }`
  - `createApiKey(db, wallet: string, name: string): Promise<{ row: ApiKeyRow, key: string }>`；名字非法抛 `RelayError(400, 'invalid_key_name')`，超额抛 `RelayError(400, 'too_many_keys')`；`id = crypto.randomUUID()`
  - `listApiKeys(db, wallet): Promise<ApiKeyRow[]>`（按 `created_at DESC`，含已吊销）
  - `revokeApiKey(db, wallet, id): Promise<boolean>`（只吊销本钱包、未吊销的；返回是否改到行）
  - `walletForKey(db, config: ServerConfig, hash: string): Promise<string | null>`：未吊销的 key 的 wallet；`BILLING=off` 时再过一遍 `allowedWallets`，不在名单返回 null（与 `getSessionWallet` 一致）

- [ ] **Step 1: 写失败测试（纯函数）**：`generateApiKey` 产出 `cu-` 开头 46 字符、每次不同、`hash` 等于 `hashApiKey(key)`、`prefix` 为前 10 字符；`parseBearer` 接受 `Bearer cu-…`，拒绝缺头、`Basic`、长度不对、`bearer` 小写（HTTP scheme 大小写不敏感——接受）
- [ ] **Step 2: 写失败测试（pg）**：`createApiKey` 存 hash 不存明文（`SELECT key_hash` 等于 `hashApiKey(key)`，整表无明文）；名字 trim、空名 / 41 字符 400；第 21 把 400 `too_many_keys`，吊销一把后能再建；`listApiKeys` 只列本钱包、含吊销行、`createdAt` 降序；`revokeApiKey` 跨钱包返回 false；`walletForKey ignores revoked keys`；`walletForKey` 在 `billing: 'off'` 且不在白名单时为 null
- [ ] **Step 3: Run `bun run test server/utils/apiKeys` — FAIL**
- [ ] **Step 4: 实现 `server/utils/apiKeys.ts`**（SQL 用 `$n` 参数；吊销是 `UPDATE … SET revoked_at = now() WHERE id = $1 AND wallet = $2 AND revoked_at IS NULL`）
- [ ] **Step 5: Run `bun run test server/utils/apiKeys` && `bun run typecheck` — PASS**
- [ ] **Step 6: Commit** `feat: API key generation, hashing and storage`

### Task 2: 网页端的 key 管理端点

**Files:**
- Create: `server/api/keys/index.get.ts`、`server/api/keys/index.post.ts`、`server/api/keys/[id].delete.ts`
- Test: `server/api/keys/index.post.test.ts`、`server/api/keys/[id].delete.test.ts`（按 `chat.post.test.ts` 的 stub 方式）

**Interfaces:**
- Consumes: Task 1；`assertSameOrigin`、`requireWallet`、`getPool`
- Produces（session + 同源，`BILLING` 开关都有）:
  - `GET /api/keys` → `{ keys: ApiKeyRow[] }`
  - `POST /api/keys` body `{ name: string }` → `{ key: string, row: ApiKeyRow }`（明文只在这里出现一次）；`RelayError` → `createError({ statusCode: e.status, statusMessage: e.code })`
  - `DELETE /api/keys/:id` → `{ revoked: boolean }`

- [ ] **Step 1: 写失败测试**：POST 对签入钱包调用 `createApiKey(db, 'W', 'laptop')` 并原样返回；名字不是字符串 400；跨源 403 且不调 `createApiKey`；DELETE 取 `getRouterParam(event, 'id')` 传给 `revokeApiKey`（`stubH3Globals` 再 stub `getRouterParam`）
- [ ] **Step 2: Run `bun run test server/api/keys` — FAIL**
- [ ] **Step 3: 实现三个 handler**
- [ ] **Step 4: Run `bun run test server/api/keys` && `bun run typecheck` — PASS**
- [ ] **Step 5: Commit** `feat: API key management endpoints`

### Task 3: 转发核心抽协议、断开策略与 cost 剥除

**Files:**
- Create: `server/utils/upstream/protocol.ts`、`server/utils/upstream/chatProtocol.ts`
- Modify: `server/utils/relay.ts`、`server/api/chat.post.ts`、`server/utils/upstream/prepareChat.ts`（`PreparedChat` 改名 `Prepared` 并移到 `protocol.ts`，`prepareChat` 返回它）
- Test: `server/utils/relay.pg.test.ts`（加用例）、`server/api/chat.post.test.ts`（断言新字段）

**Interfaces:**
- Produces:
  - `protocol.ts`：
    ```ts
    export interface Prepared {
      model: ModelEntry
      upstreamBody: Record<string, unknown>
      stream: boolean
      /** chat only: 客户端自己要了 usage chunk；responses 恒为 true（usage 在 completed 事件里，照转） */
      clientWantsUsage: boolean
      requestedMaxOut: number
      webSearch: 'on' | 'auto' | 'off'
    }
    export type StreamEnd = 'none' | 'ok' | 'failed'
    export interface Protocol {
      endpoint: 'chat' | 'responses'
      upstreamPath: '/chat/completions' | '/responses'
      prepare(body: unknown, models: ModelEntry[]): Prepared
      /** 把输出上限写进 upstreamBody（max_completion_tokens / max_output_tokens） */
      setMaxOutput(body: Record<string, unknown>, n: number): void
      usage(payload: unknown): Usage | null
      reportedCost(payload: unknown): number | null
      citations(payload: unknown): Citation[]
      outputText(payload: unknown): string
      /** 这个 payload 是否宣告了结束，以及是正常结束还是上游报失败 */
      end(payload: unknown): StreamEnd
      /** chat: usage-only chunk；responses: 恒 false */
      isUsageOnly(payload: unknown): boolean
    }
    ```
  - `chatProtocol.ts`：`export const chatProtocol: Protocol`——`prepare = prepareChat`，`usage = usageFromChat`，`reportedCost = reportedCostMicro`，`citations = citationsFromChat`，`outputText` / `end`（`finish_reason` → `'ok'`）/ `isUsageOnly` 从 `relay.ts` 搬过来
  - `relay.ts`：
    ```ts
    export interface RelayRequest {
      auth: RelayAuth
      rawBody: string
      signal: AbortSignal
      emitUsageEvent: boolean
      /** 'abort'：客户端断开即中止上游（网页）；'drain'：继续读完并结算，不再转发（/v1） */
      disconnect: 'abort' | 'drain'
      /** drain 模式下，服务端的收尾工作交给它保活（Vercel waitUntil） */
      keepAlive?: (work: Promise<unknown>) => void
    }
    export async function relay(deps: RelayDeps, protocol: Protocol, req: RelayRequest): Promise<Response>
    export const relayChat = (deps: RelayDeps, req: RelayRequest) => relay(deps, chatProtocol, req)
    ```
    行为：`drain` 时不监听 `req.signal`、`ReadableStream.cancel()` 不中止上游（只有 `RELAY_MAX_MS` 定时器会）；`keepAlive` 在流式分支拿到「读完 + settle」的 promise；`end(payload) === 'failed'` 时结算状态 `error` 且照常计费；转发前若 payload 含 `cost`，删掉后以 `data: ${JSON.stringify(payload)}\n\n` 重发（带 `event:` 行的事件保留 `event:` 行），否则照 `raw` 转；非流式 JSON 同样删 `cost` 再返回
- Consumes: `chat.post.ts` 传 `disconnect: 'abort'`

- [ ] **Step 1: 写失败测试（relay.pg.test.ts）**：
  - `drains the upstream after a client disconnect and settles on real usage`：`scripted` 上游在第二个 chunk 后等待 50ms 再发 usage chunk（`usd: 0.001`）与 `[DONE]`；请求 `disconnect: 'drain'`，读响应第一块后 `reader.cancel()` 并 abort `req.signal`；断言上游 `signal.aborted === false`，等 `keepAlive` 收到的 promise 结束后账户 `balance = 1_000_000 - 1100, held = 0`，记录 `status: 'ok', output_tokens: 20`
  - `aborts the upstream on client disconnect in abort mode`（现有用例改名复用，断言上游 `signal.aborted === true`）
  - `strips cost from forwarded payloads but still charges by it`：流式与非流式各一例，响应文本不含 `"cost"`，但扣 1100
  - `keeps the event name when re-emitting a stripped payload`：chunk 以 `event: foo\ndata: {…cost…}\n\n` 发出，响应里仍有 `event: foo`
- [ ] **Step 2: Run `bun run test server/utils/relay` — FAIL**
- [ ] **Step 3: 抽 `protocol.ts` / `chatProtocol.ts`，改 `relay.ts`、`chat.post.ts`、`chat.post.test.ts`（断言 `disconnect: 'abort'`）**
- [ ] **Step 4: Run `bun run test` && `bun run typecheck` — PASS（Plan 3 全部用例不变）**
- [ ] **Step 5: Commit** `refactor: protocol adapter, drain-on-disconnect mode and cost stripping in the relay`

### Task 4: Responses 协议

**Files:**
- Create: `server/utils/upstream/prepareResponses.ts`、`server/utils/upstream/responsesProtocol.ts`、`server/utils/upstream/responsesUsage.ts`
- Modify: `server/utils/relay.ts`（导出 `relayResponses`）
- Test: `server/utils/upstream/prepareResponses.test.ts`、`server/utils/upstream/responsesUsage.test.ts`、`server/utils/relayResponses.pg.test.ts`

**Interfaces:**
- Produces:
  - `prepareResponses(body: unknown, models: ModelEntry[]): Prepared`：
    - 放行字段：`model`、`input`、`instructions`、`stream`、`max_output_tokens`、`temperature`、`top_p`、`reasoning`、`tools`、`tool_choice`、`parallel_tool_calls`、`text`、`include`、`prompt_cache_retention`；其余丢弃
    - `input` 须是非空字符串或非空数组（400 `invalid_request`）；数组里 `type === 'input_image'` 的内容块按 `vision` / `maxImages` 校验（复用 prepareChat 的错误码）
    - 出现 `previous_response_id` / `background` / `conversation` → 400 `unsupported_parameter`；`store` 固定 `false`
    - `reasoning.effort` 按模型校验（与 prepareChat 同一规则、同一错误码 `invalid_reasoning_effort`），`reasoning.summary` 原样放行；模型不支持强度时删掉 `reasoning.effort`
    - `webSearch`：`venice_parameters.enable_web_search` 为 `'on'`/`'auto'` 照取；`tools` 里有 `{ type: 'web_search' }` 视为 `'on'`；模型不支持联网则 `'off'`
    - `requestedMaxOut = min(max_output_tokens ?? model.maxOutputTokens, model.maxOutputTokens)`；`clientWantsUsage = true`
  - `responsesUsage.ts`：
    - `usageFromResponses(payload)`：从 `payload.usage` 或 `payload.response.usage`（流式 `response.completed` 等事件）读 `input_tokens`、`input_tokens_details.cached_tokens`、`output_tokens`、`output_tokens_details.reasoning_tokens`；`cacheWriteTokens` 读 `input_tokens_details.cache_creation_input_tokens`（没有则 0）
    - `citationsFromResponses(payload)`：遍历 `(payload.response ?? payload).output[].content[].annotations[]` 里 `type === 'url_citation'` 的 `{ title, url }`，`safeHttpUrl` 过滤
    - `outputTextFromResponses(payload)`：流式取 `type` 以 `.delta` 结尾的事件的 `delta` 字符串；非流式取 `output[]` 里 `message.content[].text`、`reasoning.summary[].text`、`function_call.arguments`
    - `responsesEnd(payload): StreamEnd`：`type === 'response.completed' | 'response.incomplete'` → `'ok'`；`'response.failed'` → `'failed'`；非流式 `object === 'response'` 且 `status` 为 `completed | incomplete` → `'ok'`，`failed` → `'failed'`；其余 `'none'`
  - `responsesProtocol: Protocol`（`endpoint: 'responses'`，`upstreamPath: '/responses'`，`setMaxOutput` 写 `max_output_tokens`，`reportedCost = reportedCostMicro`（上游若报就用，文档未承诺），`isUsageOnly = () => false`）
  - `relayResponses = (deps, req) => relay(deps, responsesProtocol, req)`

- [ ] **Step 1: 写失败测试（prepareResponses）**：放行 / 丢弃字段；`store` 被改成 false；三个被拒字段各 400 `unsupported_parameter`；`input_image` 超过 `maxImages` 400；`reasoning.effort` 非法 400；`tools: [{type:'web_search'}]` → `webSearch: 'on'`；`max_output_tokens` 超过模型上限被压回
- [ ] **Step 2: 写失败测试（responsesUsage）**：非流式 usage 含 cached / reasoning；`response.completed` 事件里的 usage；`url_citation` 提取且丢弃 `javascript:`；`.delta` 文本累加；`responsesEnd` 三态
- [ ] **Step 3: 写失败测试（relayResponses.pg）**：
  - `streams a responses answer through, settles by usage and resends [DONE]`：事件序列 `response.created` → `response.output_text.delta`×2 → `response.completed`（usage 100/20，无 cost）→ `[DONE]`；`event:` 行原样转出；扣费 = `costMicro(pricing, usage) × 1.1`
  - `settles an incomplete / failed response by its usage`：`response.failed` 收尾 → 记录 `status: 'error'`，`cost_micro > 0`，响应里含 `response.failed`
  - `charges the search fee for a web_search tool when no cost is reported`
  - `non-stream: returns the response object with cost removed and settles ok`
  - `rejects previous_response_id with 400 before touching the ledger`（`usage_records` 为空）
- [ ] **Step 4: Run `bun run test server/utils/upstream server/utils/relayResponses` — FAIL**
- [ ] **Step 5: 实现三个文件，在 `relay.ts` 导出 `relayResponses`**
- [ ] **Step 6: Run `bun run test` && `bun run typecheck` — PASS**
- [ ] **Step 7: Commit** `feat: Responses API protocol for the metered relay`

### Task 5: `/v1` 端点与 CORS

**Files:**
- Create: `server/routes/v1/chat/completions.post.ts`、`server/routes/v1/responses.post.ts`、`server/routes/v1/models.get.ts`、`server/middleware/cors.ts`、`server/utils/v1.ts`
- Modify: `package.json`（`@vercel/functions`）、`scripts/mock-upstream.ts`（加 `POST /responses`：非流式返回 `object: 'response'` 对象，流式发 `response.created` / `response.output_text.delta` / `response.completed` / `[DONE]`，usage 同 chat）
- Test: `server/utils/v1.test.ts`、`server/middleware/cors.test.ts`、`server/routes/v1/chat/completions.post.test.ts`、`server/routes/v1/responses.post.test.ts`、`server/routes/v1/models.get.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseBearer` / `hashApiKey` / `walletForKey`；Task 3 `relayChat`；Task 4 `relayResponses`；`getRelayDeps`、`clientAbortSignal`、`errorResponse`
- Produces:
  - `server/utils/v1.ts`：
    - `bearerHash(event): string | Response`：`parseBearer(getHeader(event, 'authorization'))` → `hashApiKey`；缺失或格式不对返回 `errorResponse(401, 'missing_api_key', 'Send an API key as "Authorization: Bearer <key>"')`
    - `keepAlive(event, work: Promise<unknown>): void`：`event.waitUntil(work)` 再调 `@vercel/functions` 的 `waitUntil(work)`（非 Vercel 环境下它是 no-op）
    - `relayV1(event, relayFn): Promise<unknown>`：`bearerHash` → 401 直接 `sendWebResponse`；否则 `readRawBody(event, 'utf8') ?? ''`，调 `relayFn(getRelayDeps(), { auth: { keyHash }, rawBody, signal: clientAbortSignal(event), emitUsageEvent: false, disconnect: 'drain', keepAlive: w => keepAlive(event, w) })` 并 `sendWebResponse`
  - `completions.post.ts` = `relayV1(event, relayChat)`；`responses.post.ts` = `relayV1(event, relayResponses)`
  - `models.get.ts`：`bearerHash` → `walletForKey(getPool(), getServerConfig(), hash)` 为 null 则 401 `invalid_api_key`；否则 `{ object: 'list', data: catalog.list().map(m => ({ id: m.id, object: 'model', created: 0, owned_by: 'venice' })) }`；catalog 失败 503 `catalog_unavailable`。全部经 `sendWebResponse`
  - `server/middleware/cors.ts`：只对 `event.path` 以 `/v1/` 开头的请求：`setResponseHeaders(event, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' })`；`OPTIONS` 则 `setResponseStatus(event, 204)` 并 `send(event)` 结束

- [ ] **Step 1: 写失败测试**：
  - `v1.test.ts`：`bearerHash` 对 `Bearer cu-…` 返回 sha256 hex；缺头 / `Basic` 返回 401 Response，body `error.code === 'missing_api_key'`；`relayV1` 传给 relayFn 的参数为 `{ auth: { keyHash }, emitUsageEvent: false, disconnect: 'drain', keepAlive: fn }`，并 `ignores the session cookie`（事件带 `cookie` 头、无 `authorization` → 401，relayFn 不被调）
  - `cors.test.ts`：`/v1/models` 设四个头；`OPTIONS /v1/chat/completions` 204；`/api/me` 不设头
  - `models.get.test.ts`：`rejects a revoked key`（`walletForKey` → null → 401 `invalid_api_key`）；正常返回 `object: 'list'` 且顺序同 catalog
  - 两个 post 测试：各自把 `relayV1` 以对应 relay 函数调用
- [ ] **Step 2: Run `bun run test server/routes server/middleware server/utils/v1` — FAIL**
- [ ] **Step 3: `bun add @vercel/functions`；实现五个文件；mock upstream 加 `/responses`**
- [ ] **Step 4: Run `bun run test` && `bun run typecheck` && `bun run build` — PASS**
- [ ] **Step 5: 冒烟（本地 Postgres + mock upstream，按 Plan 3 的做法）**：用 `psql` 直接 `INSERT INTO api_keys` 一把已知 hash 的 key；`curl -i -X OPTIONS http://localhost:3000/v1/chat/completions -H 'Origin: https://x.test'` → 204 且带 `access-control-allow-origin: *`；无 Bearer → 401 JSON；`/v1/models` 列出 4 个；`/v1/chat/completions` `stream: true` 流到 `[DONE]` 且无 `"cost"`；`/v1/responses` 非流式返回 `object: 'response'`；`usage_records` 两条 `ok`，`api_key_id` 非空
- [ ] **Step 6: Commit** `feat: /v1 OpenAI-compatible endpoints with Bearer auth and CORS`

### Task 6: 设置里的 API key 面板

**Files:**
- Create: `app/composables/useApiKeys.ts`、`app/components/settings/ApiKeysPanel.vue`
- Modify: `app/components/chat/SettingsDialog.vue`（在「Your chats」与充值之间插 `<SettingsApiKeysPanel />`）、`i18n/locales/en.ts`
- Test: `app/components/settings/ApiKeysPanel.test.ts`（按 `Composer.test.ts` 的挂载方式，`$fetch` 用 `vi.stubGlobal`）

**Interfaces:**
- Consumes: Task 2 的三个端点；`ApiKeyRow` 从 `#server/utils/apiKeys` 只导类型（`import type`）
- Produces:
  - `useApiKeys()` → `{ keys: Ref<ApiKeyRow[]>, loading: Ref<boolean>, error: Ref<string | null>, refresh(), create(name): Promise<string>（返回明文）, revoke(id) }`；`create` 后 `refresh`
  - `ApiKeysPanel.vue`：标题 `settings.apiKeys`；一行说明 base URL（`${location.origin}/v1`，`font-mono`）；列表每行：名字、`prefix…`、创建日期、最近使用（无则 `settings.keyNeverUsed`）、`chip` 吊销（已吊销的行灰显 `text-ink-muted`、无按钮）；底部「名字输入 + 主按钮 `settings.createKey`」；创建成功后在面板顶部显示一次明文 key（`font-mono break-all`）、复制按钮（复用 `chat.copy` / `chat.copied`）和一句 `settings.keyShownOnce`，关闭弹窗即消失。错误码 `too_many_keys`、`invalid_key_name` 映射到 i18n
  - i18n 新键：`settings.apiKeys`、`settings.apiKeysHint`（含 base URL 说明）、`settings.keyName`、`settings.createKey`、`settings.revokeKey`、`settings.keyRevoked`、`settings.keyNeverUsed`、`settings.keyShownOnce`、`settings.tooManyKeys`、`settings.invalidKeyName`

- [ ] **Step 1: 写失败测试**：挂载后调 `GET /api/keys` 并渲染两行（一行已吊销无按钮）；输入名字点创建 → `POST /api/keys` body `{ name }`，明文出现在页面一次且列表刷新；点吊销 → `DELETE /api/keys/<id>`；`too_many_keys` 显示 `settings.tooManyKeys`
- [ ] **Step 2: Run `bun run test app/components/settings` — FAIL**
- [ ] **Step 3: 实现；样式只用 `DESIGN.md` token 与现有 `.chip` / `.icon-button`**
- [ ] **Step 4: Run `bun run test` && `bun run typecheck` && `bun run build` — PASS；`bun run dev` 手查日夜两态下面板不违反 DESIGN §7**
- [ ] **Step 5: Commit** `feat: API key management in settings`

### Task 7: README 的 API 章节

**Files:**
- Modify: `README.md`（加 `## API` 一节）

- [ ] **Step 1: 写**：base URL `https://<your-domain>/v1`；`Authorization: Bearer <key>`（设置里生成，只显示一次）；三个端点与各自接受的字段（引用 spec 列表）；`venice_parameters` 只放行联网两字段；Responses 强制 `store: false`、拒绝 `previous_response_id` / `background`；错误码表（401 `missing_api_key` / `invalid_api_key`、402 `insufficient_balance`、403 `wallet_not_allowed`、413 `request_too_large`、400 `unsupported_parameter` / `model_not_found` / `invalid_reasoning_effort`）；请求体上限 4.5 MB；断开策略：客户端断开后服务端仍读完并按真实用量计费；上游 `cost` 不返回，账单看用量页（Plan 5）
- [ ] **Step 2: Commit** `docs: API usage`

### Task 8: 分支收尾

- [ ] **Step 1: `bun run test` && `bun run typecheck` && `bun run build` — 全绿**
- [ ] **Step 2: 终审（Opus reviewer）→ 修 → codex review → 修（按 `codex-review-after-each-plan`）**
- [ ] **Step 3: 删除记忆 `ledger-contract-for-relay` 里已完成的两条 Plan 4 待办；push、开 PR（一次只走一个 PR）**
