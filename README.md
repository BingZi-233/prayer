# OneBot 客服 Agent

基于 Claude Agent SDK 的 OneBot(QQ)群聊客服 Agent。通过正向 WebSocket 连接 NapCat 收发消息,支持知识库检索(RAG)、多轮记忆、业务 tool 调用与转人工,并带一个 Next.js 管理后台。

除即时应答外,还有三条旁路后台链路持续自演进:

- **被动反思**:定时扫描已结束会话,从人工回复里沉淀问答要点为反思条目,回填知识库。
- **反思压缩**:定时把历史反思条目做近义合并、删除被基础文档覆盖或矛盾的旧条目;按快照 id 删除,避免与并发新增反思相互覆盖。
- **主动补位**:生效群里有人提问却久无人应答时,agent 主动补位——仅在知识库有确切依据且有把握时才作答,否则沉默。

技术栈:Next.js 16 + React 19 + shadcn/ui + better-sqlite3(sqlite-vec 向量索引)+ `@anthropic-ai/claude-agent-sdk`。

## 架构

单进程:Next.js Node 服务。`instrumentation.ts` 在 Node runtime 启动时装配并拉起 OneBot Agent —— 管住 `next start` 这一个进程即管住全部(Agent + 后台 + WS 连接)。

## 运行步骤

1. **填写 `.env`**

   ```bash
   cp .env.example .env
   ```

   - `CLAUDE_CONFIG_DIR`:Claude Agent SDK 配置目录(默认 `./data/claude-config`)。**模型与中转凭证不放 `.env`**,而是写在此目录的 `settings.json` 的 `env` 块(`ANTHROPIC_MODEL` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`)——运行时会剥离进程继承的 `ANTHROPIC_*`,只认这里的配置。管理后台不读写这三项,需直接编辑该文件。
   - `ONEBOT_WS_URL` / `ONEBOT_ACCESS_TOKEN`:NapCat 正向 WS server 地址与鉴权 token。
   - `BOT_QQ` / `ADMIN_GROUP_ID`:机器人 QQ 号与转人工通知的管理群号。
   - `HANDOFF_TIMEOUT_MIN`:转人工超时分钟数。
   - `DB_PATH`:SQLite(含 sqlite-vec 向量索引)数据库文件路径。
   - **被动反思**(均有默认值,可不填):`REFLECT_SCAN_MS`(扫描周期,默认 5 分钟)、`REFLECT_LOOKBACK_MS`(回看窗口,默认 2 小时)、`REFLECT_SETTLE_MS`(会话静置多久才提炼,默认 10 分钟)、`REFLECT_WINDOW_MAX`(单次最多提炼消息数,默认 60)。
   - **反思压缩**:`REFLECT_COMPACT_MS`(压缩周期,默认 24 小时,置 `0` 关闭)、`REFLECT_COMPACT_MIN_ENTRIES`(不足此条数不压缩,默认 10)。
   - **主动补位**:`PROACTIVE_ENABLED`(设为 `true` 开启,默认关闭)、`PROACTIVE_SCAN_MS`(扫描周期,默认 1 分钟)、`PROACTIVE_SILENCE_MS`(久无人应答阈值,默认 3 分钟)、`PROACTIVE_MAX_PER_SCAN`(单轮最多补位条数,默认 2)。

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
pnpm pm:restart   # 先停再 build 再启(避免 live build 覆盖 .next 导致静态资源 500)
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
| `/admin/reflection` | 被动反思:从人工回复沉淀的知识条目(压缩后同库) |
| `/admin/proactive` | 主动补位:无人应答兜底记录 |
| `/admin/tickets` | 转人工工单 |
| `/admin/groups` | 生效群白名单 |
| `/admin/capabilities` | Agent 运行时能力:插件 / 技能 / MCP server / 工具门控 |
| `/admin/plugins` | 插件安装 / 更新 / 启停(操作后 agent 自动重载) |
| `/admin/logs` | 运行日志 |

## 开发

环境版本、模块职责、配置扩展步骤及测试约定见 [开发与代码质量](docs/development.md)。
PR 与 main 推送由 GitHub Actions 自动执行类型检查、Lint、测试和生产构建。

```bash
pnpm dev          # 本地开发(localhost;勿对外)
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
```

## 环境要求与限制

- 部署环境须能找到 `claude` 可执行文件(随 `@anthropic-ai/claude-agent-sdk` 的平台包提供,或用 `pathToClaudeCodeExecutable` 显式指定)。
- 仅支持标准 Node.js 服务器运行时,**不支持** Vercel / 边缘函数等 edge / serverless 部署。
