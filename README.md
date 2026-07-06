# OneBot 客服 Agent

基于 Claude Agent SDK 的 OneBot(QQ)群聊客服 Agent。通过正向 WebSocket 连接 NapCat 收发消息,支持知识库检索(RAG)、多轮记忆、业务 tool 调用与转人工,并带一个 Next.js 管理后台。

技术栈:Next.js 16 + React 19 + shadcn/ui + better-sqlite3(sqlite-vec 向量索引)+ `@anthropic-ai/claude-agent-sdk`。

## 架构

单进程:Next.js Node 服务。`instrumentation.ts` 在 Node runtime 启动时装配并拉起 OneBot Agent —— 管住 `next start` 这一个进程即管住全部(Agent + 后台 + WS 连接)。

## 运行步骤

1. **填写 `.env`**

   ```bash
   cp .env.example .env
   ```

   - `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`:PackyAPI(Claude 中转)凭证与模型名。
   - `ONEBOT_WS_URL` / `ONEBOT_ACCESS_TOKEN`:NapCat 正向 WS server 地址与鉴权 token。
   - `BOT_QQ` / `ADMIN_GROUP_ID`:机器人 QQ 号与转人工通知的管理群号。
   - `HANDOFF_TIMEOUT_MIN`:转人工超时分钟数。
   - `DB_PATH`:SQLite(含 sqlite-vec 向量索引)数据库文件路径。

2. **灌知识库**

   ```bash
   pnpm ingest
   ```

   将知识文档放入约定目录后执行,生成本地 embedding 并写入向量库。

3. **构建并以 Node runtime 启动**

   ```bash
   pnpm build
   pnpm start
   ```

   生产/常驻建议用 pm2(见下)。

   > ⚠️ **不能用 `next dev` 跑生产客服 Agent**。两个原因:
   > 1. Claude Agent SDK 需在**本机 Node runtime** 调用本地 `claude` 二进制,edge/serverless 沙箱不行;必须 `pnpm build && pnpm start`,`instrumentation.ts` 才会装配并建立 OneBot 连接。
   > 2. `next dev` 对**局域网/远程访问**不可靠:HMR WebSocket 握手失败、客户端 hydration 不完成,导致管理后台页面卡在骨架屏、数据加载不出来(后端 API 本身正常)。对外访问一律走生产构建。

4. **NapCat 开正向 WS server**

   NapCat 侧配置「正向 WebSocket 服务器」,监听端口与 `.env` 的 `ONEBOT_WS_URL` 一致(默认 `ws://127.0.0.1:3001`),按需配 `ONEBOT_ACCESS_TOKEN`。

5. **群里 @bot 测试**

   已加入的 QQ 群内 `@` 机器人发消息,验证回复 / 知识库问答 / 业务查询 / 转人工。

## 进程管理(pm2)

生产/常驻用 pm2,配置见 `ecosystem.config.cjs`(单进程 fork 模式,native sqlite + WS 长连接不可 cluster,日志写 `logs/`)。

```bash
pnpm pm:start     # build + 启动(后台守护)
pnpm pm:status    # 查看状态
pnpm pm:logs      # 实时日志
pnpm pm:restart   # 重新 build + 重启(--update-env 刷新 .env)
pnpm pm:stop      # 停止(保留在 pm2 列表)
pnpm pm:delete    # 从 pm2 移除
```

开机自启(**Linux / systemd**,需 sudo):

```bash
pnpm pm:enable    # 装 systemd 自启单元 + pm2 save 快照进程
pnpm pm:disable   # 移除 systemd 自启
```

> 进程列表变动(加删 app)后重跑 `pnpm exec pm2 save` 刷新快照,重启才能正确 resurrect。

## 管理后台

启动后访问 `/admin`(默认端口 3000,绑 `0.0.0.0` 可局域网访问):

| 路径 | 功能 |
| --- | --- |
| `/admin` | 运行状态(WS 连接 / 会话数 / 转人工队列) |
| `/admin/config` | 配置(OneBot / Claude SDK / 存储),保存即热重载 |
| `/admin/kb` | 知识库管理与向量摄入 |
| `/admin/sessions` | 历史会话对话记录、一键重开 |
| `/admin/reflection` | 被动反思 |
| `/admin/tickets` | 转人工工单 |
| `/admin/groups` | 生效群白名单 |
| `/admin/logs` | 运行日志 |

## 开发

```bash
pnpm dev          # 本地开发(localhost;勿对外)
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
```

## 环境要求与限制

- 部署环境须能找到 `claude` 可执行文件(随 `@anthropic-ai/claude-agent-sdk` 的平台包提供,或用 `pathToClaudeCodeExecutable` 显式指定)。
- 仅支持标准 Node.js 服务器运行时,**不支持** Vercel / 边缘函数等 edge / serverless 部署。
