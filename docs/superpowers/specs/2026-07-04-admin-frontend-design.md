# 管理后台前端设计(OneBot 客服 Agent)

**日期:** 2026-07-04
**分支:** feat/onebot-agent
**关联:** `docs/superpowers/specs/2026-07-03-onebot-customer-service-agent-design.md`(后端 Agent 设计)

## 背景与目标

后端事件驱动客服 Agent 已完成(16 tasks,全绿)。当前所有配置来自环境变量,Agent 在 `instrumentation.ts` 作为 `globalThis` 单例在 Next.js 启动时 boot 一次。

目标:建立一个 Web 管理后台,**所有配置由前端完成**(含 OneBot 连接、Claude Agent SDK 配置),并提供运行监控、知识库管理、会话查看能力。配置改动**热重载**生效,进程不重启。

## 范围

MVP 四个页面:

1. **配置页**(必做)—— OneBot + SDK settings.json + DB 路径
2. **运行状态/健康页** —— Agent 状态、WS 连接、会话数、转人工队列、手动重启
3. **知识库管理页** —— 编辑 `docs/kb` 内容,触发 `ingest` 重建 embedding
4. **会话/日志查看页** —— 历史会话(读 SDK transcript)、运行时日志

**不在范围(MVP):** 面板鉴权(本地/内网 + 反代;代码预留 middleware 插点)、SSE 实时推送(用轮询)、多用户/权限、页面组件级测试。

## 架构

### RuntimeManager(核心)

把 `instrumentation.ts` 的 boot 逻辑抽到 `lib/runtime.ts`,`RuntimeManager` 挂 `globalThis` 单例,持有 Agent 运行时生命周期:

```
RuntimeManager
  ├─ 持有: bus, orchestrator, agent, OneBotClient, logger(ring buffer)
  ├─ state: 'stopped' | 'starting' | 'running' | 'error'
  ├─ lastError, bootedAt
  ├─ start(cfg)       // 建 pipeline(assemble)+ 连 WS
  ├─ stop()           // 断 WS + 清 orchestrator 队列 + 卸 bus 监听
  ├─ reconfigure(cfg) // stop() → start(cfg),进程不重启
  └─ getStatus()      // { state, wsConnected, sessionCount, handoffQueue, lastError, bootedAt }
```

- `instrumentation.ts` 瘦身:读 config → `RuntimeManager.get().start(cfg)`。开机自启保留、单例守卫保留。
- Next API route handler 同进程直接调 `RuntimeManager.get()`,零 IPC。
- **热重载:** 任意配置改动 → `reconfigure()` 全量重建 pipeline(便宜、干净)。
- **代价:** `reconfigure` 瞬间在途会话被丢弃。可接受。
- WS 断线/重连状态由 `OneBotClient` 上报给 manager,状态页读取。

### 配置存储

**SQLite `config` 表**(新增,migrate 幂等追加):

```sql
config (key TEXT PRIMARY KEY, value TEXT /* json */, updated_at INTEGER)
```

单行 `key='app'`,value 为 JSON:

```
onebotWsUrl, onebotAccessToken(secret), botQQ, adminGroupId,
handoffTimeoutMin, dbPath, claudeConfigDir, model
```

- `getConfig() / setConfig(patch)`(`lib/config-store.ts`)。
- 首启无行 → 从环境变量种子入库一次;此后以 DB 为准,env 仅作初始种子。
- 兼容现有 `.env`。

### Claude Agent SDK 配置(settings.json)

前端管的 SDK 配置落成 Claude Code settings 格式文件:

- 路径 = `claudeConfigDir/settings.json`(默认 `./data/claude-config`)。
- 内容示例:`{ env: { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL }, permissions, model, ... }`。
- 前端提供:结构化字段(base url / token / model)+ 高级 raw JSON 编辑器(全量 settings.json)。
- boot / reconfigure 时:`process.env.CLAUDE_CONFIG_DIR = claudeConfigDir`,`agent.run` 的 SDK query 传 `settingSources: ['user']`,让 SDK 加载该 settings.json。
- 写入前 `JSON.parse` 校验,非法拒绝。

### secrets 处理

- `onebotAccessToken`、settings.json 里的 `ANTHROPIC_AUTH_TOKEN` 为 secret。
- API 读取时掩码:返回 `••••1234`(仅留后 4 位)。
- 前端字段留空 = 不修改;填入新值才覆写。

## 页面与 API

### 页面(App Router,`/admin/*`,shadcn + react-hook-form + zod)

| 页面 | 路径 | 内容 |
|---|---|---|
| 配置 | `/admin/config` | OneBot 表单 + SDK settings 表单(结构化 + raw JSON)+ DB 路径。保存 → 热重载。顶部 Agent 状态灯。 |
| 状态/健康 | `/admin` | state、WS 连接、会话数、转人工队列、bootedAt、lastError。手动「重启/重连」按钮。轮询刷新(3s)。 |
| 知识库 | `/admin/kb` | 列 `docs/kb` 文件、编辑内容、「重建 embedding」触发 ingest。显示进度/结果。 |
| 会话/日志 | `/admin/sessions` | 列历史会话(SQLite)、点开看消息记录 + 工具调用(读 SDK transcript);运行时日志 tail。 |

### API 路由(route handlers,同进程调 RuntimeManager / Repo)

```
GET  /api/config            读配置(secrets 掩码)
PUT  /api/config            写配置 + settings.json → reconfigure()
GET  /api/status            RuntimeManager.getStatus()
POST /api/runtime/restart   手动 reconfigure()
GET  /api/kb                列 kb 文件
PUT  /api/kb/:file          存单文件
POST /api/kb/ingest         跑 ingest(进程内),回结果
GET  /api/sessions          列会话
GET  /api/sessions/:id      会话消息 + 工具调用(读 transcript)
GET  /api/logs              运行时日志(ring buffer)
```

- 统一响应 `{ ok, data?, error? }`,zod 校验入参,secrets 掩码。
- 刷新策略:状态页轮询 `GET /api/status` 每 3s;ingest/日志用轮询,不上 SSE(YAGNI)。

## 会话/日志数据源

- **会话列表** = 现有 `sessions` 表(`key ↔ session_id`)。
- **会话详情** = 读 SDK transcript JSONL:`CLAUDE_CONFIG_DIR/projects/**/<session_id>.jsonl`(glob 兜底不同 cwd-slug),解析出 user / assistant / tool 消息。
- **转人工队列** = 现有 `tickets` 表。
- **不新增 messages 表,orchestrator / reply 路径零改动。**
- transcript 是 SDK 内部结构,解析器做**宽松容错**(未知字段忽略、坏行跳过);字段留待冒烟核对。

## 运行时日志

- `RuntimeManager` 内存 ring buffer,保留末 500 行 `{ ts, level, msg }`。
- 现有 `console.log` 包一层 `logger`(`lib/logger.ts`),同时写 buffer。
- `GET /api/logs` 读 buffer。**重启丢失**,可接受(会话历史由 transcript 持久化)。

## 错误处理

- `reconfigure`:stop 旧 → start 新;start 抛错(WS 连不上 / settings.json 非法)→ state='error' + lastError,保留错误态,状态页红灯 + 错误文案,用户改配置重试。
- settings.json 写入前 `JSON.parse` 校验。
- API 层统一错误形状,zod 入参校验,secrets 掩码。

## 测试策略(vitest + TDD)

| 单元 | 测什么 |
|---|---|
| `Repo.getConfig/setConfig`(config-store) | 读写、env 种子回落、单行 upsert |
| settings.json writer | 结构化字段 → JSON、非法 JSON 拒绝、secret 合并(留空不改) |
| secret 掩码器 | 掩码 / 后 4 位 / 空值语义 |
| transcript 解析器 | JSONL → 消息数组、坏行跳过、未知字段忽略 |
| `RuntimeManager` | start/stop/reconfigure 状态机、start 抛错 → error 态、ring buffer 截断(mock client/agent) |
| API route(纯逻辑) | zod 校验、`{ok,error}` 形状、掩码 |

- 页面组件不做重测(MVP);逻辑抽到可测 lib 函数,route handler 保持薄。

## 文件布局

```
lib/runtime.ts            RuntimeManager
lib/config-store.ts       getConfig/setConfig + env 种子
lib/settings-writer.ts    settings.json 读写 + 校验 + 掩码
lib/transcript.ts         SDK JSONL 解析
lib/logger.ts             ring buffer logger
app/admin/                layout + config/status/kb/sessions 页
app/api/                  config,status,runtime,kb,logs,sessions route handlers
components/ui/            按需 shadcn add(input,card,table,tabs,badge,textarea...)
instrumentation.ts        瘦身 → RuntimeManager.get().start()
```

## 依赖与约束

- `pnpm add react-hook-form @hookform/resolvers`(zod 已有)。
- shadcn 组件用 CLI `add`(input,card,table,tabs,badge,textarea 等)。
- **不手改 package.json**:依赖用 `pnpm add`,脚本用 `pnpm pkg set`。

## 待冒烟核对项

- SDK transcript JSONL 的真实字段结构(user/assistant/tool 块格式)。
- `settingSources: ['user']` + `CLAUDE_CONFIG_DIR` 是否让 SDK 正确加载 settings.json。
- transcript 文件在 `CLAUDE_CONFIG_DIR/projects/` 下的真实路径 slug 规则。
