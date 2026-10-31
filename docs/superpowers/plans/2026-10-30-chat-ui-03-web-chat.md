# chat-ui Plan 3/5 — 网页聊天与转发

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录后的完整聊天体验：选模型、思考开关与强度、联网、看图、系统提示词，回答流式显示（含思考过程、引用、代码块、扣费），会话存本机 IndexedDB 并可导出导入；服务端 `/api/chat` 按 Plan 2 账本冻结、转发 Venice、结算。

**Architecture:** 服务端一个转发核心 `relayChat`（本计划供网页用，Plan 4 的 `/v1/*` 复用）：整形请求 → `openCharge` 冻结 → 设 `max_completion_tokens` → 流式转发并旁路解析 SSE → 流结束 / 中断 / 出错都 `settleCharge`。客户端把会话存 Dexie，发送前在本地组装请求体（图片缩放、超限时先丢最早的图），用 fetch 读 SSE 流。界面按 `DESIGN.md`。

**Tech Stack:** 沿用 Plan 1–2；新增 `dexie`、`markdown-it`、`@nuxtjs/i18n`、`@nuxt/fonts`；测试新增 `fake-indexeddb`、`happy-dom`（组件测试）。

**Spec:** `docs/superpowers/specs/2026-10-30-chat-ui-design.md`；视觉以仓根 `DESIGN.md` 为准。

## Global Constraints

- Plan 1、2 的全部 Global Constraints 照旧（整数 micro-USD、不落对话内容、公开仓纪律、Conventional Commits）。
- 界面一律照 `DESIGN.md`：只用其 token（组件不写字面量颜色、不写 `dark:` 变体）；阴影只给浮层；AI 回复平铺不套气泡；不新增圆角 / 字号 / 字重档。
- 界面文案一律走 i18n（`t('…')`），本计划只写 `en`；Plan 5 补 `zh-Hans`、`zh-Hant`。
- 对话内容只作为 `/api/chat` 的请求体离开浏览器；服务端任何地方（日志、错误、DB）不出现请求或响应正文。上游 key 不出现在任何响应、错误、日志里。
- 账本调用约定（Plan 2 终审给出，逐条遵守）：
  - `openCharge` 每次用新 id；
  - 正常结束、客户端中断、上游报错、超时，每条路径都 `settleCharge`；
  - 转发时总是显式设 `max_completion_tokens`：计费开时 = min(请求上限, `affordableOutputTokens`)，计费关时 = 请求上限；
  - 冻结用 `config.markupBps`，结算用 `markupBpsFor(config, wallet)`；
  - `Usage.inputTokens` 为含 cache 的总输入。
- 常量：`MAX_BODY_BYTES = 4_500_000`（服务端），`BODY_LIMIT_BYTES = 4_400_000`（客户端组装上限），`RELAY_MAX_MS = 600_000`（单次转发时长上限，须 < 15 分钟的过期冻结释放线），图片长边 1568px、JPEG 质量 0.85。
- **计费口径（本计划更新 spec）**：上游响应带 `cost`（`usd + diem`，均为美元等值）时，扣费 = floor(上游实收 × (1 + 加价率))，联网费已含在内；没带时退回 Plan 2 的 `costMicro`（usage × 单价 + 搜索费）。
- 联网计费标记：`enable_web_search = 'on'` 的请求算联网；`'auto'` 只在返回了引用时算。

## Review Focus

1. 客户端中途断开：上游被中止，按已收到的输出估算结算为 `aborted`，冻结释放 → Task 5 `settles an aborted stream from what was received`。
2. 上游 200 但流里没有 usage chunk：按估算结算，不得记 0 → Task 5 `estimates usage when the stream carries none`。
3. SSE 事件跨网络分片（`data:` 行在 JSON 中间被切断）、`\r\n` 行尾 → 解析不丢事件 → Task 2 `reassembles events split across chunks`。
4. 历史里图片多到超过 4.4MB 或超过模型 `maxImages` → 从最早的图开始换成占位，文字不截断；只剩文字仍超限 → 明确报错 → Task 8 用例。
5. 模型把思考写在 `<think>…</think>` 里且标签被切在两个 delta 之间，或与 `reasoning_content` 混用 → 思考与正文分得开 → Task 2 `splits think tags across deltas`。

---

### Task 1: 设计 token、字体、主题切换、i18n 骨架

**Files:**
- Create: `app/composables/useTheme.ts`、`i18n/locales/en.json`、`i18n/i18n.config.ts`
- Modify: `app/assets/css/main.css`、`nuxt.config.ts`、`app/components/auth/SignInPanel.vue`、`app/components/billing/TopUpPanel.vue`、`app/composables/useTopUp.ts`（`topUpMessage` 返回 i18n key）、`package.json`
- Test: `app/composables/useTheme.test.ts`、`app/composables/useTopUpFlow.test.ts`（改为断言 key）

**Interfaces:**
- Produces:
  - `main.css`：`@theme` 写 `DESIGN.md` §2 全部 token 的日间值，`.dark` 覆盖夜间值；另有 `--font-sans`（Inter）、`--font-native`、`--font-mono` 与 `--shadow-menu`；`body` 用 `bg-ground text-ink font-sans font-medium`（500）
  - `nuxt.config.ts`：`@nuxt/fonts`（Inter 500/600/700，自托管）、`@nuxtjs/i18n`（`strategy: 'no_prefix'`，只有 `en`，`detectBrowserLanguage: { useCookie: true }`）、`nitro.vercel.functions.maxDuration = 800`；`app.head.script` 内联一段首帧前读 `localStorage['cu-theme']` 并给 `<html>` 加 `.dark` 的脚本（避免闪白）
  - `resolveTheme(pref: 'system' | 'light' | 'dark', systemDark: boolean): 'light' | 'dark'`；`useTheme()` → `{ pref: Ref, setPref(p) }`，写 localStorage（try/catch）、切 `<html>.dark`、`system` 时跟随 `matchMedia` 变化
  - `topUpMessage(status)` 改为返回 i18n key（如 `topup.status.confirmed`），组件里 `t()`

- [ ] **Step 1: 写失败测试**：`resolveTheme` 三档 × 系统明暗；`topUpMessage` 返回 key 且只有 confirmed 对应 `topup.status.confirmed`
- [ ] **Step 2: Run `bun run test app/composables` — FAIL**
- [ ] **Step 3: 实现；把 SignInPanel / TopUpPanel 现有英文文案搬进 `en.json`**
- [ ] **Step 4: Run `bun run test`、`bun run typecheck`、`bun run build` — PASS；`bun run dev` 手查日夜切换无闪白**
- [ ] **Step 5: Commit** `feat: design tokens, theme switching and i18n scaffold`

### Task 2: SSE 解析与思考标签拆分（共享）

**Files:**
- Create: `shared/sse.ts`、`shared/think.ts`
- Test: `shared/sse.test.ts`、`shared/think.test.ts`

**Interfaces:**
- Produces:
  - `createSseParser(onEvent: (e: { event: string | null, data: string, raw: string }) => void): { push(chunk: string): void, end(): void }`——按空行切事件（兼容 `\r\n`），多行 `data:` 以 `\n` 拼接，`raw` 是事件原文（含结尾空行），忽略注释行（`:` 开头）
  - `createThinkSplitter(): { push(content: string): { text: string, reasoning: string }, end(): { text: string, reasoning: string } }`——把 `<think>…</think>` 内的内容归入 reasoning，标签可被切在任意两次 push 之间；`end()` 冲刷缓冲

- [ ] **Step 1: 写失败测试**

```ts
it('reassembles events split across chunks', /* push('data: {"a":'), push('1}\n'), push('\n') → one event data '{"a":1}' */)
it('handles CRLF line endings and multi-line data', ...)
it('keeps the raw event text for pass-through', ...)
it('ignores comment lines', ...)
it('splits think tags across deltas', /* push('Hi <thi'), push('nk>plan</th'), push('ink> done') → text 'Hi  done', reasoning 'plan' */)
it('passes text through when there are no think tags', ...)
it('flushes an unterminated think block as reasoning on end()', ...)
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: shared SSE parser and think-tag splitter`

### Task 3: 请求整形 `prepareChat`

**Files:**
- Create: `server/utils/upstream/errors.ts`、`server/utils/upstream/prepareChat.ts`、`shared/chat.ts`
- Test: `server/utils/upstream/prepareChat.test.ts`

**Interfaces:**
- Consumes: Plan 2 `ModelEntry`（`shared/models.ts`）
- Produces:
  - `shared/chat.ts`：`ChatTextPart`、`ChatImagePart`（`{ type: 'image_url', image_url: { url } }`）、`ChatMessage`、`ChatRequestBody`、`Citation { title: string, url: string }`、`ChatUsageEvent { usage: Usage, costMicro: string }`、`ApiErrorBody { error: { message, type, code } }`
  - `class RelayError extends Error { status: number, code: string }`；`errorResponse(status: number, code: string, message: string): Response`（OpenAI 错误形状 JSON）
  - `prepareChat(body: unknown, models: ModelEntry[]): PreparedChat`，`PreparedChat = { model: ModelEntry, upstreamBody: Record<string, unknown>, stream: boolean, clientWantsUsage: boolean, requestedMaxOut: number, webSearch: 'on' | 'auto' | 'off' }`
  - 规则：
    - model 不在目录 → 400 `model_not_found`；messages 非空且每项 role ∈ system / developer / user / assistant / tool → 否则 400 `invalid_request`；`n > 1` → 400 `invalid_request`
    - 只放行 `model, messages, stream, max_tokens, max_completion_tokens, temperature, top_p, frequency_penalty, presence_penalty, stop, seed, n, reasoning_effort, reasoning, tools, tool_choice, parallel_tool_calls, response_format, prompt_cache_key, prompt_cache_retention`；其余丢弃
    - 思考强度 = `reasoning_effort ?? reasoning.effort`：模型不支持调强度 → 两者都丢；支持但值不在（`effortOptions` ∪ `canDisable ? ['none'] : []`）→ 400 `invalid_reasoning_effort`；上游只收 `reasoning_effort`
    - `venice_parameters` 重建为 `{ include_venice_system_prompt: false, enable_web_search, enable_web_citations? }`；`enable_web_search` 取 on / off / auto，缺省 off；模型不支持联网 → 强制 off
    - 含图片而模型无 vision → 400 `model_not_vision`；图片总数 > `maxImages` → 400 `too_many_images`
    - `stream: true` 时 `stream_options = { include_usage: true }`，`clientWantsUsage` = 客户端原本是否要
    - `requestedMaxOut = min(max_completion_tokens ?? max_tokens ?? model.maxOutputTokens, model.maxOutputTokens)`，须正整数否则 400；上游体里删掉 `max_tokens`

- [ ] **Step 1: 写失败测试**：每条规则一个用例；`passes cache_control on content parts untouched`；`drops fallbacks, user and metadata`；`drops reasoning_effort for a model without effort control`（Gemini fixture）；`rejects minimal for opus`；`forces web search off for a model without it`
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: upstream chat request shaping`

### Task 4: 上游响应解析与计费口径

**Files:**
- Create: `server/utils/upstream/usage.ts`
- Modify: `server/utils/pricing.ts`、`docs/superpowers/specs/2026-10-30-chat-ui-design.md`（计费一节）
- Test: `server/utils/upstream/usage.test.ts`、`server/utils/pricing.test.ts`

**Interfaces:**
- Produces:
  - `usageFromChat(payload: unknown): Usage | null`——取 `usage.prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens / prompt_tokens_details.cache_creation_input_tokens / completion_tokens_details.reasoning_tokens`，`webSearch` 置 false（由调用方定）；无 usage 返回 null
  - `reportedCostMicro(payload: unknown): number | null`——`cost.usd + cost.diem` 换 micro-USD，十进制精确、向下取整；字段缺失或非有限非负数返回 null
  - `citationsFromChat(payload: unknown): Citation[]`——`venice_parameters.web_search_citations` 里有 `title` 和 `url` 的项
  - `pricing.ts` 新增 `applyMarkup(micro: number, markupBps: number): number`（BigInt，向下取整）
  - spec「计费」一节改为：成本优先取上游响应报告的实收（`cost.usd + cost.diem`，已含联网费）× (1 + 加价率)；上游未报告时按 usage × 单价 + 搜索费

- [ ] **Step 1: 写失败测试**：`usageFromChat` 全字段与缺字段；`reportedCostMicro`：`{usd: 0.00042, diem: 0}` → 420、`{usd: 0.1, diem: 0.2}` → 300000（不得因浮点得 299999）、缺失 / 负数 → null；`applyMarkup(420, 1000)` → 462、`applyMarkup(1, 1000)` → 1
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现，并改 spec 计费一节**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: parse upstream usage, reported cost and citations`

### Task 5: 转发核心 `relayChat`

**Files:**
- Create: `server/utils/relay.ts`
- Test: `server/utils/relay.pg.test.ts`（PGlite 账本 + 假上游）

**Interfaces:**
- Consumes: Task 2 `createSseParser`；Task 3 `prepareChat`、`RelayError`、`errorResponse`；Task 4 全部；Plan 2 `openCharge`、`settleCharge`、`computeHold`、`affordableOutputTokens`、`costMicro`、`estimateInputTokens`、`estimateTokens`、`markupBpsFor`、`Catalog`
- Produces:
  - `RelayDeps { config: ServerConfig, db: Queryable, catalog: Catalog, upstream: (path: string, body: unknown, signal: AbortSignal) => Promise<Response>, newId: () => string }`
  - `relayChat(deps: RelayDeps, req: { auth: { wallet: string } | { keyHash: string }, rawBody: string, signal: AbortSignal, emitUsageEvent: boolean }): Promise<Response>`
  - 流程：体积超 `MAX_BODY_BYTES` → 413 `request_too_large`；JSON 坏 → 400 `invalid_json`；目录不可用 → 503 `catalog_unavailable`；`prepareChat`；按 `estimateInputTokens(upstreamBody)` 与 `computeHold` 冻结；`openCharge` 结果映射 401 `invalid_api_key` / 403 `wallet_not_allowed` / 402 `insufficient_balance`；账本异常 → 503 `ledger_unavailable`；设 `max_completion_tokens`；`AbortController` 同时挂客户端 signal 与 `RELAY_MAX_MS` 定时器；上游网络错 → 502 `upstream_unavailable`；上游非 2xx → 400 `upstream_rejected`（带上游 `error.message`，截 500 字）/ 429 `upstream_rate_limited` / 401·403 → 502 `upstream_auth`（不带上游内容）/ 其余 502 `upstream_error`
  - 流式：原样转发每个事件（`clientWantsUsage` 为 false 时丢掉只含 usage 的 chunk），旁路收集 usage、`cost`、引用、输出文字（内容 + 思考 + tool 参数，只在内存里用于估算）；上游的 `[DONE]` 先扣下，结算完成后若 `emitUsageEvent` 先发 `event: chatui-usage` + `ChatUsageEvent`，再发 `data: [DONE]`
  - 非流式：读 JSON → 结算 → 原样返回
  - `finish(status)` 只执行一次：usage 缺失时用（输入估算，`estimateTokens(输出文字)`）；联网标记按 Global Constraints；成本按计费口径；`settleCharge` 失败重试一次，再失败只记一行不含正文的日志
  - 响应头：流式 `content-type: text/event-stream`、`cache-control: no-cache`、`x-accel-buffering: no`

- [ ] **Step 1: 写失败测试（PGlite 真账本，假上游返回手写 SSE）**

```ts
it('streams through, settles with reported cost, and emits the usage event before [DONE]', ...)
it('falls back to token pricing when the upstream reports no cost', ...)
it('estimates usage when the stream carries none', /* settled cost > 0, status ok */)
it('settles an aborted stream from what was received', /* abort signal mid-stream → upstream aborted, status 'aborted', held back to 0 */)
it('caps max_completion_tokens to what the hold affords', /* small balance → upstream body max_completion_tokens < model max */)
it('always sends max_completion_tokens, also with billing off', ...)
it('refuses with 402 insufficient_balance and calls no upstream', ...)
it('maps upstream 401 to 502 upstream_auth without echoing the upstream body', ...)
it('settles error with zero cost on an upstream failure', ...)
it('rejects a body over 4.5MB with 413 before touching the ledger', ...)
it('applies the wallet markup at settlement and the general markup to the hold', /* exempt wallet: cost = reported; others ×1.1 */)
it('charges web search for on, and for auto only when citations came back', ...)
it('never includes the upstream key in any response', ...)
it('aborts the upstream after RELAY_MAX_MS', /* fake timers */)
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: metered streaming relay for chat completions`

### Task 6: 端点、上游连接与本地假上游

**Files:**
- Create: `server/api/chat.post.ts`、`server/api/models.get.ts`、`server/utils/upstream/venice.ts`、`server/utils/relayDeps.ts`、`server/utils/abort.ts`、`scripts/mock-upstream.ts`
- Test: `server/api/chat.post.test.ts`、`server/api/models.get.test.ts`

**Interfaces:**
- Consumes: Task 5 `relayChat`；Plan 1 `requireWallet`、`assertSameOrigin`；Plan 2 `getCatalog`、`getPool`
- Produces:
  - `createVeniceUpstream(config): RelayDeps['upstream']`——`POST {veniceBaseUrl}{path}`，JSON，`Authorization: Bearer`
  - `getRelayDeps(): RelayDeps`（`newId` = `crypto.randomUUID`）
  - `clientAbortSignal(event): AbortSignal`——响应在写完前关闭即 abort
  - `POST /api/chat`：同源 + `requireWallet`，`readRawBody` 后交给 `relayChat({ auth: { wallet }, emitUsageEvent: true })`，`sendWebResponse`
  - `GET /api/models` → `{ models: ModelEntry[] }`（公开）
  - `scripts/mock-upstream.ts`：本地端口 8787 的假 Venice，`GET /models` 返回测试 fixture，`POST /chat/completions` 流式返回一段带 `reasoning_content`、联网时带引用、结尾带 usage 与 `cost` 的回答；`package.json` 加 `mock:upstream`。用于开发与手测，不花钱

- [ ] **Step 1: 写失败测试**：chat 端点：跨域 403、未登录 401、把原始请求体与钱包交给 `relayChat`；models：返回目录
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test`、`bun run typecheck`；起 `mock:upstream` 与 dev（`VENICE_BASE_URL=http://localhost:8787`），`curl /api/models` 返回 4 个模型**
- [ ] **Step 5: Commit** `feat: chat and models endpoints with a local mock upstream`

### Task 7: 本机会话存储与导出导入

**Files:**
- Create: `app/lib/store.ts`
- Test: `app/lib/store.test.ts`（`fake-indexeddb`）

**Interfaces:**
- Produces:
  - `ThinkingPref { enabled: boolean, effort: string | null }`
  - `StoredSession { id, wallet, title, model, systemPrompt: string | null, thinking: ThinkingPref, webSearch: boolean, createdAt: number, updatedAt: number }`
  - `StoredMessage { id, sessionId, role: 'user' | 'assistant', text: string, images: string[], reasoning: string, reasoningMs: number | null, citations: Citation[], usage: ChatUsageEvent | null, status: 'done' | 'streaming' | 'aborted' | 'error', error: string | null, omittedImages: number, model: string, createdAt: number }`
  - `createStore(dbName = 'chat-ui'): ChatStore`，方法：`listSessions(wallet)`（按 `updatedAt` 倒序）、`getSession(id)`、`putSession(s)`、`deleteSession(id)`（连带消息）、`listMessages(sessionId)`（按 `createdAt` 正序）、`putMessage(m)`、`getSetting(wallet, key)`、`setSetting(wallet, key, value)`、`exportSessions(wallet, ids?: string[]): Promise<ExportFile>`、`importSessions(wallet, file: unknown): Promise<{ imported: number, copied: number }>`
  - `ExportFile = { format: 'chat-ui-export', version: 1, exportedAt: string, sessions: (StoredSession & { messages: StoredMessage[] })[] }`；导入：校验 format / version；会话一律归到当前钱包；id 已存在则另存副本（新会话 id、新消息 id、标题加 ` (copy)`），不覆盖

- [ ] **Step 1: 写失败测试**：`partitions sessions by wallet`、`deletes messages with their session`、`round-trips an export including images`、`imports an existing id as a copy, never overwriting`、`rejects a file of another format or version`、`stores settings per wallet`
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现（`bun add dexie`、`bun add -d fake-indexeddb`）**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: per-wallet conversation store with export and import`

### Task 8: 请求组装、思考偏好与图片尺寸

**Files:**
- Create: `app/lib/thinking.ts`、`app/lib/chatRequest.ts`、`app/lib/images.ts`
- Test: `app/lib/thinking.test.ts`、`app/lib/chatRequest.test.ts`、`app/lib/images.test.ts`

**Interfaces:**
- Consumes: Task 3 `ChatRequestBody`；Task 7 `StoredMessage`、`ThinkingPref`
- Produces:
  - `thinkingFor(model: ModelEntry, pref: ThinkingPref | null): ThinkingPref`——缺省开、强度取 `defaultEffort`；模型不能关时强制开；强度不在模型档位内时回到缺省
  - `reasoningEffortFor(model, pref): string | undefined`——不支持思考或不支持调强度 → undefined；关（且可关）→ `'none'`；否则 pref.effort
  - `buildChatRequest(i: { model: ModelEntry, history: StoredMessage[], systemPrompt: string | null, thinking: ThinkingPref, webSearch: boolean }): { body: ChatRequestBody, omittedImageMessageIds: string[] }`，规则：
    - 系统提示词非空时放最前；历史只带 `done` / `aborted` 的消息与非空正文；助手消息只带正文，不带思考
    - 模型无 vision → 所有图换成正文后缀 `IMAGE_OMITTED = '[image not sent]'`；有 vision → 只保留最新的 `maxImages` 张，更早的换占位
    - 序列化后超 `BODY_LIMIT_BYTES` → 从最早的图开始逐张换占位直到落回上限；没有图可换仍超限 → 抛 `BodyTooLargeError`
    - `venice_parameters = { enable_web_search: webSearch && model.webSearch ? 'on' : 'off', enable_web_citations: webSearch }`；`stream: true`
  - `fitWithin(width: number, height: number, maxEdge: number): { width: number, height: number }`；`downscaleImage(file: Blob): Promise<string>`（`createImageBitmap` + canvas → JPEG data URL，长边 1568、质量 0.85）

- [ ] **Step 1: 写失败测试**：`thinkingFor` 对 Opus / DeepSeek / Gemini fixture 的缺省与强制；`reasoningEffortFor` 各分支；`buildChatRequest`：系统提示词、跳过 error 消息、`drops the oldest images first when over the byte limit`、`keeps only the newest maxImages images`、`replaces images for a non-vision model`、`throws when text alone exceeds the limit`、`never truncates text`；`fitWithin` 横竖图与小图不放大
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: client request assembly within the body limit`

### Task 9: 流式客户端与 `useChat`

**Files:**
- Create: `app/lib/chatStream.ts`、`app/composables/useChat.ts`
- Test: `app/lib/chatStream.test.ts`、`app/composables/useChat.test.ts`

**Interfaces:**
- Consumes: Task 2 `createSseParser`、`createThinkSplitter`；Task 7 store；Task 8 `buildChatRequest`
- Produces:
  - `streamChat(o: { body: ChatRequestBody, signal: AbortSignal, fetchImpl?: typeof fetch, onDelta(d: { text: string, reasoning: string }): void, onCitations(c: Citation[]): void, onUsage(u: ChatUsageEvent): void }): Promise<void>`——POST `/api/chat`；非 2xx 解析 `ApiErrorBody` 抛 `ChatApiError { status, code, message }`；正文 `delta.content` 过 think 拆分、`delta.reasoning_content` 直入 reasoning；首个带 `venice_parameters.web_search_citations` 的 chunk 给引用；`chatui-usage` 事件给 usage；`[DONE]` 结束
  - `useChat(sessionId: Ref<string | null>)` → `{ messages, sending, send(text: string, images: string[]), stop(), retry(messageId) }`：先落用户消息与 `streaming` 的助手消息，流中每 500ms 至多写一次库，结束写 `done` / `aborted` / `error` 与 `reasoningMs`，然后 `refreshMe()`；首条用户消息截前 60 字作会话标题；`BodyTooLargeError` 不发请求，直接给出可读错误

- [ ] **Step 1: 写失败测试**：`streamChat` 用假 fetch 回放 SSE：正文与思考分流、引用、usage 事件、错误体解析、abort；`useChat`（fake-indexeddb + 假 `streamChat`）：成功、中止为 aborted、错误为 error 且保留已收到的正文、标题生成
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: streaming chat client and conversation state`

### Task 10: Markdown 渲染与消息组件

**Files:**
- Create: `app/lib/markdown.ts`、`app/components/chat/UserMessage.vue`、`app/components/chat/AssistantMessage.vue`、`app/components/chat/ThinkingBlock.vue`、`app/components/chat/MessageList.vue`
- Test: `app/lib/markdown.test.ts`、`app/components/chat/ThinkingBlock.test.ts`

**Interfaces:**
- Produces:
  - `renderMarkdown(text: string, citations: Citation[]): string`——markdown-it（`html: false`、`linkify: true`），链接 `target="_blank" rel="noopener noreferrer"`；代码块输出带头行（语言 + `data-copy` 的 Copy 按钮）的结构；`^1^` / `^1,2^` 换成指向对应引用的编号胶囊（越界编号原样保留）
  - 组件按 `DESIGN.md` §5：用户蓝气泡（含缩略图与「图片未发送」胶囊）；AI 平铺；思考块流式时展开、完成后收成「Thought for N s」可展开；来源胶囊；meta 行「N tokens · $x.xx」（`formatUsd`）；`aborted` / `error` 状态行用次字色 / danger-ink；Copy 用事件委托 + `navigator.clipboard`（失败时选中文本）

- [ ] **Step 1: 写失败测试**：`escapes raw HTML`（`<img src=x onerror=…>` 不成标签）、`renders fenced code with a copy header`、`links citation markers and leaves out-of-range ones`、`opens links in a new tab safely`；ThinkingBlock：streaming 时展开、done 后收起且显示秒数
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现（`bun add markdown-it`）**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: markdown rendering and message components`

### Task 11: 输入区、模型选择、侧栏与设置

**Files:**
- Create: `app/components/chat/Composer.vue`、`app/components/chat/ThinkingMenu.vue`、`app/components/chat/ModelPicker.vue`、`app/components/chat/ChatHeader.vue`、`app/components/chat/SessionList.vue`、`app/components/chat/SettingsDialog.vue`、`app/components/chat/AppShell.vue`、`app/composables/useModels.ts`
- Modify: `app/pages/index.vue`、`i18n/locales/en.json`
- Test: `app/components/chat/ThinkingMenu.test.ts`、`app/components/chat/Composer.test.ts`

**Interfaces:**
- Consumes: Task 7–9 全部；Plan 1–2 `useWalletAuth`、`TopUpPanel`、`SignInPanel`
- Produces:
  - `useModels()` → `{ models, byId }`（`/api/models`，进程内缓存）
  - ThinkingMenu：只列该模型的 `effortOptions`；`canDisable` 才有「Off」；不支持调强度的模型不显示强度控件；切到不能关思考的模型时回到开（`thinkingFor`）
  - Composer：思考 / 联网 / 图片三个 chip（DESIGN.md §6 开关态）；图片只对 vision 模型可用，`maxImages` 封顶，选图即 `downscaleImage`；Enter 发送、Shift+Enter 换行；生成中按钮变 Stop
  - ModelPicker：模型名 + 「$in / $out per 1M」；ChatHeader：菜单键、ModelPicker、余额胶囊（`formatUsd`）
  - SessionList：新建、切换、删除（页内确认）；SettingsDialog：全局系统提示词、当前会话系统提示词、主题（跟随系统 / 日间 / 夜间）、导出全部 / 当前会话、导入 JSON、充值面板入口、登出
  - AppShell：桌面左侧栏 + 主列；窄屏侧栏为抽屉；`index.vue` 未登录渲染 SignInPanel，登录后渲染 AppShell

- [ ] **Step 1: 写失败测试**：ThinkingMenu 对 Opus（无 Off）、DeepSeek（有 Off）、Gemini（无强度控件）；Composer：非 vision 模型图片 chip 禁用、Enter 发送 / Shift+Enter 不发送、生成中显示 Stop
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test`、`bun run typecheck`、`bun run build` — PASS**
- [ ] **Step 5: 起 `mock:upstream` + dev，未登录状态下页面渲染、日夜切换无误；需要钱包签名的手测项写进 PR 的 Test plan 交给人跑**：发消息看到思考展开后收起、联网引用胶囊、代码块 Copy、meta 扣费、余额变化；Stop 中断后可继续；换到 Gemini 后图片 chip 只允许 1 张；导出再导入得到副本；日夜切换全部表面跟随
- [ ] **Step 6: Commit** `feat: chat interface — composer, model picker, sessions and settings`
