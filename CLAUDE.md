# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`prayer` 是基于 `@anthropic-ai/claude-agent-sdk` 的 QQ 群客服 Agent,通过 forward WebSocket 连接 NapCat（OneBot 协议）收发消息,外面套一层 Next.js 16 App Router 管理后台。单 Node 进程。代码注释与文档均用简体中文。

## 命令（用 pnpm）

- 开发管理后台 UI：`pnpm dev`（`next dev -H 0.0.0.0`）
- 生产：`pnpm build && pnpm start`（或 `pnpm pm:start` 走 pm2）
- 类型检查：`pnpm typecheck`（`tsc --noEmit`）
- Lint：`pnpm lint` / 格式化：`pnpm format`
- 测试全部：`pnpm test`；单个：`pnpm vitest run tests/lib/agent/session.test.ts` 或按名 `pnpm vitest run -t "名字"`
- 知识库入库：`pnpm ingest`（读 `docs/kb/**` → 本地嵌入 → sqlite-vec,幂等）

无 CI。声称完成前手动跑 `pnpm typecheck && pnpm lint && pnpm test`。

## 关键 gotcha（不说会踩）

- **真实 LLM 是 MiniMax-M3,不是 Claude。** 所有 Anthropic 模型档（opus/sonnet/haiku）在 `data/claude-config/settings.json` 的 `env` 块里被映射到 `MiniMax-M3[1m]`（`ANTHROPIC_BASE_URL` 指向 MiniMax 的 Anthropic 兼容端点）。模型 + relay 凭据只在这个文件里,**不在 `.env`**,后台 UI 也不编辑这三项;运行时会剥掉继承来的 `ANTHROPIC_*`。该文件已 gitignore 且含明文 token,勿泄露。
- **生产严禁 `next dev`。** claude-agent-sdk 要在真实 Node runtime 调本地 `claude` 二进制,只有 `pnpm build && pnpm start` 才对;`next dev` 的 HMR websocket 跨 LAN 不稳会挂骨架屏。不支持 edge/serverless/Vercel 部署。
- **`instrumentation.ts` 是启动入口**,仅在 Node runtime 跑,负责接 DB、config-store、runtime 并拉起 OneBot agent + 后台循环 + WS。管住那一个 `next start` 进程就管住了整个 agent。
- pm2 用 fork 单实例,**不能 cluster**（native better-sqlite3 + 单条 WS 长连接）。`pm:enable/disable` 是 Linux/systemd+sudo,macOS 开发机上不适用。

## 代码约定

- **路径别名 `@/*` 指向仓库根**,没有 `src/`。
- **Prettier:无分号 + 双引号**（`semi:false`, `singleQuote:false`, `trailingComma:es5`, printWidth 80）。不匹配 `pnpm format` 会全量重写。
- **测试放 `tests/`（镜像 `lib/` 结构),不与源码同目录** —— `include` 只认 `tests/**/*.test.ts`。
- native 依赖（`better-sqlite3`、`sqlite-vec`、`@huggingface/transformers`）在 `next.config.ts` 的 `serverExternalPackages`,别打包。嵌入用本地 `Xenova/bge-small-zh-v1.5`。
- Next.js 16 与你熟悉的不同,写前先读 `node_modules/next/dist/docs/`（见 AGENTS.md）。

## 仓库结构

`app/`（App Router:`/admin/*` 页面 + `/api/*` 路由）、`lib/`（核心:`agent/` agent+编排+反思循环、`db/` better-sqlite3、`onebot/` WS 客户端、`tools/` 嵌入+KB、`plugins/`）、`plugins/`（`cs`/`packyapi` 本地 MCP server）、`scripts/`（ingest）、`docs/kb/`（知识库源,gitignore）、`data/`+`logs/`（gitignore)。

## Git 约定

- 提交用 Conventional Commits(`feat/fix(scope): …`)+ 中文正文,与现有 git log 一致。
- 功能分支开发(`feat/*`),不直接提交 main。
- 改 agent 核心 / db schema / 后台反思循环前,先出方案再动手。
