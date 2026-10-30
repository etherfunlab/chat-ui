# chat-ui · 设计

可自部署的 web3 LLM 前端：Solana 钱包就是账户，USDC 充值、按量扣费，上游模型的 key 只在服务端。
打开就是聊天界面，没有 landing page。同一个部署同时是一个 OpenAI 兼容的 API，能接进其他终端。

公开仓 `etherfunlab/chat-ui`，MIT。我们自己的部署在 `chat.etherfun.xyz`。

## 意图

- **定位：agentic 办公**：给人干活用，不是闲聊。取舍偏向能力，不偏向速度：思考默认开，模型选能力强的；
  API 模式要能接 agent 类客户端，也就是长上下文、tool calling、prompt cache。
- **钱包即账户**：不要邮箱、不要注册，连上 Solana 钱包签一次名就进来了；余额和 API key 挂在钱包地址上。
- **对话不出用户的设备**：会话只存在浏览器里，服务端只转发、不保存。服务端只记账（谁、哪个模型、多少 token、扣多少钱），不记内容。
- **按上游实价计费，加价可配**：扣费基数就是上游对这次请求实收的钱。加价率全局可配，另有一份免加价钱包白名单。
  `chat.etherfun.xyz`：白名单内 +0%，一般用户 +10%。
- **可自部署**：别人 fork 后可以部署成两种形态：对外营业（跟我们一样收 USDC），或自用（钱包白名单，不计费）。

## 目标（v1）

1. Solana 钱包签名登录；账户主键 = 钱包公钥。
2. Solana mainnet USDC 充值，1 USDC = 1 USD 余额，金额由用户自填。
3. 每次请求按上游实收 ×（1 + 加价比例）扣费。
4. 网页聊天：
   - 8 个模型可切换（见「模型」）
   - 思考开关 + 思考强度
   - 联网搜索开关，显示引用来源
   - 显示思考过程
   - 图片上传（视觉模型）
   - 自定义系统提示词：全局默认 + 单个会话覆盖
5. 会话存浏览器 IndexedDB，可导出 / 导入 JSON。
6. API 模式：OpenAI 兼容的 `/v1/chat/completions`、`/v1/responses` 与 `/v1/models`，用网页上生成的 API key 鉴权，与网页共用余额。
7. 用量明细页：每次请求的模型、来源、token、扣费；充值记录。
8. 界面三语：English（默认）、简体中文、繁體中文。
9. 自部署两种形态，环境变量切换。

## 非目标（v1）

- 其他链、其他代币、其他上游供应商。上游调用收在一层薄适配里，但只实现 Venice。
- 跨设备同步会话。
- 余额提现、退款。
- 新用户赠送额度。
- landing page、营销页、SEO。
- 聊天以外的上游能力（生图、TTS、embedding 等）。
- 网页端的 tool calling。API 模式原样透传 `tools`，网页端不用。
- 手机系统浏览器里直接用钱包（Mobile Wallet Adapter、Phantom deep link 签名协议）。见「下一个 spec」。
- 合规：登录时同意条款、按地区封锁、充值钱包制裁筛查。见「下一个 spec」。
- Anthropic Messages API（`/v1/messages`）。见「下一个 spec」。

## 反目标

做出来能用，但出现下面任何一条就算失败：

- 服务端以任何形式留下对话内容，包括 prompt、回复、图片、思考过程。数据库、日志、错误上报都算。
- 上游 API key 以任何形式到达浏览器，或出现在任何响应、日志、错误信息里。
- 同一笔链上交易入账两次。
- 并发请求把余额透支成大额负数。
- 用户被多扣：实扣超过「上游实收 ×（1 + 加价比例）」。
- 界面上出现一个按了没反应的控件（比如对关不掉思考的模型显示一个可用的「关思考」开关）。

## 约束

### 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Nuxt 4（Nitro server routes 做 BFF）、Vue 3、Pinia |
| 样式 / 组件 | Tailwind CSS 4（`@tailwindcss/vite`）、reka-ui、lucide-vue-next、class-variance-authority、tailwind-merge |
| i18n | `@nuxtjs/i18n` |
| Solana | `@solana/web3.js`、`@solana/pay`、`solana-wallets-vue`、钱包 adapter（Phantom / Solflare / Coinbase）、`tweetnacl`、`bs58` |
| 浏览器存储 | Dexie（IndexedDB） |
| 流式 | `@microsoft/fetch-event-source`（客户端 SSE） |
| Markdown | markdown-it |
| 数据库 | Postgres。服务端用适合 serverless 的驱动 |
| 工具链 | bun、Node 24、vitest、Playwright、TypeScript |

### 部署（`chat.etherfun.xyz`）

- Vercel。函数区域 `sin1`、`sfo1`、`arn1`、`hkg1`、`lhr1`；函数 runtime `nodejs24.x`。
- 域名 `chat.etherfun.xyz`。
- 数据库：Neon Postgres，经 Vercel Marketplace 接入。
- USDC 收款地址：新开的专用地址，不与其他产品共用。
- Venice API key：chat-ui 专用的一把，只放 Vercel 环境变量。

### 视觉

视觉规范以本仓 `DESIGN.md` 为准，亮 / 暗双主题。`DESIGN.md` 尚未写成，界面的视觉层要等它定稿再做。
`DESIGN.md` 落地之前，后端、数据层、交互逻辑照常推进，组件只搭结构、不定样式。

## 账户与登录

1. 用户连接钱包。
2. 服务端发一个一次性 nonce。
3. 钱包 `signMessage` 签一段 Sign-In-With-Solana 格式的消息，内容含域名、nonce、签发时间。
4. 服务端用 ed25519 验签、核销 nonce，下发 httpOnly、签名过的 session cookie（`SESSION_SECRET`）。
5. 首次登录即建账户行，没有单独的注册步骤。

网页端的 `/api/*` 只认 session cookie，并校验同源；API key 只用于 `/v1/*`。

### 支持的入口

- 桌面浏览器 + 钱包扩展（Phantom / Solflare / Coinbase）。
- 钱包 App 的内置浏览器（Phantom、Solflare）。内置浏览器会注入钱包，走的是和桌面扩展同一套 adapter 代码。
  所以版面要能在手机宽度下用。
- 手机系统浏览器里检测不到钱包时，给「在 Phantom 中打开」「在 Solflare 中打开」两个按钮，用各自的 browse deep link
  跳进钱包 App 的内置浏览器打开当前页。
- 钱包内置浏览器和系统浏览器的 IndexedDB 互不相通。在内置浏览器里首次进入时提示一句：会话只存在这个浏览器里，
  换地方要用导出 / 导入。

## 充值

走 Solana Pay 的转账交易流程：

1. 用户输入金额（最低 1 USDC），服务端建充值单：收款地址、USDC mint、金额、唯一 reference key。
   服务端用这些构造一笔 USDC 转账交易交给前端。
2. 钱包签名，前端把签好的交易交回服务端。
3. 服务端广播、等 confirmed，再上链校验：收款地址、mint、金额、reference 都要对得上。
4. 校验通过后，在同一个数据库事务里把充值单置为完成、给余额加钱。交易签名设唯一约束，防重复入账。
5. 广播成功但确认超时的单子留在「提交中」，由对账接口（用户回到页面时触发）再查链上补入账。

用户余额不够付这笔转账（含手续费）时，返回明确的「钱包余额不足」，不报通用错误。

## 计费

- 余额用整数 micro-USD 存（1 USDC 的最小单位 = 1 micro-USD），不用浮点。
- 单价来源：Venice `GET /api/v1/models` 返回的 `model_spec.pricing`，服务端缓存、定期刷新。
  价格包括 input、output、cache_input、cache_write，以及超过 `context_token_threshold` 后的 `extended` 档。
- 一次请求的成本 = 上游实收 ×（1 + 适用加价率），向下取整：
  - 上游响应报告了实收（`cost.usd + cost.diem`，均为美元等值，已含联网费）时，用它；
  - 没报告时，按上游返回的 `usage` 和上面的单价算，再加联网搜索费。
- 加价率按钱包定：`MARKUP_EXEMPT_WALLETS` 名单里的钱包为 0，其余用 `PRICE_MARKUP`。
  `chat.etherfun.xyz`：`PRICE_MARKUP=0.10`，自家钱包进免加价名单。
- 联网搜索费（只用于上游没报告实收时）：开了搜索的请求按次加收 `SEARCH_FEE_USD`（默认 0.01）。
  `enable_web_search = on` 的请求算联网；`auto` 只在返回了引用时算。
- **防透支**：转发前先冻结一笔上限额度，按「输入估算 + `max_tokens` × 输出单价」算，余额不够就直接拒。
  结束后按实际 usage 结算，退回差额。冻结与结算都在数据库事务里做。
- **首字前只走一次数据库往返**：函数分布在 5 个区域，数据库只有一个区。转发前的鉴权（session 或 API key）
  和冻结要合成一次往返；结算放在流结束之后，不挡首字。
- 用户中途断开时，上游已经产生的 token 照算；不能靠中断白拿 token，也不能按冻结额度一刀切多扣。
- 每次请求写一条用量记录：时间、模型、来源（网页 / 哪把 API key）、各类 token 数、是否联网、扣费金额。不写内容。

## 模型

第一版 `chat.etherfun.xyz` 开放这 8 个，列表放配置里，自部署者可改。表中顺序就是模型选择器里的显示顺序，`/v1/models` 也按这个顺序返回：

| 显示名 | Venice model id |
|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` |
| DeepSeek V4.1 Flash 1017 Uncensored | `deepseek-v4-1-flash-1017-uncensored` |
| Grok 4.7 | `grok-4-7` |
| Gemini 4 Argon | `gemini-4-argon` |
| GPT-6 Astra Pro | `openai-gpt-6-astra-pro` |
| GPT-6.1 Sol | `openai-gpt-61-sol` |
| GPT-6.1 Sol Ultrafast | `openai-gpt-61-sol-ultrafast` |
| GPT-6.1 Terra | `openai-gpt-61-terra` |

显示名、上下文长度、能力都从 Venice `/models` 读，不写死。

### 思考开关与强度

每个模型能做什么，从 `model_spec.capabilities` 读：`supportsReasoning`、`supportsReasoningEffort`、
`reasoningEffortOptions`、`defaultReasoningEffort`。界面按模型分别给：

- 思考默认开。默认强度取 `defaultReasoningEffort`；万一它是 `none`，取最低的非 `none` 档。
- 强度选项是该模型的 `reasoningEffortOptions` 去掉 `none`。
- 「关」只在 `reasoningEffortOptions` 含 `none` 的模型上出现，选它就是发 `none`。其他模型界面上没有「关」这一项。
  Venice 若另有可靠的关思考参数，可以用它扩大可关的范围。
- 切到不能关思考的模型时，思考回到开。
- 不支持调强度的模型（如 Gemini 4 Argon）不显示强度控件。

### 联网搜索

用 Venice 的 `venice_parameters` 打开联网搜索和引用，参数名以 Venice 文档为准。
界面一个开关，回复里列出引用来源。

### 思考过程

上游流式返回的思考内容（`reasoning_content` 或模型自带的思考标签）放进一个可折叠的思考区块，边生成边显示。
上游只给摘要或什么都不给的模型，就显示上游给的那部分。

### 上游请求的固定设置

- 不注入 Venice 自带的系统提示词（`include_venice_system_prompt: false`）。模型行为只由用户的系统提示词决定。
- Venice key 只在服务端环境变量里，所有上游请求由服务端转发。

### 图片上传

- 只对 `supportsVision` 的模型开放；`supportsMultipleImages` 为 false 的模型一次只收一张，否则以 `maxImages` 为上限。
- 客户端上传前先缩放压缩。
- 图片以 data URL 随当次请求发给上游，服务端不落盘；本地以原样随会话存进 IndexedDB。

## 会话（只在浏览器）

- IndexedDB 存会话、消息、思考过程、引用、图片。只在发起请求时作为当次请求体离开浏览器。
- 会话按钱包地址分区：同一个浏览器换钱包，看到的是那个钱包的会话。
- 导出：选中的会话或全部，导出成一个 JSON，图片内嵌为 base64。
- 导入：按会话 id 合并，已存在的会话不覆盖，另存为副本。
- 系统提示词：全局默认值存本地；单个会话可以覆盖。

### 请求体上限

Vercel 函数单次请求体上限 4.5MB。会话只在浏览器，每一轮都要重发整段历史，所以会被累积的历史撞上，主要是历史里的图片。
发送前在客户端组装请求体，超限时按下面的顺序处理：

1. 从最早的轮次开始，把历史里的图片换成占位文字（如「[图片未发送]」），直到总量落回上限内。
   被去掉图片的消息在界面上标出来，用户知道模型这一轮没看到它。
2. 只剩文字仍超限时不发，提示用户新开会话，或先导出再精简。文字不做静默截断。

切到不支持看图的模型时，历史里的图片同样换成占位文字，并在界面上标出。
IndexedDB 里存的始终是原始消息，「实际发出去的形态」每次发送时现算，不另存。

## API 模式

- Base URL：`https://chat.etherfun.xyz/v1`（自部署则是各自域名下的 `/v1`）。
- 端点：
  - `POST /v1/chat/completions`（流式与非流式）。
  - `POST /v1/responses`（OpenAI Responses API，流式与非流式），转发到 Venice 的 `/responses`。
  - `GET /v1/models`（只列配置里的模型）。
- 鉴权：`Authorization: Bearer <key>`。key 在网页上登录后生成，只在生成时显示一次；服务端只存哈希。
  一个账户可以有多把 key，可命名、可吊销。
- 参数：
  - 标准 OpenAI 字段照收：`model`、`messages`、`stream`、`max_tokens`、`temperature`、`top_p`、`reasoning_effort`、`tools`、`tool_choice`、`response_format`。
  - `messages` 原样透传，内容块上的 `cache_control` 等标注不剥。agent 客户端靠 prompt cache 控成本，
    计费按上游返回的 cache 读写分别计。
  - `venice_parameters` 只放行联网搜索与引用相关字段，其余丢弃。
- 返回：OpenAI 兼容格式，思考内容放在 `reasoning_content`。

### Responses API

- 上游 Venice `/responses` 标着 Beta，schema 可能变。代理层只做鉴权、校验、计费，请求和响应尽量原样透传，
  少做字段改写，上游变了也少跟着改。
- 强制 `store: false`，拒绝 `previous_response_id` 和 `background`。上游不保存会话状态，客户端每轮自带完整 `input`。
  需要跨轮保留思考的客户端走 `include: ["reasoning.encrypted_content"]`，原样放行。
- 计费规则与 Chat Completions 相同，从 Responses 格式的 `usage` 里取输入、输出、cache token。
- 联网搜索在 Responses 下怎么开，按 Venice 文档；同样只放行联网搜索相关字段。
- 402、413 等错误码与 Chat Completions 一致。
- 余额不足返回 402，带机器可读的错误码。
- 请求体超过 4.5MB 返回 413，带机器可读的错误码；README 写明这个上限，上下文很长的 agent 类客户端会受限。
- `/v1/*` 对任意来源开放 CORS（凭 Bearer key）；网页端 `/api/*` 只允许同源。

## 用量明细页

- 请求列表：时间、模型、来源（网页 / key 名）、输入 / 输出 / 缓存 token、是否联网、扣费。不含内容。
- 充值列表：时间、金额、状态、交易签名（链到区块浏览器）。
- 页头显示当前余额。

## 自部署的两种形态

`BILLING=on|off`。

| | `on`（对外营业） | `off`（自用） |
|---|---|---|
| 谁能登录 | 任何钱包 | `ALLOWED_WALLETS` 白名单（逗号分隔） |
| 充值 | 有 | 没有充值入口 |
| 扣费 | 有，冻结 + 结算 | 不扣，不查余额 |
| 用量记录 | 有 | 有（用量页照常） |
| API key | 有 | 有 |

两种形态都需要：`DATABASE_URL`、`VENICE_API_KEY`、`SESSION_SECRET`。
`on` 另需：`SOLANA_RPC_URL`、`SOLANA_TREASURY`、`PRICE_MARKUP`；可选 `MARKUP_EXEMPT_WALLETS`（逗号分隔，免加价）、`SEARCH_FEE_USD`（默认 0.01）。

仓里提供 `.env.example` 和 README 部署说明（Vercel 为主）。

## 国际化

- English（默认）、简体中文、繁體中文。按浏览器语言选初始语言，用户可切换。
- URL 不带语言前缀（没有需要 SEO 的页面），语言选择存本地。

## 留给 builder

- 数据库 schema、迁移工具、Postgres 驱动。
- 冻结额度的具体算法，`max_tokens` 缺省时的上限。
- 单价缓存的刷新机制。
- 流中断时如何拿到实际 usage（继续读完上游，还是按已收到的 token 估算）。
- session cookie 的有效期与续期。
- 测试策略。
- 仓库初始化：LICENSE 版权人写 `EtherFun Lab`；README、`.env.example`、CI。

## 下一个 spec

- 完整移动端：Android 接 Mobile Wallet Adapter，iOS 接 Phantom deep link 签名协议，手机系统浏览器里直接登录、充值。
- 合规：首次登录同意服务条款与隐私声明、按地区封锁、充值钱包制裁筛查。
- Anthropic Messages API（`/v1/messages`）：Venice 没有这个接口，要在 Messages 与 Chat Completions 之间双向转换，
  包括思考、tool calling、cache 标注。

## 上线前要备的

- 确认 Venice 的条款允许这种转售。
- 新的 Solana USDC 收款地址。
- chat-ui 专用的 Venice API key。
- Neon 数据库（Vercel Marketplace）。
- Solana mainnet RPC URL。
- Vercel 项目、`chat.etherfun.xyz` 的 DNS。
- `DESIGN.md` 定稿。
