# OneBot 客服 Agent 设计文档

日期:2026-07-03
项目:prayer (Next.js 16 + shadcn/ui)

## 1. 目标

基于 Claude Agent SDK 构建一个集成在 Next.js 应用内的 OneBot 客服 Agent。Agent 通过正向
WebSocket 连接 OneBot 实现(NapCat/Lagrange 等),在群聊中被 @ 触发后自动应答,具备知识库问
答(RAG)、业务工具调用、转人工三大能力。模型请求经 PackyAPI 中转到 Claude。

## 2. 关键决策(已确认)

| 维度 | 决策 |
|---|---|
| 运行形态 | 集成进现有 Next.js (TS) 项目 `prayer` |
| 模型接入 | PackyAPI 中转,Claude Agent SDK 读取 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` |
| OneBot 连接 | 正向 WebSocket:Agent 作为 WS client 主动连接 NapCat 的 WS server |
| 能力 | RAG 知识库问答 + 业务 tool 调用 + 转人工 |
| 会话模型 | 群聊 @bot 触发;session key = `group_id:user_id`;多轮记忆 |
| 存储 | SQLite 本地(better-sqlite3)+ sqlite-vec 向量检索 |
| 转人工 | 通知管理群 + 暂停该会话自动回复,人工/超时后恢复 |
| Embedding | 本地 `@xenova/transformers`,模型 bge-small-zh(onnx),零外部依赖 |
| 架构风格 | **事件驱动**:进程内 typed EventEmitter 事件总线,模块以 publisher/subscriber 解耦 |

## 3. 环境变量

```
ANTHROPIC_BASE_URL=https://www.packyapi.com
ANTHROPIC_AUTH_TOKEN=<PackyAPI CC 组 token>
ONEBOT_WS_URL=ws://127.0.0.1:3001          # NapCat 正向 WS server
ONEBOT_ACCESS_TOKEN=<可选,OneBot 鉴权>
ADMIN_GROUP_ID=<转人工通知的管理群号>
BOT_QQ=<bot 自身 QQ,用于识别 @>
HANDOFF_TIMEOUT_MIN=30                       # human-mode 自动恢复超时
```

Claude Agent SDK 原生读取 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`,无需改动 SDK
即走 PackyAPI。

## 4. 架构(事件驱动)

所有模块不直接互相调用,而是围绕一条进程内**事件总线**(typed EventEmitter)发布/订阅事件。
WS client 只负责 IO;业务逻辑由订阅者响应事件推进。好处:模块解耦、易测(直接 emit 事件即可
驱动)、易扩展(新增订阅者不改现有模块)。

```
                          ┌──────────────── Event Bus (typed EventEmitter) ────────────────┐
                          │  message.received  message.qualified  reply.ready  handoff.*    │
                          │  action.send       error.occurred                               │
                          └──▲────────▲──────────▲──────────▲──────────▲──────────▲──────────┘
                             │pub     │sub/pub   │sub/pub   │sub/pub   │sub/pub   │sub
NapCat ──正向WS──> [WS Client]     [Gateway]  [Orchestrator] [Handoff] [Error]  (各 tool)
   ▲                  │ sub action.send                │ 调 tool
   └── send action ───┘                                └─ RAG / 业务 / 转人工(tool 内 emit 事件)
                                                          │
                                                   SQLite + sqlite-vec
```

事件流转(而非直接调用):
- WS Client `pub` `message.received`,`sub` `action.send`(→ 实际发 OneBot 动作)。
- Gateway `sub` `message.received` → 过滤/去重/human-mode 检查 → `pub` `message.qualified`。
- Orchestrator `sub` `message.qualified` → per-session 串行 → 跑 Agent → `pub` `reply.ready`。
- `reply.ready` 由一个薄 mapper `sub` → `pub` `action.send`(WS Client 消费)。
- Handoff tool `pub` `handoff.requested`;Handoff handler `sub` → 置 human_mode + `pub` `action.send`(通知管理群)。
- 任意模块出错 `pub` `error.occurred`;Error handler `sub` → 集中日志 + 兜底话术。

进程模型:总线与 WS client 均为长驻单例,由 Next.js `instrumentation.ts` 的 `register()` 在
server 启动时 boot、装配所有订阅者。因此应用必须以 node runtime 运行(`next start`),不可部署
到 edge/serverless(WS、better-sqlite3、instrumentation、单例总线均需 node)。与 NapCat 同机部署。

## 5. 事件总线与事件目录

### 5.0 `lib/bus.ts` — 事件总线
- 基于 Node `EventEmitter` 的 typed 封装(或轻量 `mitt`),导出单例 `bus`。
- 类型化事件 map,`bus.emit(type, payload)` / `bus.on(type, handler)` 全程类型安全。
- 单例守卫(挂 `globalThis`),避免热重载重复注册订阅者。

**事件目录**(payload 关键字段):

| 事件 | 发布者 | 订阅者 | payload |
|---|---|---|---|
| `message.received` | WS Client | Gateway | `{ groupId, userId, messageId, rawText, atList }` |
| `message.qualified` | Gateway | Orchestrator | `{ sessionKey, groupId, userId, text }` |
| `reply.ready` | Orchestrator | reply mapper | `{ groupId, text }` |
| `action.send` | mapper / Handoff | WS Client | `{ action:'send_group_msg', groupId, text }` |
| `handoff.requested` | Handoff tool | Handoff handler | `{ sessionKey, groupId, userId, lastQuestion }` |
| `handoff.resumed` | resume 命令 / 超时 | Handoff handler | `{ sessionKey }` |
| `error.occurred` | 任意模块 | Error handler | `{ scope, err, sessionKey? }` |

## 6. 模块划分

每个模块单一职责、接口清晰、可独立测试。模块间**只经事件总线通信**,不直接互调。

### 6.1 `lib/onebot/client.ts` — OneBot WS 客户端(纯 IO)
- 连接 `ONEBOT_WS_URL`,附带 access token;断线指数退避重连(初始 1s,上限 30s)。
- 收:解析上报的群消息 → `bus.emit('message.received', …)`。
- 发:`bus.on('action.send', …)` → `send_group_msg`,`echo` 字段关联请求/响应(Promise map,超时 reject)。
- 不含任何业务判断。对外仅 `start()` / `stop()`。

### 6.2 `lib/agent/gateway.ts` — 消息网关(订阅 `message.received`)
- 过滤:仅群消息;仅 @bot(`atList` 含 `BOT_QQ`)时放行。
- 清洗:剥离 @ CQ 码得纯文本;session key = `${groupId}:${userId}`。
- human-mode 检查:该 session 处于 human-mode → 丢弃(不 emit)。
- 幂等:按 `messageId` 去重(LRU + DB 唯一约束)。
- 管理命令:管理群内 `!resume <key>` → `bus.emit('handoff.resumed', …)`。
- 放行 → `bus.emit('message.qualified', …)`。

### 6.3 `lib/agent/orchestrator.ts` — 编排(订阅 `message.qualified`)
- per-session 串行队列(保证多轮顺序)+ 全局并发上限(如 5)。
- 取会话上下文(Session Mgr)→ 跑 Agent core → `bus.emit('reply.ready', { groupId, text })`。
- 失败 → `bus.emit('error.occurred', …)`。
- 另有一个薄 mapper:`bus.on('reply.ready')` → `bus.emit('action.send', …)`(隔离业务与 IO)。

### 6.4 `lib/agent/session.ts` — 会话管理
- session key → SDK 会话映射;多轮记忆:持久化 `session_id` 与历史到 SQLite,复用 SDK resume。
- `getOrCreate(key)`、`appendTurn(key, role, text)`、`setHumanMode(key, bool)`。

### 6.5 `lib/agent/agent.ts` — Agent 核心
- 调用 Claude Agent SDK `query()`。`systemPrompt`:客服人设(语气、边界、不知道就转人工、不编造)。
- `allowedTools`:RAG、业务、转人工;传入历史上下文;返回最终文本。

### 6.6 `lib/agent/handoff-handler.ts` — 转人工处理器(订阅 `handoff.requested` / `handoff.resumed`)
- `handoff.requested` → `setHumanMode(key,true)` + `bus.emit('action.send', 通知管理群)`。
- `handoff.resumed` → `setHumanMode(key,false)`。
- 超时:定时器扫描 `human_since` 超 `HANDOFF_TIMEOUT_MIN` → `bus.emit('handoff.resumed', …)`。

### 6.7 `lib/agent/error-handler.ts` — 错误处理器(订阅 `error.occurred`)
- 集中日志;必要时 `bus.emit('action.send', 兜底话术)`;可选自动 `handoff.requested`。

### 6.8 Tools

`lib/tools/kb.ts` — RAG 检索
- 输入:用户 query。
- 流程:本地 embed(transformers.js)→ sqlite-vec top-k(如 k=5)→ 返回片段(含来源)。
- 供 Agent 在需要产品/FAQ 事实时调用。

`lib/tools/biz.ts` — 业务工具
- 查订单 / 查工单 / 查用户等,zod schema 定义参数。
- 初期返回 stub,预留接入真实业务 API 的接口。

`lib/tools/handoff.ts` — 转人工
- tool 内不直接改库/发消息,只 `bus.emit('handoff.requested', { sessionKey, groupId, userId, lastQuestion })`。
- 实际置位与通知由 Handoff handler(6.6)响应事件完成 —— 保持 tool 无副作用、易测。
- 返回给用户一句"已为您转接人工客服"。

### 6.9 `lib/db/` — 存储层
better-sqlite3 + sqlite-vec。表结构:

- `sessions(key PK, session_id, human_mode, human_since, updated_at)`
- `messages(id PK, session_key, role, content, message_id, created_at)`
- `tickets(id PK, session_key, summary, status, created_at)`
- `kb_chunks(id PK, doc, content, source)` + sqlite-vec 虚拟表 `kb_vec(embedding)` 关联 `kb_chunks.id`

### 6.10 `scripts/ingest.ts` — 知识库摄入 CLI
- 读取 `docs/kb/` 下文档 → 切块 → 本地 embed → 写 `kb_chunks` + `kb_vec`。
- 独立于运行时,手动/CI 触发。

### 6.11 `app/admin/*`(可选,后续)
- shadcn 后台:会话列表、human-mode 状态与恢复、KB 管理。
- 首版可省略,用管理群命令替代。

### 6.12 `instrumentation.ts` — 装配
- `register()`:初始化 DB → 构造单例 `bus` → 注册所有订阅者(gateway/orchestrator/handoff/error/reply mapper)→ boot WS client → `client.start()`。
- 单例守卫,避免热重载重复连接与重复订阅。

## 7. 数据流(事件序列)

1. 群消息 → NapCat → 正向 WS → WS Client `emit('message.received')`。
2. Gateway `on('message.received')`:@bot?去重?human-mode? → `emit('message.qualified')`(或丢弃)。
3. Orchestrator `on('message.qualified')`:per-session 串行 → Session 取上下文 → `agent.query()`(SDK 按需调 RAG/业务/转人工 tool)→ `emit('reply.ready')`。
4. reply mapper `on('reply.ready')` → `emit('action.send')`。
5. WS Client `on('action.send')` → `send_group_msg` 回复群。

转人工分支:handoff tool `emit('handoff.requested')` → Handoff handler 置 human_mode + `emit('action.send')` 通知管理群 → Gateway 此后对该 session 丢弃消息 → 人工在群内手动回复;`!resume` 命令或超时 → `emit('handoff.resumed')` → Handoff handler 复位。

## 8. 错误处理

- 统一走 `error.occurred` 事件 → Error handler 集中处理(日志 + 兜底 + 可选自动转人工)。
- WS 断连:指数退避重连,重连后重置状态。
- PackyAPI/模型报错:退避重试(如 3 次);仍失败 → `emit('error.occurred')` → 兜底话术"系统繁忙,稍后再试"。
- tool 报错:将错误信息回传给 model,让其优雅降级(不崩溃、不暴露栈)。
- 动作发送超时:echo 关联的 Promise 超时 reject → `emit('error.occurred')`。
- 幂等:message_id 去重防重复应答。
- 并发:per-session 串行 + 全局上限,防止刷屏打爆模型配额。

## 9. 测试策略

事件驱动天然易测:直接 `bus.emit` 输入事件、断言输出事件,无需拉起真实 IO。

- `bus.ts`:类型/单例守卫。
- `client.ts`:mock WS server,验证 `message.received` 解析、`action.send` → echo 关联、重连退避。
- `gateway.ts`:emit `message.received` → 断言是否 emit `message.qualified`(@bot 判定、去重、human-mode 跳过、session key)。
- `orchestrator.ts`:emit `message.qualified` + mock agent → 断言 emit `reply.ready`;串行与并发上限。
- `handoff-handler.ts`:emit `handoff.requested/resumed` → 断言置位与通知;超时定时器。
- `session.ts`:DB 读写、多轮 resume。
- tools:kb(mock embed + 固定向量库,验证 top-k)、handoff(断言 emit `handoff.requested`)、biz(schema 校验)。
- 端到端:mock NapCat WS,发一条 @bot 群消息,断言收到 `send_group_msg`。

## 10. 新增依赖

`@anthropic-ai/claude-agent-sdk` `ws` `better-sqlite3` `sqlite-vec` `@xenova/transformers` `zod`
（事件总线用 Node 内置 `EventEmitter`,或轻量 `mitt`,可零新增依赖）

## 11. 非目标(YAGNI)

- 私聊、跨群统一会话(当前仅群聊 @ 触发)。
- 流式回复(OneBot 一次性发整条,无需 streaming)。
- 分布式/多实例(单机 SQLite + 进程内总线即可)。
- 持久化/可重放事件(进程内 EventEmitter,不做 outbox)。
- 完整 admin Web(首版用管理群命令)。

## 12. 里程碑(建议实现顺序)

1. `bus.ts` 事件总线 + 类型定义。
2. DB 层 + schema + sqlite-vec。
3. OneBot WS client(收发 + 重连,收发均经总线)。
4. Gateway(过滤/去重)+ instrumentation 装配订阅者。
5. Session + Agent core + Orchestrator(打通最小 LLM 应答)。
6. RAG tool + ingest CLI。
7. 业务 tool(stub)。
8. 转人工 tool + Handoff handler + 管理群命令 + 超时恢复。
9. Error handler + 端到端测试。
10. (可选)admin Web。
