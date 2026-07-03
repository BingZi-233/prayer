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

## 4. 架构

```
NapCat(OneBot) ──正向WS──> [WS Client] ──> [Gateway] ──> [Session Mgr] ──> [Claude Agent SDK]
                              ^                                                    │ tools
                              └────────── send action(回复) ──────────────────────┘
                                                     ┌──────────────┬──────────────┐
                                                   [RAG]        [业务tool]      [转人工]
                                                     │                            │
                                                  SQLite + sqlite-vec ────────────┘
```

进程模型:WS client 是长驻连接,由 Next.js `instrumentation.ts` 的 `register()` 在 server
启动时 boot 为单例。因此应用必须以 node runtime 运行(`next start`),不可部署到 edge/
serverless(WS、better-sqlite3、instrumentation 均需 node)。与 NapCat 同机部署。

## 5. 模块划分

每个模块单一职责、接口清晰、可独立测试。

### 5.1 `lib/onebot/client.ts` — OneBot WS 客户端
- 连接 `ONEBOT_WS_URL`,附带 access token。
- 断线指数退避重连(初始 1s,上限 30s)。
- 解析上报事件,规范化为内部 `IncomingMessage` 类型(仅关注 `message` 类型的群消息)。
- 动作发送:`send_group_msg`,用 `echo` 字段关联请求/响应(Promise map,超时 reject)。
- 对外接口:`onMessage(handler)`、`sendGroupMsg(groupId, text)`、`start()`、`stop()`。

### 5.2 `lib/agent/gateway.ts` — 消息网关
- 过滤:仅处理群消息;仅当消息含 @bot(CQ 码 `[CQ:at,qq=<BOT_QQ>]`)时触发。
- 清洗:剥离 @ CQ 码,得到纯文本 query。
- session key = `${group_id}:${user_id}`。
- human-mode 检查:若该 session 处于 human-mode,直接跳过(不自动回复)。
- 幂等:按 `message_id` 去重(近期 LRU 或 DB 唯一约束)。
- 并发:per-session 串行队列,保证多轮顺序;全局并发上限(如 5)。
- 管理命令:管理群内 `!resume <group>:<user>` 手动恢复某会话。

### 5.3 `lib/agent/session.ts` — 会话管理
- session key → SDK 会话映射。
- 多轮记忆:持久化 `session_id` 与消息历史到 SQLite `sessions`/`messages` 表;复用 SDK
  的会话 resume 能力续接上下文。
- 提供 `getOrCreate(key)`、`appendTurn(key, role, text)`、`setHumanMode(key, bool)`。

### 5.4 `lib/agent/agent.ts` — Agent 核心
- 调用 Claude Agent SDK `query()`。
- `systemPrompt`:客服人设(语气、边界、不知道就转人工、不编造)。
- `allowedTools`:RAG、业务、转人工三类。
- 传入历史上下文;返回最终文本用于回复。

### 5.5 Tools

`lib/tools/kb.ts` — RAG 检索
- 输入:用户 query。
- 流程:本地 embed(transformers.js)→ sqlite-vec top-k(如 k=5)→ 返回片段(含来源)。
- 供 Agent 在需要产品/FAQ 事实时调用。

`lib/tools/biz.ts` — 业务工具
- 查订单 / 查工单 / 查用户等,zod schema 定义参数。
- 初期返回 stub,预留接入真实业务 API 的接口。

`lib/tools/handoff.ts` — 转人工
- 置 `sessions.human_mode=true`、记录时间戳。
- 经 WS `send_group_msg` 发通知到 `ADMIN_GROUP_ID`:"用户 X(group:user)需人工,最后问题:…"。
- 返回给用户一句"已为您转接人工客服"。

### 5.6 `lib/db/` — 存储层
better-sqlite3 + sqlite-vec。表结构:

- `sessions(key PK, session_id, human_mode, human_since, updated_at)`
- `messages(id PK, session_key, role, content, message_id, created_at)`
- `tickets(id PK, session_key, summary, status, created_at)`
- `kb_chunks(id PK, doc, content, source)` + sqlite-vec 虚拟表 `kb_vec(embedding)` 关联 `kb_chunks.id`

### 5.7 `scripts/ingest.ts` — 知识库摄入 CLI
- 读取 `docs/kb/` 下文档 → 切块 → 本地 embed → 写 `kb_chunks` + `kb_vec`。
- 独立于运行时,手动/CI 触发。

### 5.8 `app/admin/*`(可选,后续)
- shadcn 后台:会话列表、human-mode 状态与恢复、KB 管理。
- 首版可省略,用管理群命令替代。

### 5.9 `instrumentation.ts`
- `register()` 中初始化 DB、boot WS client 单例、注册 gateway handler。
- 单例守卫,避免热重载重复连接。

## 6. 数据流

1. 群消息 → NapCat → 正向 WS → `client.ts` 规范化事件。
2. `gateway`:是否 @bot?算 session key;human-mode?去重;入 per-session 队列。
3. `session`:加载/resume 会话上下文。
4. `agent.query()`:带 tools 执行;SDK 按需调 RAG / 业务 / 转人工 tool。
5. 得到最终文本 → `client.sendGroupMsg()` 回复群。

转人工分支:agent 调 handoff tool → human_mode=true → 通知管理群 → gateway 此后跳过该
session → 人工在群内手动回复;`!resume` 命令或超过 `HANDOFF_TIMEOUT_MIN` 自动恢复自动应答。

## 7. 错误处理

- WS 断连:指数退避重连,重连后重置状态。
- PackyAPI/模型报错:退避重试(如 3 次);仍失败 → 兜底话术"系统繁忙,稍后再试",可选自动转人工。
- tool 报错:将错误信息回传给 model,让其优雅降级(不崩溃、不暴露栈)。
- 动作发送超时:echo 关联的 Promise 超时 reject,记录日志。
- 幂等:message_id 去重防重复应答。
- 并发:per-session 串行 + 全局上限,防止刷屏打爆模型配额。

## 8. 测试策略

- `client.ts`:mock WS server,验证事件解析、echo 关联、重连退避。
- `gateway.ts`:单测过滤(@bot 判定、去重、human-mode 跳过、session key)。
- `session.ts`:DB 读写、多轮 resume。
- tools:kb(mock embed + 固定向量库,验证 top-k)、handoff(验证置位 + 通知)、biz(schema 校验)。
- agent:mock SDK,验证 systemPrompt/tools 装配与最终文本回传。
- 端到端:mock NapCat WS,发一条 @bot 群消息,断言收到 `send_group_msg` 回复。

## 9. 新增依赖

`@anthropic-ai/claude-agent-sdk` `ws` `better-sqlite3` `sqlite-vec` `@xenova/transformers` `zod`

## 10. 非目标(YAGNI)

- 私聊、跨群统一会话(当前仅群聊 @ 触发)。
- 流式回复(OneBot 一次性发整条,无需 streaming)。
- 分布式/多实例(单机 SQLite 即可)。
- 完整 admin Web(首版用管理群命令)。

## 11. 里程碑(建议实现顺序)

1. DB 层 + schema + sqlite-vec。
2. OneBot WS client(收发 + 重连)。
3. Gateway(过滤/去重/队列)+ instrumentation 接线。
4. Session + Agent core(打通最小 LLM 应答)。
5. RAG tool + ingest CLI。
6. 业务 tool(stub)。
7. 转人工 tool + 管理群命令 + 超时恢复。
8. 错误处理加固 + 端到端测试。
9. (可选)admin Web。
