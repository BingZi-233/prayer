---
name: packyapi
description: 查询 PackyAPI(Claude/OpenAI/Gemini 中转平台)的模型价格、可用模型 ID、分组倍率与官方文档。当用户问 PackyAPI 的定价/模型/配置(base_url、auth token、环境变量、可用模型),或在为 packyapi 配置 Claude Agent SDK / Claude Code / Codex / Gemini CLI 时使用。始终走公开 JSON API,不抓 HTML,省 token 且精确。
---

# PackyAPI 快查

PackyAPI = AI API 聚合中转平台(`https://www.packyapi.com`),Anthropic/OpenAI/Gemini 协议兼容。
本 skill 让你**走结构化 API 拿数据**,而非抓渲染后的 HTML 页面 —— 更省 token、更准。

## 铁律:优先 API,不抓 HTML

- 价格 / 模型 / 分组 → 一律用脚本读公开 JSON `https://www.packyapi.com/api/pricing`。
- 仅当需要**文档正文**(教程步骤、FAQ)时,才 WebFetch,且只抓 `references/docs-map.md` 里定位到的**单个** URL。

## 命令

- `/packy-price [关键词] [--group cc]` — 计价($/1M tokens);给关键词自动列该模型全部可用分组,`--group` 锁单组。
- `/packy-models [--endpoint anthropic] [--group cc]` — 列可用模型 ID。
- `/packy-docs <主题>` — 定位并读单个文档页。

底层脚本为 TypeScript,Node(v22.6+/24)原生 strip 直跑,零依赖。`${CLAUDE_PLUGIN_ROOT}` 为本 plugin 根:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/packy.ts" price [关键词] [--group cc] [--base 2]
node "${CLAUDE_PLUGIN_ROOT}/scripts/packy.ts" models [--endpoint anthropic] [--group cc]
node "${CLAUDE_PLUGIN_ROOT}/scripts/packy.ts" groups
node "${CLAUDE_PLUGIN_ROOT}/scripts/packy.ts" raw <model>
```

## 配置 Claude Agent SDK / Claude Code(走 PackyAPI)

```
ANTHROPIC_BASE_URL=https://www.packyapi.com
ANTHROPIC_AUTH_TOKEN=<在「令牌管理」建的 token,选 cc 组>
```

SDK/CLI 原生读这两个 env → 无需改代码。模型 ID 用 `/packy-models --endpoint anthropic` 查最新。
anthropic 端点路径:`/v1/messages`。

## 参考

- `references/pricing-api.md` — `/api/pricing` 字段、计价公式、分组倍率。
- `references/docs-map.md` — 官方文档 sitemap:主题 → URL 映射(定位后单页 fetch)。
