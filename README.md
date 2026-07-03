# Next.js template

This is a Next.js template with shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```

## OneBot 客服 Agent

本项目内置一个基于 Claude Agent SDK 的 OneBot(QQ)群聊客服 Agent,通过正向 WebSocket 连接 NapCat 收发消息,支持知识库检索(RAG)、多轮记忆、业务 tool 调用与转人工。

### 运行步骤

1. **填写 `.env`**

   复制 `.env.example` 为 `.env`,并填写各项配置:

   ```bash
   cp .env.example .env
   ```

   - `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`:PackyAPI(Claude 中转)凭证与模型名。
   - `ONEBOT_WS_URL` / `ONEBOT_ACCESS_TOKEN`:NapCat 正向 WS server 地址与鉴权 token。
   - `BOT_QQ` / `ADMIN_GROUP_ID`:机器人 QQ 号与转人工通知的管理群号。
   - `HANDOFF_TIMEOUT_MIN`:转人工超时分钟数。
   - `DB_PATH`:SQLite(含 sqlite-vec 向量索引)数据库文件路径。

2. **灌知识库**

   将知识文档放入约定目录后执行摄入脚本,生成本地 embedding 并写入向量库:

   ```bash
   pnpm ingest
   ```

3. **构建并以 Node runtime 启动**

   ```bash
   pnpm build
   pnpm start
   ```

   > ⚠️ **不能用 `next dev` 启动生产客服 Agent**:`next dev` 以及任何 edge/serverless 部署形态都无法满足本 Agent 的运行要求 —— Claude Agent SDK 需要在**本机 Node runtime** 中调用本地 `claude` 可执行二进制(而非 edge/serverless 沙箱),因此必须用 `pnpm build && pnpm start` 以标准 Node 服务方式运行,`instrumentation.ts` 才会在启动时完成装配并建立 OneBot 连接。

4. **NapCat 开正向 WS server**

   在 NapCat 侧配置「正向 WebSocket 服务器」,监听端口需与 `.env` 中的 `ONEBOT_WS_URL` 指向的本机端口一致(默认 `ws://127.0.0.1:3001`),并按需配置 `ONEBOT_ACCESS_TOKEN`。

5. **群里 @bot 测试**

   在已加入的 QQ 群内 `@` 机器人发送消息,确认 Agent 能够回复;涉及知识库问答、业务查询、转人工等场景可分别验证。

### 环境要求与限制

- 部署环境必须能找到 `claude` 可执行文件(随 `@anthropic-ai/claude-agent-sdk` 提供的平台包,或通过 `pathToClaudeCodeExecutable` 显式指定)。
- 仅支持标准 Node.js 服务器运行时,**不支持** Vercel/边缘函数等 edge 或 serverless 部署方式。
