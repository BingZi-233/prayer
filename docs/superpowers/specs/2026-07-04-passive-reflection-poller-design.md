# 被动反思沉淀（轮询缓冲版）设计

日期：2026-07-04
分支：feat/onebot-agent

## 背景与目标

现有反思沉淀是**事件驱动 + 依赖转人工**：用户触发 `handoff_to_human` 工具 → 进人工接管期（`human_mode`）→ gateway 内联把管理员发言当人工答案 → LLM 提炼入库。

问题：强耦合 handoff、逐条推送看不到"回答之后"的后续，无法判断答案是否**真正有效解决**问题。

**新目标**：去掉整个 handoff 子系统。改为**被动观察**——所有群消息落 DB 缓冲，定时器扫窗口，LLM 批量判定「管理发言是否在有效解答某问题」，只有**有效**才沉淀 FAQ，否则丢弃。

## 架构总览

```
message.received ──▶ registerMessageBuffer ──▶ group_messages 表(环形缓冲)
                                                      │
             setInterval(scanMs) ── registerReflectionPoller
                                                      │ 取窗口(cursor, now-settle)
                                                      ▼
                                        LLM 单轮无工具 ── 批判 Q/A + 有效性
                                                      │ effective=true
                                                      ▼
                                   embed + insertKbChunk/Vec(source=human-reflection)
                                                      + 管理群通知 + 推进 cursor
```

旁路观察者：任何失败只 emit `error.occurred`，绝不阻断主链路。

## 组件

### 1. 消息缓冲 `registerMessageBuffer`（新，`lib/agent/message-buffer.ts`）

监听 `message.received`，**每条**群消息落 `group_messages`：
- 排除：`groupId === adminGroupId`、bot 自己（`userId === botQQ`）、空文本（无 rawText）
- 落库字段：`group_id, user_id, sender_role, text, created_at`（`created_at` 用 `unixepoch('subsec')*1000`）
- 不做 @bot 过滤——反思要看全量对话上下文（用户问 + 管理答 + 用户后续）

### 2. 反思轮询 `registerReflectionPoller`（新，`lib/agent/reflection-poller.ts`，取代 reflection-handler）

`setInterval(scanMs)` 每轮：
1. 读游标 `cursor`（时间戳，默认 0）
2. 判定"已沉降"上界 `until = now - settleMs`；若 `until <= cursor` 本轮跳过
3. 找出 `(cursor, until]` 内**存在管理发言**（sender_role ∈ {owner, admin}）的 group
4. 每个这样的 group：取该群近 `lookbackMs` 内全部消息（含角色、按 created_at 升序，上限 `windowMax` 条）为一段转录
5. 转录喂 LLM（单轮、无工具、`canUseTool` 全 deny、`maxTurns:1`，沿用现有 SDK 调用模式），要求只针对 `(cursor, until]` 时间带内的管理发言判定
6. 解析 LLM 输出的 JSON 数组，逐条 `effective===true && faq` 非空 → `embed` + `insertKbChunk("human-reflection", faq, "human-reflection:{groupId}:{now}")` + `insertKbVec` + 管理群发通知
7. 推进 `cursor = until`；剪枝：删 `created_at < now - (lookbackMs + settleMs)` 的缓冲行

**判定规则（两信号）** —— 写进 system prompt：
- 管理发言是否在解答某用户问题？否（闲聊/寒暄/指令/无关）→ 丢
- 有效性：**优先看后续**——回答之后用户回谢谢/确认/不再追问 = 有效；**窗口内该问题无后续消息** → 退回判断回答本身是否完整、正确、可复用
- 含隐私（订单号/手机号）、一次性、信息不足 → 丢
- 输出：`[{"question","answer","effective":bool,"faq":"脱离上下文的完整知识,纯文本"}]`，无内容输出 `[]`

**游标语义**：band `(cursor, now-settleMs]` 保证①每条管理发言只判一次②`settleMs` 给用户后续留时间。太新（`> now-settleMs`）的消息不碰，下轮再说。

### 3. Repo 变更（`lib/db/repo.ts`）

**新增**：
- `bufferGroupMessage(groupId, userId, senderRole, text)` — INSERT
- `groupsWithAdminMessagesBetween(afterTs, untilTs): number[]` — 该时间带含管理发言的 group 去重
- `groupMessageWindow(groupId, sinceTs, limit): {userId, senderRole, text, createdAt}[]` — 升序窗口
- `pruneGroupMessages(beforeTs)` — 剪枝
- `reflectCursor(): number` / `setReflectCursor(ts)` — 游标存 `kv` 表（见 schema）

**删除**：`isHumanMode / setHumanMode / staleHumanSessions / setHandoffQuestion / handoffQuestion / humanSessionsInGroup`

### 4. DB schema（`lib/db/index.ts`）

**新增**：
```sql
CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  sender_role TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gm_group_time ON group_messages(group_id, created_at);
```
游标存通用 kv 表：
```sql
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```
`reflectCursor` 读 `key='reflect_cursor'`（缺省 0）；`setReflectCursor` UPSERT。

`sessions.human_mode / human_since / last_question` 列**保留不用**（SQLite 删列成本高，只停读写；旧库 ALTER 容错逻辑保留但无害）。

## 移除清单（全删 handoff 子系统）

| 文件 | 动作 |
|---|---|
| `lib/tools/handoff.ts` | 删文件 |
| `lib/tools/index.ts` | 删 `makeHandoffTool` import、`tools` 列表移除、allowedTools 去 `mcp__cs__handoff_to_human`；`ToolContext` 若仅 handoff 用则简化 |
| `lib/agent/handoff-handler.ts` | 删文件 |
| `lib/agent/reflection-handler.ts` | 删文件 |
| `lib/agent/gateway.ts` | 删「管理回复检测块」(36-47)、`isHumanMode` 判断(52)、`!resume`(20-21)。保留 `!reset`(清 resumeId) |
| `lib/agent/agent.ts` | system prompt 删转人工引导(72)；构建工具处去 handoff ctx 绑定注释 |
| `lib/events.ts` | 删 `HandoffRequested/HandoffResumed/HandoffHumanReply` interface + EventMap 3 键 |
| `lib/db/repo.ts` | 见上（删 6 方法，加 buffer/cursor）|
| `lib/db/index.ts` | 加 `group_messages` + 游标存储 |
| `lib/onebot/parse.ts` | `senderRole` **保留**（poller 认管理用）|
| `lib/assemble.ts` | 删 `registerHandoffHandler`+`registerReflectionHandler`，加 `registerMessageBuffer`+`registerReflectionPoller`；`timeoutMin` 从 AssembleDeps 移除或复用为 poller 配置 |

**Agent 行为变化**：无 handoff 工具后，bot 答不了就答不了，不转人工。这是预期。

## 配置

env / config 新增（给合理默认）：
- `REFLECT_SCAN_MS` 默认 300000（5min）
- `REFLECT_LOOKBACK_MS` 默认 7200000（2h）
- `REFLECT_SETTLE_MS` 默认 600000（10min）
- `REFLECT_WINDOW_MAX` 默认 60（单群喂 LLM 最大条数）

## 错误处理

- poller 每轮 try/catch；单群失败不影响其他群
- LLM 输出非合法 JSON 数组 → 当 `[]`（不沉淀），记 error
- embed / DB 失败 → 记 error，不阻断，cursor 仍推进（该条丢失可接受，旁路语义）
- `client` 未连接不影响 buffer（buffer 只吃 bus 事件）

## 测试

- `repo.test`：buffer 落库、窗口取数（升序/limit）、剪枝、游标读写、`groupsWithAdminMessagesBetween`
- `message-buffer.test`：过滤 adminGroup/bot/空文本；正常消息落库
- `reflection-poller.test`（mock queryFn + embed）：
  - 有效 Q/A → 入库 + 通知
  - 无关管理发言 → 丢
  - 有后续确认 → 有效；无后续 → 退质量判断
  - settle band：太新消息不判、游标正确推进
  - LLM 非法输出 → 不入库不抛
- `gateway.test`：删 handoff 用例，断言管理发言不再特殊处理，`!reset` 仍工作
- 删 `handoff-handler.test` / `reflection-handler.test`；`parse.test` senderRole 用例保留
- 真 SDK E2E：造「用户问→管理答→用户谢」转录 → 验证 LLM 提炼入库

## 非目标（YAGNI）

- 不加 `get_group_msg_history` 轮询 API（用推送缓冲替代）
- 不做 FAQ 入库前的相似度去重（后续可选）
- 不保留任何人工接管/静音语义
