# chat-ui Plan 1/5 — 仓库骨架与钱包登录

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建起公开仓与 Nuxt 4 骨架，交付可部署的「连钱包 → SIWS 签名 → session 登录」闭环，含数据库迁移与 CI。

**Architecture:** Nuxt 4 单仓，Nitro server routes 做 BFF；Postgres 存账户与 nonce，`pg` 直连 + 纯 SQL 迁移；
session 用 h3 `useSession`（`SESSION_SECRET` 加密的 httpOnly cookie）。前端 solana-wallets-vue 接钱包，签名消息由服务端生成、服务端重建后验签。

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Tailwind CSS 4 / Pinia / solana-wallets-vue + wallet adapters (Phantom, Solflare, Coinbase) / tweetnacl / bs58 / pg / vitest / bun

**Spec:** `docs/superpowers/specs/2026-10-30-chat-ui-design.md`

**计划系列:** 1/5 本计划；2/5 计费核心与 USDC 充值；3/5 聊天界面与本地会话；4/5 API 模式（/v1）；5/5 用量页、i18n、部署文档。界面在 DESIGN.md 定稿前只搭结构、不定样式。

## Global Constraints

- bun 为包管理器（`packageManager: bun@1.3.14`），Node `>=24`，TypeScript strict。
- Vercel 函数 runtime `nodejs24.x`；`vercel.json` regions：`sin1`、`sfo1`、`arn1`、`hkg1`、`lhr1`。
- LICENSE：MIT，版权人 `EtherFun Lab`。
- Commit message：English，Conventional Commits。
- 服务端任何路径（日志、错误上报、DB）不得出现对话内容；本计划范围内即：不 log 请求体。
- 提交进仓的任何文件（代码、注释、文档、commit）不得出现内部私仓名、内部产品名、prod URL；参考实现一律不提。
- UI 文案第一版只写英文；界面只搭结构、不做视觉（DESIGN.md 未定稿）。
- 金额一律整数 micro-USD（bigint），不用浮点。
- 环境变量直接从 `process.env` 读（`server/utils/config.ts` 统一出口），不经 Nuxt runtimeConfig。

## Review Focus

1. 同一 nonce 第二次 verify 必须拒绝（重放）→ Task 4 `rejects a reused nonce`。
2. 签名人与所称钱包不一致必须 401 → Task 4 `rejects a signature from a different key`。
3. nonce 过期（>10 分钟）必须拒绝 → Task 4 `rejects an expired nonce`。
4. `BILLING=off` 且钱包不在白名单：403 且不建账户行 → Task 4 `whitelist gate blocks and creates no account`。
5. 跨域 Origin 打 `/api/auth/*` 必须 403 → Task 4 `rejects cross-origin verify`。

---

### Task 1: Nuxt 骨架、仓库文件、Vercel 配置

**Files:**
- Create: `package.json`、`nuxt.config.ts`、`tsconfig.json`、`vitest.config.ts`、`app/app.vue`、`app/pages/index.vue`、`app/assets/css/main.css`、`vercel.json`、`LICENSE`、`README.md`、`.gitignore`、`.env.example`、`CLAUDE.md`

**Interfaces:**
- Produces: 路径别名 `#server`（→ `server/`）、`#shared`（→ `shared/`）、`@@`（→ 仓根），vitest 与 Nuxt 两边一致；脚本 `bun run dev|build|test|typecheck`。

- [ ] **Step 1: `git init`（分支 `main`），写上面列出的仓库文件**

要点（其余照常规）：
- `package.json`：`"type": "module"`，`engines.node: ">=24"`，scripts `dev/build/test/typecheck`（`typecheck` 用 `nuxt typecheck`）；依赖见 Tech Stack，另加 devDeps `@tailwindcss/vite tailwindcss vitest happy-dom vue-tsc typescript @vue/test-utils`。
- `nuxt.config.ts`：`compatibilityDate` 设今天；tailwind 4 走 `@tailwindcss/vite` 插件 + `main.css` 里 `@import "tailwindcss"`；`nitro: { externals: { inline: ['jayson'] }, vercel: { functions: { runtime: 'nodejs24.x' } } }`（`@solana/web3.js` 的 `jayson` 目录 import 在 Node ESM 下会炸，必须内联）；alias `#shared` → `shared/`（`#server` 是 Nitro 内建）。
- `vitest.config.ts`：environment `node`，include `{app,server,shared,tests}/**/*.test.ts`，alias 与 Nuxt 对齐（`#server`、`#shared`、`@@`、`~` → `app/`）。
- `vercel.json`：`installCommand: "bun install --frozen-lockfile"`，regions 见 Global Constraints。
- `LICENSE`：MIT，`Copyright (c) 2026 EtherFun Lab`。
- `README.md`：一段定位（self-hostable web3 LLM interface）+ "Work in progress"；`.env.example` 全量变量并注释：`BILLING`（`on`|`off`，默认 `on`）、`DATABASE_URL`、`SESSION_SECRET`（≥32 字符）、`VENICE_API_KEY`、`ALLOWED_WALLETS`（`off` 必填，逗号分隔）、`SOLANA_RPC_URL`、`SOLANA_TREASURY`、`PRICE_MARKUP`（小数，如 `0.10`）、`MARKUP_EXEMPT_WALLETS`、`SEARCH_FEE_USD`（默认 `0.01`）。
- `CLAUDE.md`：两行——spec/plan 在 `docs/superpowers/`；公开仓纪律（不提内部仓名/产品名/prod URL）。
- `app/pages/index.vue`：占位一行文字，Task 5 重写。

- [ ] **Step 2: `bun install`，验证 `bun run typecheck` 通过、`bun run build` 成功**

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold Nuxt 4 app with Tailwind, vitest, Vercel config"
```

### Task 2: SIWS 纯函数（消息构造与验签）

**Files:**
- Create: `shared/siws.ts`
- Test: `shared/siws.test.ts`

**Interfaces:**
- Produces:
  - `buildSignInMessage(p: { domain: string; address: string; nonce: string; issuedAt: string }): string`
  - `verifySignInSignature(p: { message: string; signatureB58: string; address: string }): boolean`
  - `isValidSolanaAddress(address: string): boolean`（bs58 解码后恰 32 字节）

- [ ] **Step 1: Write the failing tests**

```ts
import nacl from 'tweetnacl'
import bs58 from 'bs58'
// a fresh nacl.sign.keyPair() per test

it('builds the frozen message format', () => {
  expect(buildSignInMessage({ domain: 'chat.example.com', address: 'Addr', nonce: 'N', issuedAt: 'T' }))
    .toBe('chat.example.com wants you to sign in with your Solana account:\nAddr\n\nNonce: N\nIssued At: T')
})
it('accepts a signature from the address keypair', /* sign msg bytes with secretKey → true */)
it('rejects a signature from another keypair', /* → false */)
it('rejects a tampered message', /* sign A, verify B → false */)
it('validates solana addresses', /* base58 of 32 bytes → true; 'abc', base58 of 31 bytes → false */)
```

- [ ] **Step 2: Run `bun run test shared/siws.test.ts` — FAIL (module not found)**

- [ ] **Step 3: Implement `shared/siws.ts`**

验签：`nacl.sign.detached.verify(utf8(message), bs58.decode(signatureB58), bs58.decode(address))`，解码异常一律返回 false。

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** `feat: SIWS message build and ed25519 verification`

### Task 3: 服务端基座——env 配置、pg 连接、SQL 迁移

**Files:**
- Create: `server/utils/config.ts`、`server/utils/db.ts`、`server/db/migrations/0001_accounts_auth.sql`、`scripts/migrate.ts`
- Test: `server/utils/config.test.ts`、`scripts/migrate.test.ts`

**Interfaces:**
- Produces:
  - `getServerConfig(): ServerConfig`，其中 `ServerConfig = { billing: 'on' | 'off'; databaseUrl: string; sessionSecret: string; veniceApiKey: string; allowedWallets: Set<string>; markupBps: number; markupExemptWallets: Set<string>; searchFeeMicro: number; solanaRpcUrl: string; solanaTreasury: string }`（每次调用现读 `process.env`；`PRICE_MARKUP` 小数 → 万分比整数，`SEARCH_FEE_USD` → micro-USD 整数）
  - `getPool(): pg.Pool`（模块级单例，`DATABASE_URL`）、`withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T>`（BEGIN/COMMIT/ROLLBACK）
  - 迁移表 `schema_migrations(name text primary key, applied_at timestamptz)`；`runMigrations(client, files: { name: string; sql: string }[]): Promise<string[]>`（返回本次应用的文件名）
  - 表 `accounts(wallet text primary key, balance_micro bigint not null default 0, created_at timestamptz not null default now())`
  - 表 `auth_nonces(nonce text primary key, wallet text not null, issued_at timestamptz not null default now(), expires_at timestamptz not null, used_at timestamptz)`

- [ ] **Step 1: Write failing tests**

`config.test.ts`（用 `vi.stubEnv`）：
```ts
it('parses markup decimal to bps', /* PRICE_MARKUP=0.10 → markupBps 1000 */)
it('defaults: billing on, markup 0, search fee 10000 micro', ...)
it('splits wallet lists and trims', /* 'A, B' → Set{'A','B'} */)
it('throws when BILLING=off and ALLOWED_WALLETS empty', ...)
```
`migrate.test.ts`（fake client 记录 `query(sql, params)` 调用）：
```ts
it('applies pending files in name order and records them', ...)
it('skips files already in schema_migrations', ...)
it('rolls back when a migration throws', /* expect ROLLBACK, error rethrown */)
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement config.ts、db.ts、runMigrations（`scripts/migrate.ts` 导出 `runMigrations`，`import.meta.main` 时连 `DATABASE_URL` 跑 `server/db/migrations/*.sql`）、0001 SQL**

- [ ] **Step 4: Run `bun run test` — PASS**

- [ ] **Step 5: Commit** `feat: server config, pg pool, SQL migration runner with initial schema`

### Task 4: 认证端点（nonce / verify / logout / me）

**Files:**
- Create: `server/utils/session.ts`、`server/utils/sameOrigin.ts`、`server/api/auth/nonce.post.ts`、`server/api/auth/verify.post.ts`、`server/api/auth/logout.post.ts`、`server/api/me.get.ts`
- Test: 同名 `.test.ts` ×4（句柄测试，stub h3 globals：`defineEventHandler`/`readBody`/`createError`，mock `#server/utils/db`）

**Interfaces:**
- Consumes: Task 2 的 `buildSignInMessage`/`verifySignInSignature`/`isValidSolanaAddress`；Task 3 的 `getServerConfig`/`getPool`。
- Produces:
  - `useAppSession(event)`：h3 `useSession<{ wallet?: string }>`，name `cu_session`，password = `sessionSecret`，cookie httpOnly/secure/sameSite `lax`，maxAge 30 天
  - `getSessionWallet(event): Promise<string | null>`、`requireWallet(event): Promise<string>`（无则 throw 401）
  - `assertSameOrigin(event)`：Origin（缺则 Referer）的 origin 必须等于请求 origin（`getRequestURL` 开 xForwardedHost/Proto），否则 403
  - `POST /api/auth/nonce` body `{ wallet }` → `{ message, nonce }`：校验地址→生成 32 字节随机数 bs58 作 nonce→插 `auth_nonces`（expires 10 分钟）→用请求 host 作 domain 构造消息
  - `POST /api/auth/verify` body `{ wallet, nonce, signature }` → `{ wallet }`：原子核销 `UPDATE auth_nonces SET used_at=now() WHERE nonce=$1 AND wallet=$2 AND used_at IS NULL AND expires_at>now() RETURNING issued_at`，无行→401；重建消息验签，失败→401；`billing==='off'` 且不在 `allowedWallets`→403（在核销后、建账户前判）；`INSERT INTO accounts ... ON CONFLICT DO NOTHING`；写 session
  - `POST /api/auth/logout` → 清 session；`GET /api/me` → `{ wallet, balanceMicro: string }` 或 401

- [ ] **Step 1: Write failing tests**（每端点一文件；verify 的用例至少：happy path 建账户并写 session、`rejects a reused nonce`、`rejects an expired nonce`、`rejects a signature from a different key`、`whitelist gate blocks and creates no account`（403 且无 INSERT accounts）、`rejects cross-origin verify`（assertSameOrigin throw 透传 403）；nonce 的用例：非法地址 400、正常返回的 message 与 `buildSignInMessage` 一致；me：无 session 401。签名用例用真 `tweetnacl` keypair 签真消息，不 mock siws。）

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement 六个文件；nonce/verify/logout 开头都过 `assertSameOrigin`**
- [ ] **Step 4: Run `bun run test` — PASS**
- [ ] **Step 5: Commit** `feat: wallet sign-in endpoints with nonce replay protection and session`

### Task 5: 前端——连钱包、签名登录、入口页

**Files:**
- Create: `app/plugins/solana-wallets.client.ts`、`app/composables/useWalletAuth.ts`、`app/components/auth/SignInPanel.vue`，重写 `app/pages/index.vue`
- Test: `app/composables/useWalletAuth.test.ts`

**Interfaces:**
- Consumes: Task 4 的三个 auth 端点与 `/api/me`。
- Produces:
  - plugin：`initWallet({ wallets: [PhantomWalletAdapter, SolflareWalletAdapter, CoinbaseWalletAdapter], autoConnect: true })`（solana-wallets-vue；只在 client）
  - `performSignIn(deps: { publicKeyB58: string; signMessage: (b: Uint8Array) => Promise<Uint8Array>; fetcher: typeof $fetch }): Promise<{ wallet: string }>`——纯流程函数：nonce → utf8 签名 → bs58 → verify；composable `useWalletAuth()` 包其上，暴露 `me`（`useState`）、`signIn()`、`signOut()`、`refreshMe()`
  - `SignInPanel.vue` 三态：未检测到钱包（Phantom/Solflare 安装链接 + `https://phantom.app/ul/browse/<url>?ref=<origin>`、`https://solflare.com/ul/v1/browse/<url>?ref=<origin>` 的「Open in …」链接，移动端入口）；已连未登录（Sign in 按钮）；已登录（截断地址 + Sign out）。首次在钱包内置浏览器打开时提示一行：会话只存本浏览器，换环境用导出/导入（文案英文，判断 UA 含 Phantom/Solflare 即可）
  - `index.vue`：未登录渲染 `SignInPanel`，已登录渲染占位（Plan 3 换成聊天界面）

- [ ] **Step 1: Write failing test——`performSignIn` 按序调 nonce→signMessage(utf8(message))→verify 并带 bs58 签名；verify 400/401 时把错误抛出**
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement 四个文件**
- [ ] **Step 4: Run `bun run test` 与 `bun run typecheck` — PASS；`bun run dev` 手查三态渲染**
- [ ] **Step 5: Commit** `feat: wallet connect and sign-in flow with mobile wallet-browser entry`

### Task 6: CI 与 GitHub 公开仓

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 全部前序任务的测试与 typecheck。

- [ ] **Step 1: 写 `ci.yml`：push/PR 触发；`oven-sh/setup-bun` + `bun install --frozen-lockfile` + `bun run test` + `bun run typecheck`**
- [ ] **Step 2: Commit** `ci: bun test and typecheck on push`
- [ ] **Step 3: 建仓并推送：`gh repo create etherfunlab/chat-ui --public --source . --push`（描述：Self-hostable web3 LLM interface — Solana wallet login, USDC billing, bring-your-own upstream）**
- [ ] **Step 4: 验证 `gh run watch` CI 绿、仓库页 LICENSE 识别为 MIT**
