---
name: packyapi
description: 查询 PackyAPI(Claude/OpenAI/Gemini 中转平台)的模型价格、可用模型 ID、分组倍率与官方文档。当用户问 PackyAPI 的定价/模型/配置(base_url、auth token、环境变量、可用模型),或在为 packyapi 配置 Claude Agent SDK / Claude Code / Codex / Gemini CLI 时使用。始终走公开 JSON API,不抓 HTML,省 token 且精确。
---

# PackyAPI 快查

PackyAPI = AI API 聚合中转平台(`https://www.packyapi.ai`),Anthropic/OpenAI/Gemini 协议兼容。
本 skill 让你**走结构化 API 拿数据**,而非抓渲染后的 HTML 页面 —— 更省 token、更准。

## 铁律:优先 API,不抓 HTML

- 价格 / 模型 / 分组 / 端点路径 → 一律用 MCP 工具 `packy`,底层读公开 JSON `https://www.packyapi.ai/api/pricing`。
  连官方文档的分组页都滞后于 API,别去那儿查倍率。
- 仅当需要**文档正文**(教程步骤、FAQ)时,才 WebFetch,且只抓 `references/docs-map.md` 里定位到的**单个** URL。

## MCP 工具 `packy`

本 plugin 内置 MCP server(`packyapi`),暴露单工具 `packy`。直接调用,无需手动跑脚本:

| action | 参数 | 作用 |
|---|---|---|
| `price` | `keyword?` `group?` `base?` | 计价表($/1M tokens);给 `keyword` 自动列该模型全部可用分组,`group` 锁单组。已计入分组倍率覆盖与高峰浮动价 |
| `detail` | `model`(必填) `group?` `base?` | 单模型全量计价:各分组实价、缓存读/写、长上下文阶梯、高峰状态、端点路径、厂商 |
| `models` | `group?` `endpoint?` `vendor?` | 列可用模型 ID,可按端点或厂商过滤 |
| `groups` | — | 分组倍率与说明(实时,含 `[停用]` 标记) |
| `raw` | `model`(必填) | 单模型原始 JSON |
| `announcements` | `limit?` `keyword?` | 平台公告(上新/变更/通知),默认最近 5 条,按发布时间降序 |

`price` 输出里模型名后的标记:`†` 该组有专属倍率(已覆盖全局)、`*` 当前处于高峰浮动价、
`‡` 有长上下文阶梯价。表尾脚注给出具体数值。

示例调用参数:
- 查 claude 各组价:`{ "action": "price", "keyword": "claude" }`
- 锁 cc 组全表:`{ "action": "price", "group": "cc" }`
- 列 anthropic 端点模型:`{ "action": "models", "endpoint": "anthropic" }`
- 单模型原始:`{ "action": "raw", "model": "claude-opus-4-8" }`
- 看最近公告:`{ "action": "announcements", "limit": 5 }`
- 单模型全量计价:`{ "action": "detail", "model": "claude-opus-5" }`
- 列 Anthropic 厂商模型:`{ "action": "models", "vendor": "Anthropic" }`

Server 为 TypeScript,Node(v22.6+/24)原生 strip 直跑;依赖 `@modelcontextprotocol/sdk`(repo 根 node_modules)。

## 配置 Claude Agent SDK / Claude Code(走 PackyAPI)

```
ANTHROPIC_BASE_URL=https://cf.api.fan
ANTHROPIC_AUTH_TOKEN=<在「令牌管理」建的 token,选 cc 组>
```

官方文档 `docs/cli/2-claude.html` 写明中转站地址固定为 `https://cf.api.fan`,不带 `/v1`。
SDK/CLI 原生读这两个 env → 无需改代码。模型 ID 用 `packy` 工具
`{ "action": "models", "endpoint": "anthropic" }` 查最新。

`slb-v1.api.fan` 曾作为直连端点,当前官方文档已不再提及 —— 仅作备用,可用性自行验证。
主站域名 `www.packyapi.ai` 仅供网页访问,不要作为 base_url。

端点协议与路径(取自 `/api/pricing` 的 `supported_endpoint`):

| 协议 | 路径 |
|---|---|
| `anthropic` | `POST /v1/messages` |
| `openai` | `POST /v1/chat/completions` |
| `openai-response` | `POST /v1/responses` |
| `gemini` | `POST /v1beta/models/{model}:generateContent` |
| `image-generation` | `POST /v1/images/generations`(另有 `/v1/images/edits`) |

OpenAI 协议场景(Codex 等)base_url 末尾需带 `/v1`,即 `https://cf.api.fan/v1`。

## 参考

- `references/pricing-api.md` — `/api/pricing` 字段、计价公式、分组倍率。
- `references/docs-map.md` — 官方文档 sitemap:主题 → URL 映射(定位后单页 fetch)。
