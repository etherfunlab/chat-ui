# chat-ui Plan 2/5 — 计费核心与 USDC 充值

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付账本（冻结 / 结算）、模型目录与计价、Solana USDC 充值闭环：用户能充值、看到可用余额；后续计划的转发层只需调用本计划产出的函数。

**Architecture:** 余额与冻结在 Postgres，扣费原子性靠两个 plpgsql 函数（`open_charge` 一次往返完成鉴权 + 冻结，`settle_charge` 幂等结算）。计价是纯 TS（整数 micro-USD），单价来自 Venice `/models` 的进程内缓存。充值走 Solana Pay 转账交易：服务端构造、钱包签名、服务端广播并**按链上效果**校验（reference 在场 + 金库 USDC 余额前后差），入账由 `credit_topup` 函数在一条 UPDATE 里完成，交易签名唯一约束防重复入账。

**Tech Stack:** 沿用 Plan 1；新增 `@solana/pay`、`bignumber.js`；测试用 PGlite。

**Spec:** `docs/superpowers/specs/2026-10-30-chat-ui-design.md`

## Global Constraints

- 金额一律整数 micro-USD（JS `number`，须 `Number.isSafeInteger`；SQL `bigint`）。1 USDC 基本单位（6 位小数）= 1 micro-USD。不经浮点换算金额：十进制字符串直接解析成基本单位。
- 计费公式：`cost = floor((上游实收 + 搜索费) × (10000 + markupBps) / 10000)`；上游实收按 usage × 单价（USD / 1M token，等价于 micro-USD / token）。任何取整都向下，不得多扣。
- 冻结用一般用户加价率（`config.markupBps`），结算用该钱包的实际加价率（`markupBpsFor`）。冻结偏保守，结算精确。
- 服务端不落任何对话内容；`usage_records` 只存模型、token 数、金额、状态、时间。
- 所有 SQL 用参数化查询；bigint 从 SQL 读出时 `::text` 再 `Number()`。
- Plan 1 的公开仓纪律、Commit 规范、`getServerConfig` fail-fast 风格照旧。
- 充值金额：最低 1 USDC，最高 10000 USDC；发送方必须是当前 session 钱包。
- `BILLING=off` 时充值端点一律 404。

## Review Focus

1. 同一笔交易签名入账两次（submit 与 reconcile 竞争、重复 submit）→ 只入账一次 → Task 6 `credits a signature at most once`。
2. 结算重试（同一 charge 调两次 `settle_charge`）→ 只扣一次 → Task 2 `settle is idempotent`。
3. 冻结后进程死掉、永不结算 → 15 分钟后同钱包下一次 `open_charge` 释放该冻结 → Task 2 `releases stale holds`。
4. 链上交易付到金库但 mint 不对 / 金额不足 / 无本单 reference → 不入账 → Task 5 `rejects wrong mint`、`rejects short amount`、`rejects missing reference`。
5. 金额字符串 `"1.1"`、`"0.0000001"`、`"1e3"`、`"-5"` → 精确换算或 400，不经浮点 → Task 5 `usdcBaseUnits` 用例。

---

### Task 1: 配置扩展

**Files:**
- Modify: `server/utils/config.ts`、`server/utils/config.test.ts`、`server/utils/session.test.ts`、`server/utils/db.test.ts`（env 桩补齐新必填项）、`.env.example`

**Interfaces:**
- Produces（`ServerConfig` 新增字段）：
  - `models: string[]`——`MODELS` 逗号分隔，缺省为 spec 的 8 个 id，顺序：`claude-opus-5-5, deepseek-v4-1-flash-1017-uncensored, grok-4-7, gemini-4-argon, openai-gpt-6-astra-pro, openai-gpt-61-sol, openai-gpt-61-sol-ultrafast, openai-gpt-61-terra`
  - `veniceBaseUrl: string`——`VENICE_BASE_URL`，缺省 `https://api.venice.ai/api/v1`
  - `usdcMint: string`——`SOLANA_USDC_MINT`，缺省 `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
  - `billing === 'on'` 时 `SOLANA_RPC_URL` 必须是 URL、`SOLANA_TREASURY` 必须 `isValidSolanaAddress`，否则抛
  - `markupBpsFor(config: ServerConfig, wallet: string): number`——在豁免名单返回 0，否则 `config.markupBps`

- [ ] **Step 1: 写失败测试**：`defaults models to the spec list in order`、`requires a valid treasury and RPC URL when billing is on`（缺失 / 非法地址各抛）、`does not require Solana settings when billing is off`、`markupBpsFor exempts listed wallets`
- [ ] **Step 2: Run `bun run test server/utils` — FAIL**
- [ ] **Step 3: 实现；其他测试文件的 env 桩补上合法 `SOLANA_RPC_URL`/`SOLANA_TREASURY`**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: billing and Solana settings in server config`

### Task 2: 账本 schema 与 `open_charge` / `settle_charge`

**Files:**
- Create: `server/db/migrations/0003_ledger.sql`、`server/utils/queryable.ts`、`server/utils/ledger.ts`、`shared/billing.ts`、`tests/helpers/pg.ts`
- Modify: `server/utils/authNonces.ts`（改从 `queryable.ts` 引 `Queryable`）、`server/utils/authNonces.pg.test.ts`（改用 `tests/helpers/pg.ts`）
- Test: `server/utils/ledger.pg.test.ts`

**Interfaces:**
- Produces:
  - `Queryable`（移到 `server/utils/queryable.ts`，签名不变）
  - `createTestDb(): Promise<{ db: Queryable; pglite: PGlite }>`——新 PGlite 实例 + 跑全部迁移（无参 SQL 走 `exec`）
  - `shared/billing.ts`：`interface Usage { inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; reasoningTokens: number; webSearch: boolean }`、`ZERO_USAGE`
  - 0003：`accounts.held_micro bigint NOT NULL DEFAULT 0`；表 `api_keys(id text PK, wallet text NOT NULL REFERENCES accounts, name text NOT NULL, key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz)`（端点在 Plan 4）；表 `usage_records(id text PK, wallet text NOT NULL REFERENCES accounts, api_key_id text REFERENCES api_keys, endpoint text NOT NULL CHECK IN ('chat','responses'), model text NOT NULL, status text NOT NULL CHECK IN ('pending','ok','aborted','error'), hold_micro bigint NOT NULL DEFAULT 0, cost_micro bigint NOT NULL DEFAULT 0, input_tokens int, cached_input_tokens int, cache_write_tokens int, output_tokens int, reasoning_tokens int, web_search boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz)`；索引 `(wallet, created_at DESC)` 与部分索引 `(wallet) WHERE status = 'pending'`
  - SQL `open_charge(p_id text, p_wallet text, p_key_hash text, p_billing boolean, p_allowed text[], p_want bigint, p_min bigint, p_endpoint text, p_model text) RETURNS TABLE(r_status text, r_wallet text, r_api_key_id text, r_hold text, r_available text)`，规则按序：
    1. `p_key_hash` 非空：查未吊销的 key，无则 `invalid_key`；wallet 取 key 的 wallet，并更新 `last_used_at`
    2. `p_allowed` 非空且 wallet 不在其中 → `forbidden`
    3. `SELECT … FOR UPDATE` 锁账户行（无行 → `invalid_key` 若走 key，否则 `forbidden`）；把该钱包 `created_at < now() - interval '15 minutes'` 的 pending 记录置 `error`、`settled_at=now()`，并从 `held_micro` 减去它们的 hold
    4. `p_billing = false`：插 pending 记录（hold 0）→ `ok`
    5. `available = balance - held`；`available < p_min` → `insufficient_balance`（带 available）
    6. `hold = least(p_want, available)`；`held += hold`；插 pending 记录 → `ok`（带 hold）
    （输出列以 `r_` 前缀命名，避免 plpgsql 列名与表列冲突）
  - SQL `settle_charge(p_id text, p_status text, p_cost bigint, p_billing boolean, p_usage jsonb) RETURNS text`：仅当记录仍 `pending` 时写入状态、cost、各 token 列、`web_search`、`settled_at`，并 `held -= hold`、`p_billing` 时 `balance -= cost`，返回 `'settled'`；否则 `'noop'`
  - TS：`openCharge(db, a: { id: string; wallet: string | null; keyHash: string | null; billing: boolean; allowed: string[] | null; wantMicro: number; minMicro: number; endpoint: 'chat' | 'responses'; model: string }): Promise<OpenChargeResult>`，`OpenChargeResult = { status: 'ok'; wallet: string; apiKeyId: string | null; holdMicro: number } | { status: 'invalid_key' } | { status: 'forbidden'; wallet: string | null } | { status: 'insufficient_balance'; wallet: string; availableMicro: number }`；`settleCharge(db, a: { id: string; status: 'ok' | 'aborted' | 'error'; costMicro: number; billing: boolean; usage: Usage }): Promise<'settled' | 'noop'>`

- [ ] **Step 1: 写失败测试（PGlite 真 SQL）**

```ts
// 每个用例前：seed accounts('W', balance 1_000_000)
it('holds the requested amount when affordable', /* want 300_000, min 50_000 → ok, hold 300_000; held_micro = 300_000 */)
it('caps the hold at the available balance', /* want 2_000_000, min 50_000 → hold 1_000_000 */)
it('rejects when available is below the minimum', /* min 1_000_001 → insufficient_balance, availableMicro 1_000_000, no usage row */)
it('sees earlier holds when sizing the next one', /* hold 800_000 then want 500_000 → hold 200_000 */)
it('settle is idempotent', /* settle cost 120_000 twice → 'settled' then 'noop'; balance 880_000; held 0 */)
it('allows a small overdraft when cost exceeds hold', /* hold 100, settle cost 150 → balance 999_850 */)
it('releases stale holds', /* pending row created_at = now()-20min with hold 400_000 (held 400_000) → next open releases it: row 'error', held back to new hold only */)
it('billing off: no hold, no deduction, usage recorded', /* p_billing false → hold 0; settle cost 5_000 → balance unchanged, row cost_micro 5_000 */)
it('resolves the wallet from an API key and stamps last_used_at', /* insert key hash 'h1' for 'W' → ok wallet 'W', apiKeyId set */)
it('rejects revoked or unknown keys', /* revoked_at set → invalid_key; 'nope' → invalid_key */)
it('enforces the allow list for key-resolved wallets', /* p_allowed ['OTHER'] → forbidden */)
```

- [ ] **Step 2: Run `bun run test server/utils/ledger.pg.test.ts` — FAIL**
- [ ] **Step 3: 实现 0003、`queryable.ts`、`ledger.ts`、`shared/billing.ts`、`tests/helpers/pg.ts`，并把 authNonces 的 PGlite 测试改用 helper**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: ledger schema with atomic hold and idempotent settle`

### Task 3: 模型目录

**Files:**
- Create: `shared/models.ts`、`server/utils/catalog.ts`
- Test: `server/utils/catalog.test.ts`

**Interfaces:**
- Produces:
  - `shared/models.ts`：`PriceTier { input: number; output: number; cacheInput?: number; cacheWrite?: number }`（USD / 1M token）、`Pricing extends PriceTier { extended?: PriceTier & { threshold: number } }`、`ModelEntry { id; name; contextTokens; maxOutputTokens; pricing: Pricing; vision: boolean; maxImages: number; reasoning: { supported: boolean; effortOptions: string[]; defaultEffort: string | null; canDisable: boolean }; webSearch: boolean }`
  - `toModelEntry(raw: unknown): ModelEntry | null`——映射 Venice `/models` 一项：`effortOptions` = `reasoningEffortOptions` 去掉 `none`；`canDisable` = 原选项含 `none`；`defaultEffort` = `defaultReasoningEffort`，若为 `none` 取 `effortOptions[0]`，不支持调强度时为 null；`maxImages` = 无 vision 0、`supportsMultipleImages` false 为 1、否则 `maxImages ?? 1`；字段缺失或类型不对返回 null
  - `createCatalog(o: { fetchModels: () => Promise<unknown>; modelIds: string[]; ttlMs?: number; now?: () => number }): Catalog`，`Catalog { list(): Promise<ModelEntry[]>; get(id: string): Promise<ModelEntry | undefined> }`——按 `modelIds` 顺序返回，上游没有的 id 跳过；TTL 缺省 10 分钟；刷新失败时继续用旧缓存，从未成功过则抛
  - `getCatalog(): Catalog`——单例，`fetchModels` = `GET {veniceBaseUrl}/models?type=text`（带 `Authorization: Bearer`）

- [ ] **Step 1: 写失败测试**——fixture 取 Venice `/models` 里 `claude-opus-5-5`、`gemini-4-argon`、`deepseek-v4-1-flash-1017-uncensored`、`openai-gpt-61-sol` 的真实结构（价格、能力原样）：`maps opus reasoning options without none`、`marks deepseek as able to disable thinking`、`gemini has no effort control and one image`、`keeps the extended tier for gpt-61-sol`、`returns models in configured order and skips unknown ids`、`serves stale cache when refresh fails`、`throws when it has never loaded`
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: Venice model catalog with ordered, cached entries`

### Task 4: 计价与冻结额度

**Files:**
- Create: `server/utils/pricing.ts`
- Test: `server/utils/pricing.test.ts`

**Interfaces:**
- Consumes: Task 2 `Usage`；Task 3 `Pricing`、`ModelEntry`
- Produces:
  - `costMicro(p: Pricing, u: Usage, o: { markupBps: number; searchFeeMicro: number }): number`——档位：`p.extended && u.inputTokens > p.extended.threshold` 用 extended 全量计；`uncached = max(0, input − cached − cacheWrite)`；cache 单价缺省回落到 input 单价
  - `estimateTokens(text: string): number` = `ceil(utf8 字节 / 4)`
  - `estimateInputTokens(payload: unknown): number`——递归遍历，字符串计 `estimateTokens`；`{type:'image_url'}` 与 `{type:'input_image'}` 各计 `IMAGE_TOKENS = 1600` 且不计其 URL 字符串
  - `computeHold(o: { pricing: Pricing; inputTokens: number; maxOutputTokens: number; webSearch: boolean; markupBps: number; searchFeeMicro: number }): { wantMicro: number; minMicro: number }`——want 用 `maxOutputTokens`，min 用 `MIN_OUTPUT_TOKENS = 1024`
  - `affordableOutputTokens(o: { holdMicro: number; pricing: Pricing; inputTokens: number; webSearch: boolean; markupBps: number; searchFeeMicro: number }): number`——hold 扣掉输入与搜索成本后，按（含加价）输出单价能买的 token 数，向下取整，不小于 0

- [ ] **Step 1: 写失败测试（精确值）**

```ts
const opus = { input: 4, output: 20, cacheInput: 0.2, cacheWrite: 5 }
const sol = { input: 2, output: 10, extended: { threshold: 272000, input: 4, output: 15 } }
it('prices plain usage', /* opus in 1000 out 500, markup 0 → 14000; markup 1000 → 15400 */)
it('prices cache reads and writes', /* opus in 10000 cached 8000 write 1000 out 0 → 10600 */)
it('switches whole request to the extended tier above threshold', /* sol in 300000 out 1000 → 1215000; in 272000 out 1000 → 554000 */)
it('adds the search fee before markup', /* opus in 1000 out 500 search fee 10000 markup 1000 → 26400 */)
it('rounds down fractional micro-USD', /* input 0.33/M, 1 token → 0 */)
it('estimates CJK and images', /* '你好' → 2; one image_url part with a 1MB data URL → 1600 + small */)
it('sizes want and min holds', ...)
it('derives affordable output tokens from a capped hold', /* opus hold 14000, in 1000, markup 0 → 500 */)
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: integer micro-USD pricing and hold sizing`

### Task 5: Solana USDC 工具

**Files:**
- Create: `server/utils/solana.ts`
- Test: `server/utils/solana.test.ts`

**Interfaces:**
- Produces:
  - `usdcBaseUnits(amount: string): bigint`——只接受 `^\d+(\.\d{1,6})?$`，字符串直接拆整数 / 小数部分拼成基本单位，否则抛
  - `getSolanaConnection(): Connection`——单例，`config.solanaRpcUrl`，commitment `confirmed`
  - `buildTopUpTransaction(o: { connection: Connection; sender: string; recipient: string; usdcMint: string; amountBase: bigint }): Promise<{ reference: string; transactionBase64: string; blockhash: string; lastValidBlockHeight: number }>`——`@solana/pay` `createTransfer`（`splToken` = mint，fresh reference keypair），再用 `getLatestBlockhash('finalized')` 覆盖 `recentBlockhash` 并返回同一组 blockhash / lastValidBlockHeight；`feePayer` = sender；未签名序列化
  - `verifyTopUp(connection, signature: string, v: { recipient: string; usdcMint: string; reference: string; amountBase: bigint }): Promise<{ ok: true } | { ok: false; retryable: boolean; reason: string }>`——**按链上效果**：`getTransaction` 无 / 无 meta → retryable；`meta.err` → 非 retryable；账户 key 列表（含 lookup table）不含 reference → 非 retryable；按 accountIndex 并集求 `owner === recipient && mint === usdcMint` 的 `uiTokenAmount.amount` 前后差，`< amountBase` → 非 retryable；RPC 抛错 → retryable。不得用 `validateTransfer`（钱包会追加 compute-budget 指令，它要求转账是最后一条指令，真付款也会被判失败）
  - `findTopUpSignature(connection, reference: string): Promise<string | null>`——`findReference`（finality `confirmed`），找不到返回 null

- [ ] **Step 1: 写失败测试**：`usdcBaseUnits`：`'1'`→`1_000_000n`、`'1.1'`→`1_100_000n`、`'0.000001'`→`1n`，`'0.0000001'`、`'1e3'`、`'-5'`、`''`、`'1.'` 抛；`verifyTopUp` 用伪 `Connection`（`getTransaction` 返回手工构造的 tx/meta）：`accepts an effect-verified payment even with extra compute-budget instructions`、`rejects wrong mint`、`rejects short amount`、`rejects missing reference`、`treats a not-yet-visible tx as retryable`、`treats an on-chain error as final`、`sums balance change across treasury accounts by index`（新建 ATA 只在 post 侧）
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现（`bun add @solana/pay bignumber.js`；`bignumber.js` 版本与 `@solana/pay` 依赖的类型不同，传 `amount` 时做一次类型断言，运行时结构一致）**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: Solana USDC transfer build and effect-based verification`

### Task 6: 充值端点

**Files:**
- Create: `server/db/migrations/0004_topups.sql`、`server/api/topup/intent.post.ts`、`server/api/topup/submit.post.ts`、`server/api/topup/reconcile.post.ts`、`server/api/topup/index.get.ts`
- Test: `server/utils/topups.pg.test.ts`（真 SQL）、`server/api/topup/*.test.ts`（句柄，mock `#server/utils/solana`）

**Interfaces:**
- Consumes: Task 1 config；Task 5 全部；Plan 1 `requireWallet`、`assertSameOrigin`
- Produces:
  - 0004：表 `topup_intents(id text PK, wallet text NOT NULL REFERENCES accounts, amount_base bigint NOT NULL CHECK (amount_base > 0), reference text NOT NULL UNIQUE, recipient text NOT NULL, mint text NOT NULL, status text NOT NULL CHECK IN ('pending','submitting','confirmed','failed'), tx_signature text UNIQUE, blockhash text NOT NULL, last_valid_block_height bigint NOT NULL, error text, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz)`，索引 `(wallet, created_at DESC)`；函数 `credit_topup(p_intent text, p_sig text) RETURNS bigint`——`UPDATE … SET status='confirmed', tx_signature=p_sig, confirmed_at=now() WHERE id=p_intent AND status IN ('pending','submitting') RETURNING wallet, amount_base`，无行返回 0；有行则 `balance_micro += amount_base` 并返回金额
  - `POST /api/topup/intent {amount: string}` → `{ intentId, transactionBase64 }`：sameOrigin、`requireWallet`、billing off → 404；金额 1–10000 USDC 否则 400；sender = session 钱包；`createTransfer` 报余额不足 → 402 `data.code = 'insufficient_funds'`
  - `POST /api/topup/submit {intentId, signedTxBase64}` → `{ status: 'confirmed', creditedMicro: string } | { status: 'submitting' } | { status: 'expired' } | { status: 'failed', reason }`：原子 claim `pending → submitting`（限本钱包）；广播；blockhash 过期回退 `pending` 并返回 `expired`；确认超时或 verify retryable → 保持 `submitting`；verify 定论失败 → `failed`；成功 → `credit_topup`
  - `POST /api/topup/reconcile` → `{ intents: { id, status }[] }`：本钱包 `submitting` 的单子（及 1 小时内 `pending` 的单子），有签名就 verify，没签名就 `findTopUpSignature`；成功 → `credit_topup`
  - `GET /api/topup` → `{ intents: { id, amountMicro: string, status, txSignature: string | null, createdAt: string }[] }`（最近 50 条）

- [ ] **Step 1: 写失败测试**：真 SQL `credits a signature at most once`（同一 intent 调两次 → 第二次 0，余额只加一次）、`rejects one signature for two intents`（第二个 intent 用同一签名 → 唯一约束报错且余额不变）；句柄：`intent rejects 0.5 and 10001`、`intent 404 when billing off`、`submit credits on verified effect`、`submit stays submitting on retryable verify`、`submit marks failed on final verify`、`submit only claims the caller's own intent`、`reconcile finds by reference and credits`
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: USDC top-up intents with idempotent crediting`

### Task 7: 可用余额与前端充值面板

**Files:**
- Modify: `server/api/me.get.ts`、`server/api/me.get.test.ts`、`app/pages/index.vue`
- Create: `app/composables/useTopUp.ts`、`app/components/billing/TopUpPanel.vue`、`shared/money.ts`
- Test: `app/composables/useTopUp.test.ts`、`shared/money.test.ts`

**Interfaces:**
- Consumes: Task 6 端点
- Produces:
  - `GET /api/me` → `{ wallet, billing: 'on' | 'off', availableMicro: string }`（`balance − held`）
  - `formatUsd(micro: string | number): string`——`'1234567'` → `'$1.23'`（向下取到分）；负数带负号
  - `performTopUp(deps: { amount: string; connectedWallet: string; sessionWallet: string; signTransaction: (tx: Transaction) => Promise<Transaction>; fetcher }): Promise<{ status: string }>`——已连钱包 ≠ session 钱包时直接报错不发请求；intent → 反序列化 → 签名 → 序列化 → submit；返回 `submitting` 时由 composable 轮询 reconcile（每 5 秒、最多 2 分钟）
  - `TopUpPanel.vue`：显示可用余额、金额输入（缺省 10）、充值按钮、状态文字；`billing === 'off'` 时不渲染。仅结构，不定样式

- [ ] **Step 1: 写失败测试**：`formatUsd` 精确值；`performTopUp` 正常链路、钱包不一致拒绝、402 透传；me 返回 available 与 billing
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: 实现**
- [ ] **Step 4: Run `bun run test`、`bun run typecheck` — PASS；`bun run dev` 手查面板渲染**
- [ ] **Step 5: Commit** `feat: available balance and USDC top-up panel`
