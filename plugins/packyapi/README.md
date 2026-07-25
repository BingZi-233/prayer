# packyapi 插件

快速查询 [PackyAPI](https://www.packyapi.ai) 模型价格、可用模型 ID、分组倍率与官方文档。
全走公开 JSON API(`/api/pricing`),不抓 HTML —— 省 token、更精确。

## MCP 工具 `packy`

本插件内置 stdio MCP server(名 `packyapi`),暴露单工具 `packy(action, ...)`:

| action | 参数 | 作用 |
|---|---|---|
| `price` | `keyword?` `group?` `base?` | 计价($/1M tokens) |
| `models` | `endpoint?` `group?` | 列可用模型 ID |
| `groups` | — | 分组倍率与说明 |
| `raw` | `model` | 单模型原始 JSON |

启用后 Claude 直接调用工具,无需手动跑命令。

## 手动冒烟(可选)

```bash
node plugins/packyapi/scripts/packy-mcp.ts   # stdio server,喂 JSON-RPC 测试
```

## 安装(Claude Code)

本插件在 `prayer` repo 内,MCP server 通过 `.claude-plugin/plugin.json` 的 `mcpServers` 注册。让 Claude Code 识别:

- 项目级:在 `.claude/settings.json` 配置本地 marketplace 指向 `plugins/`,或
- 直接把 `plugins/packyapi` 软链到 `~/.claude/plugins/`。

依赖:Node ≥ v22.6(原生运行 TypeScript)、`@modelcontextprotocol/sdk`(repo 根 node_modules,`pnpm install` 即得)。
