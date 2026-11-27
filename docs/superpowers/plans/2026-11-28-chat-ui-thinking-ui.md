# chat-ui 思考过程 UI 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 思考过程改用 `etherfunlab/vue-llm-ui` 的部件：思考时是固定三行的小窗，回答一开始就收成「已思考 N 秒」胶囊。

**Architecture:** `vue-llm-ui` 以 git submodule 放在 `vendor/vue-llm-ui/`，钉在 `v0.1.0`，按源码引用：Nuxt 与 vitest 各配一个别名，Tailwind 只扫它的 `.vue` 文件。`AssistantMessage` 用它的 `ThinkingBlock` 取代本仓的 `ThinkingBlock`。`chatSender` 改一处计时，并在消息上记下这次请求是否开了思考。token 的值不动，仍以 `app/assets/css/main.css` 为准。

**Tech Stack:** Nuxt 4、Vue 3.5、Tailwind CSS 4、vitest + `@vue/test-utils` + happy-dom、vue-tsc、bun。

**Spec:** `docs/superpowers/specs/2026-10-30-chat-ui-design.md`「思考过程」一节，与 `DESIGN.md` §5（本 plan 的 Task 3 改写它）。这次改动的规格在下面的 Global Constraints 与各 task 里写全。

**分支：** `thinking-ui`，从 `main` 开。

## Global Constraints

- submodule 路径 `vendor/vue-llm-ui`，地址 `https://github.com/etherfunlab/vue-llm-ui.git`，钉在 tag `v0.1.0`（commit `17fdc2117f212d2bb69a0475d5edab8592af74fe`）。不改 submodule 里的任何文件。
- 导入名固定为 `@etherfunlab/vue-llm-ui`，在 Nuxt、vitest、vue-tsc 三处都解析到 `vendor/vue-llm-ui/src/index.ts`。
- token 值不动：`app/assets/css/main.css` 已有库要的六个 token（`--color-inset`、`--color-line`、`--color-ink`、`--color-ink-muted`、`--color-waiting`、`--font-native`）。不引库的默认主题。
- 组件只引用 token，不写字面量颜色，不写 `dark:` 变体（`DESIGN.md` §2）。
- 界面文案走 i18n，本 plan 只写 `en`。
- 测试不对观感值（颜色、尺寸、间距、类名）下断言。
- 公开仓：代码、注释、文档、commit、PR 里不出现内部仓库名、内部产品名、生产环境 URL（`chat.etherfun.xyz` 除外）。
- commit message：英文 Conventional Commits。一次只开一个 PR。
- 真实上游调用按次计费：本 plan 里只有 Task 4 的一次人工验证会调用，不做自动多轮。

## Review Focus

1. IndexedDB 里的旧消息、导入的 JSON 没有 `thinkingRequested` 字段：按 `false` 处理，不报错；已完成且有思考的旧消息照常显示胶囊。（Task 2、Task 3）
2. 思考途中按停止（`aborted`，没有正文）：小窗消失，留下带时长的胶囊。（Task 3）
3. 思考途中出错（`error`，没有正文）：小窗消失，留下胶囊和错误行。（Task 3）
4. 关了思考的请求仍然流回思考文字：从第一段思考文字起由小窗接手，等待提示消失。（Task 3）
5. 开了思考但模型一个字的思考也没给，直接出正文：小窗消失，没有胶囊，回答上方不留空隙。（Task 3）

## File Structure

```
.gitmodules                                   新建：submodule 记录
vendor/vue-llm-ui/                            新建：submodule（只读）
nuxt.config.ts                                改：alias
vitest.config.ts                              改：alias
app/assets/css/main.css                       改：两行 @source
.github/workflows/ci.yml                      改：checkout 拉 submodule
README.md                                     改：开发步骤
app/lib/vendor.test.ts                        新建：别名与部件可用的冒烟测试
app/lib/store.ts                              改：StoredMessage.thinkingRequested 与读入时的规整
app/lib/chatSender.ts                         改：计时与 thinkingRequested
app/components/chat/AssistantMessage.vue      改：用库的 ThinkingBlock
app/components/chat/AssistantMessage.test.ts  新建
app/components/chat/ThinkingBlock.vue         删
app/components/chat/ThinkingBlock.test.ts     删
i18n/locales/en.ts                            改：三条文案
DESIGN.md                                     改：§2 一句、§5 一条
```

---

### Task 1: 引入 submodule 并接线

**Files:**
- Create: `.gitmodules`、`vendor/vue-llm-ui/`（submodule）、`app/lib/vendor.test.ts`
- Modify: `nuxt.config.ts`、`vitest.config.ts`、`app/assets/css/main.css`、`.github/workflows/ci.yml`、`README.md`

**Interfaces:**
- Produces: 导入名 `@etherfunlab/vue-llm-ui`，导出 `ThinkingBlock`、`ThinkingWindow`、`ThinkingPill`、`Spinner` 与类型 `ThinkingLabels`。
  - `ThinkingBlock` 的 props：`{ text: string; active: boolean; ms: number | null; labels: ThinkingLabels }`
  - `ThinkingLabels`：`{ thinking: string; elapsed: (seconds: number) => string; done: (seconds: number) => string }`
  - DOM 钩子：小窗 `[data-part="window"]`、小窗正文 `[data-part="window-text"]`、读秒 `[data-part="elapsed"]`、胶囊按钮 `[data-part="pill"]`、展开的正文 `[data-part="pill-text"]`；读屏状态区 `[role="status"]`。

- [ ] **Step 1: 加 submodule 并钉版本**

```bash
git submodule add https://github.com/etherfunlab/vue-llm-ui.git vendor/vue-llm-ui
git -C vendor/vue-llm-ui checkout v0.1.0
git -C vendor/vue-llm-ui rev-parse HEAD
```
Expected: 最后一行是 `17fdc2117f212d2bb69a0475d5edab8592af74fe`。

- [ ] **Step 2: 写失败的测试 `app/lib/vendor.test.ts`**

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { ThinkingBlock, type ThinkingLabels } from '@etherfunlab/vue-llm-ui'

const labels: ThinkingLabels = { thinking: 'Thinking', elapsed: n => `${n}s`, done: n => `Thought for ${n}s` }

describe('vendored thinking components', () => {
  it('resolve through the package name and render', () => {
    const w = mount(ThinkingBlock, { props: { text: 'hm', active: false, ms: 4200, labels } })
    expect(w.get('[data-part="pill"]').text()).toBe('Thought for 4s')
  })
})
```

- [ ] **Step 3: `bun run test app/lib/vendor.test.ts` — FAIL（解析不到 `@etherfunlab/vue-llm-ui`）**

- [ ] **Step 4: 配别名**
  - `vitest.config.ts` 的 `resolve.alias` 加 `'@etherfunlab/vue-llm-ui'` → `./vendor/vue-llm-ui/src/index.ts`（写法同现有几项）。
  - `nuxt.config.ts` 加顶层 `alias`，同一个键，值用 `fileURLToPath(new URL('./vendor/vue-llm-ui/src/index.ts', import.meta.url))`。

- [ ] **Step 5: `bun run test app/lib/vendor.test.ts` — PASS**

- [ ] **Step 6: Tailwind 只扫库的 `.vue`**

`app/assets/css/main.css` 在 `@import "tailwindcss";` 之后加两行（路径相对这个文件）：

```css
@source not "../../../vendor/vue-llm-ui";
@source "../../../vendor/vue-llm-ui/src/**/*.vue";
```
注释写明原因：submodule 里的测试、文档与演示页提到了部件并不使用的类名。

- [ ] **Step 7: CI 与 README**
  - `.github/workflows/ci.yml`：`actions/checkout@v4` 加 `with: submodules: true`。
  - `README.md` 的 Development：克隆时带 `--recurse-submodules`，已克隆的跑 `git submodule update --init`；放在 `bun install` 之前。

- [ ] **Step 8: 类型检查与生产构建**

Run: `bun run typecheck`
Expected: 无错。

Run: `bun run build && cat .output/public/_nuxt/*.css | grep -c "3.9375rem"; cat .output/public/_nuxt/*.css | grep -c "bg-red-500"`
Expected: 构建成功；第一个数 ≥ 1（部件的样式进了产物），第二个数是 0（submodule 里别的文件提到的类没进产物）。此时还没有页面用到部件，第一个数若为 0，改在 Task 3 Step 6 再核，并在这里记一笔。

- [ ] **Step 9: Commit** — `build: vendor vue-llm-ui as a submodule and wire it into Nuxt, vitest and Tailwind`

---

### Task 2: 计时提前，并记下是否开了思考

**Files:**
- Modify: `app/lib/store.ts`、`app/lib/chatSender.ts`
- Test: `app/lib/chatSender.test.ts`、`app/lib/store.test.ts`

**Interfaces:**
- Produces:
  - `StoredMessage.thinkingRequested: boolean` — 这次请求是否要求模型思考。用户消息恒为 `false`。
  - `StoredMessage.reasoningMs` 的新时机：回答正文的第一段到达、且此前已有思考文字时就写入；整条流在出正文前结束的，仍在结束时写入。数值的算法不变（从请求发出起算）。

- [ ] **Step 1: 写失败的测试**

`app/lib/chatSender.test.ts`（沿用文件里的 `sender`、`session`、`OPUS`；`now` 每次调用加 100）：

```ts
it('stamps the thinking duration when the answer text starts, not when the stream ends', async () => {
  const seen: Array<{ text: string, ms: number | null }> = []
  const { s } = sender(async ({ onDelta }) => {
    onDelta({ text: '', reasoning: 'hm' })
    onDelta({ text: 'Hi', reasoning: '' })
    onDelta({ text: ' there', reasoning: '' })
  })
  const answer = await s.send({ ...baseInput(), onUpdate: m => seen.push({ text: m.text, ms: m.reasoningMs }) })
  const first = seen.find(u => u.text === 'Hi')!
  expect(first.ms).toBeGreaterThan(0)
  expect(seen.filter(u => u.text === '').every(u => u.ms === null)).toBe(true)
  expect(answer.reasoningMs).toBe(first.ms)
})

it('stamps the duration at the end when the stream stops before any answer text', async () => {
  const { s } = sender(async ({ onDelta }) => { onDelta({ text: '', reasoning: 'hm' }) })
  const answer = await s.send(baseInput())
  expect(answer.text).toBe('')
  expect(answer.reasoningMs).toBeGreaterThan(0)
})

it('leaves the duration empty when the model sent no thinking', async () => {
  const { s } = sender(async ({ onDelta }) => { onDelta({ text: 'Hi', reasoning: '' }) })
  expect((await s.send(baseInput())).reasoningMs).toBeNull()
})

it('records whether the request asked the model to think', async () => {
  const stream = async () => {}
  expect((await sender(stream).s.send(baseInput())).thinkingRequested).toBe(true)
  const off = session({ thinking: { enabled: false, effort: null } })
  expect((await sender(stream).s.send({ ...baseInput(), session: off })).thinkingRequested).toBe(OPUS.reasoning.canDisable ? false : true)
})
```
`baseInput()` 指文件里现有用例调用 `s.send` 时传的那组参数；若现有用例是逐个内联写的，先抽一个同名的局部函数再用。第四个用例另加一条：用一个 `reasoning.supported` 为 `false` 的模型（从 fixture 里取；没有就把 `OPUS` 浅拷贝后改这一项）发送，`thinkingRequested` 是 `false`。

`app/lib/store.test.ts`：给消息规整（导入路径）加用例：输入缺 `thinkingRequested` → `false`；输入为 `true` → `true`；输入为非布尔值（如 `'yes'`）→ `false`。

- [ ] **Step 2: `bun run test app/lib` — FAIL（新用例失败，旧用例照过）**

- [ ] **Step 3: 实现**
  - `store.ts`：`StoredMessage` 加 `thinkingRequested: boolean`，带一行注释；读入规整处加 `thinkingRequested: v.thinkingRequested === true`。仓内所有构造 `StoredMessage` 的地方补上这个字段（用户消息与错误占位消息为 `false`）。
  - `chatSender.ts`：
    - 建 `answer` 时 `thinkingRequested: thinkingFor(i.model, i.session.thinking).enabled`（`thinkingFor` 来自 `./thinking`）。
    - `onDelta` 里，第一段正文到达且 `answer.reasoning` 非空时，除了记 `reasoningEnded`，同时写 `answer.reasoningMs = reasoningEnded - started`，这样紧随其后的 `i.onUpdate` 就带上它。
    - 流结束后的那一行保持为兜底：`reasoningMs` 仍是 `null` 且有思考文字时才写。

- [ ] **Step 4: `bun run test` — 全过；`bun run typecheck` — 无错**

- [ ] **Step 5: Commit** — `feat: stamp thinking time when the answer starts and record whether thinking was requested`

---

### Task 3: AssistantMessage 改用库的部件

**Files:**
- Modify: `app/components/chat/AssistantMessage.vue`、`i18n/locales/en.ts`、`DESIGN.md`
- Delete: `app/components/chat/ThinkingBlock.vue`、`app/components/chat/ThinkingBlock.test.ts`
- Test: `app/components/chat/AssistantMessage.test.ts`

**Interfaces:**
- Consumes: `ThinkingBlock`、`ThinkingLabels`（Task 1）；`StoredMessage.thinkingRequested`、`reasoningMs` 的新时机（Task 2）。
- Produces: 文案键 `chat.thinking` = `Thinking`、`chat.thinkingElapsed` = `{n}s`、`chat.thoughtFor` = `Thought for {n}s`；`chat.waiting` 不变。

显示规则（`live` = `status === 'streaming'` 且 `text` 为空）：

| 条件 | 显示 |
|---|---|
| `live` 且（`thinkingRequested` 或 `reasoning` 非空） | 小窗，不显示等待提示 |
| `live` 且两者皆否 | 等待提示（`chat.waiting`），不显示小窗 |
| 不 `live`，`reasoning` 非空且 `reasoningMs` 不为 `null` | 胶囊 |
| 其余 | 都不显示 |

- [ ] **Step 1: 写失败的测试 `app/components/chat/AssistantMessage.test.ts`**

文件头用 `// @vitest-environment happy-dom`，`useI18n` 的桩照 `ThinkingMenu.test.ts` 的写法（`t(key, params)` 返回 `key` 或 `key:JSON(params)`），`message(over)` 造一条默认 `status: 'done'`、其余为空的助手消息。

```ts
const has = (w: VueWrapper, sel: string) => w.find(sel).exists()
const WINDOW = '[data-part="window"]'
const PILL = '[data-part="pill"]'

it('shows the window from the moment a thinking request is sent, and no waiting line', () => {
  const w = mount(AssistantMessage, { props: { message: message({ status: 'streaming', thinkingRequested: true }) } })
  expect(has(w, WINDOW)).toBe(true)
  expect(w.text()).toContain('chat.thinking')
  expect(w.text()).not.toContain('chat.waiting')
})

it('shows the waiting line, and no window, when thinking was not requested', () => {
  const w = mount(AssistantMessage, { props: { message: message({ status: 'streaming', thinkingRequested: false }) } })
  expect(has(w, WINDOW)).toBe(false)
  expect(w.text()).toContain('chat.waiting')
})

it('hands over to the window when thinking text arrives on a request that did not ask for it', () => {
  const w = mount(AssistantMessage, { props: { message: message({ status: 'streaming', thinkingRequested: false, reasoning: 'hm' }) } })
  expect(w.get('[data-part="window-text"]').text()).toBe('hm')
  expect(w.text()).not.toContain('chat.waiting')
})

it('turns the window into the pill as soon as answer text arrives', async () => {
  const w = mount(AssistantMessage, { props: { message: message({ status: 'streaming', thinkingRequested: true, reasoning: 'hm' }) } })
  await w.setProps({ message: message({ status: 'streaming', thinkingRequested: true, reasoning: 'hm', reasoningMs: 4200, text: 'Hi' }) })
  expect(has(w, WINDOW)).toBe(false)
  expect(w.get(PILL).text()).toBe('chat.thoughtFor:{"n":4}')
  expect(w.text()).toContain('Hi')
})

it('shows neither window nor pill when the model answered without thinking', async () => {
  const w = mount(AssistantMessage, { props: { message: message({ status: 'streaming', thinkingRequested: true }) } })
  await w.setProps({ message: message({ status: 'streaming', thinkingRequested: true, text: 'Hi' }) })
  expect(has(w, WINDOW)).toBe(false)
  expect(has(w, PILL)).toBe(false)
})

it.each(['aborted', 'error'] as const)('leaves the pill when thinking ends %s before any answer text', (status) => {
  const w = mount(AssistantMessage, { props: { message: message({ status, thinkingRequested: true, reasoning: 'hm', reasoningMs: 2000, error: status === 'error' ? 'boom' : null }) } })
  expect(has(w, WINDOW)).toBe(false)
  expect(has(w, PILL)).toBe(true)
  if (status === 'error') expect(w.text()).toContain('boom')
})

it('shows the pill on an old message that has no thinkingRequested field', () => {
  const old = message({ reasoning: 'hm', reasoningMs: 9000, text: 'Hi' }) as Record<string, unknown>
  delete old.thinkingRequested
  const w = mount(AssistantMessage, { props: { message: old as never } })
  expect(w.get(PILL).text()).toBe('chat.thoughtFor:{"n":9}')
})

it('opens the full thinking text from the pill', async () => {
  const w = mount(AssistantMessage, { props: { message: message({ reasoning: 'She keeps a lighthouse.', reasoningMs: 4200, text: 'Hi' }) } })
  await w.get(PILL).trigger('click')
  expect(w.get('[data-part="pill-text"]').text()).toBe('She keeps a lighthouse.')
})
```

- [ ] **Step 2: `bun run test app/components/chat/AssistantMessage.test.ts` — FAIL**

- [ ] **Step 3: 实现**
  - `AssistantMessage.vue`：从 `@etherfunlab/vue-llm-ui` 导入 `ThinkingBlock` 与 `ThinkingLabels`；按上面的规则算 `active` 与 `waiting`；`labels` 是一个 `computed`：`thinking: t('chat.thinking')`、`elapsed: n => t('chat.thinkingElapsed', { n })`、`done: n => t('chat.thoughtFor', { n })`。
  - `<ThinkingBlock>` 仅在 `active` 或 `reasoning` 非空时渲染，传 `:text="message.reasoning" :active="active" :ms="message.reasoningMs" :labels="labels"`；它没有包裹元素，直接作为现有 `grid gap-3` 的子节点。
  - 删掉对本仓 `ThinkingBlock.vue` 的引用，删掉该文件及其测试。
  - `i18n/locales/en.ts`：三条文案按 Interfaces。

- [ ] **Step 4: `bun run test` — 全过；`bun run typecheck` — 无错**

- [ ] **Step 5: 改 `DESIGN.md`**
  - §5「思考过程」一条整条换成：

    > **思考过程**：思考时是一个固定三行的小窗（`inset` 底、发丝线框、圆角 1rem，最宽 26.25rem）：头行是转圈、「正在思考」和读秒（12px），正文 14px 次字色，贴底、顶部渐隐。回答正文一开始，小窗收成一枚全圆胶囊「已思考 N 秒」（高 1.75rem，12px），点开在原地展开全文。没开思考的请求不出小窗，显示一行等待提示。
  - §2 表格之前补一句：思考过程的部件来自 `vendor/vue-llm-ui`，它只用本表里的 `inset`、`line`、`ink`、`ink-muted`、`waiting` 与字体 `font-native`，值仍以 `main.css` 为准。

- [ ] **Step 6: 生产构建并核对样式**

Run: `bun run build && cat .output/public/_nuxt/*.css | grep -c "3.9375rem"; cat .output/public/_nuxt/*.css | grep -c "bg-red-500"`
Expected: 构建成功；第一个数 ≥ 1，第二个数是 0。

- [ ] **Step 7: Commit** — `feat: thinking shows as a live window, then a pill, from the shared components`

---

### Task 4: 本地跑通（要用户在场）

**这一个 task 的最后一步由用户亲手做：** 上游 key 与钱包地址由用户填，登录要在浏览器里用钱包签名。

- [ ] **Step 1: 备数据库**：用本机已在运行的 Postgres。建库 `chatui`（已存在则跳过）。
- [ ] **Step 2: 备 `.env`**：从 `.env.example` 复制，填不含密钥的各项：`DATABASE_URL` 指向本机的 `chatui`、`SESSION_SECRET` 用 `openssl rand -base64 48` 生成、`BILLING=off`。`VENICE_API_KEY` 与 `ALLOWED_WALLETS` 留空，交给用户填。`.env` 不提交。
- [ ] **Step 3: `bun run migrate`** — 迁移全部应用。
- [ ] **Step 4: 交给用户**：请用户在 `.env` 填 `VENICE_API_KEY` 与 `ALLOWED_WALLETS`，跑 `bun run dev`，用钱包登录，选一个会思考的模型发一条消息。要看到的：
  1. 一发送就出现思考小窗，带转圈和读秒；
  2. 思考文字在小窗里从底部进、顶部淡出；
  3. 回答的第一个字一出来，小窗就变成「Thought for N s」胶囊，回答不被顶动；
  4. 点胶囊在原地展开全文；
  5. 把思考关掉（能关的模型）再发一条：没有小窗，只有一行等待提示；
  6. 日夜两档各看一眼。
- [ ] **Step 5: 用户说通过后**，在 PR 描述里写一行「本地用真实上游验证通过」。有出入就停下，按用户说的改，改完再请用户看。

---

### Task 5: 跨引擎审查与 PR

- [ ] **Step 1: 用 `codex-review` skill 审 `git diff origin/main...HEAD`**（只内联 `*.ts`、`*.vue`、`*.css`、`*.yml` 与 `DESIGN.md`）。prompt 里写明：栈、Global Constraints 逐条作为编号不变量、Task 3 的显示规则表、Review Focus 五条、只报缺陷。
- [ ] **Step 2: 逐条处理**：成立的每项先写失败的测试再修；不修的记为裁定，交付时告诉用户。
- [ ] **Step 3: `bun run test && bun run typecheck && bun run build` — 全过；Commit** — `fix: address cross-engine review of the thinking UI`
- [ ] **Step 4: push 分支并开 PR**（标题 `feat: thinking UI from the shared components`），等 CI 变绿。合并由用户决定。
