# @ 前回看用户本人历史（prior context）设计

日期：2026-07-20  
状态：ready（Codex 两轮复查；阻断项已写进本文）  
审查：`codex exec` gpt-5.6-terra ×2；第二轮仍 Block 的两项（重置入缓冲、v2 补列）已并入下文。

## 背景与目标

群聊里很多人不会用 bot：先发问题，下一条才 `@Bot`。

现状（`lib/agent/gateway.ts`）：

1. 未 `@` 的消息 → gateway 丢弃（`!triggered` return），只由 `message-buffer` 写入 `group_messages`。
2. 纯 `@Bot` 无正文无图 → 回用法说明「问我请 @我…」（`empty-after-mention`）。
3. `@Bot` 带短正文（如「帮我看看」）→ 只把本条送进 agent，上文丢失。

**目标**：每次被 `@` 且将进入 agent 时，把 **@ 者本人** 在本群、**当前对话纪元（prior_since）之后**、**最多 10 条** 文本发言作为上下文交给 agent，覆盖「先问后 @」与「@ + 短补充」。

**非目标**（YAGNI）：

- 不拉同群其他人消息。
- 不改「必须 @ 才进主链路」的门控。
- 不改主动回复 / 反思 / 问题排行 poller。
- 不做条数/时间窗/预算的后台可配置 UI（常量即可）。
- 不回看图片/引用/转发历史（当前条的 `images`/`quoted`/`forwarded` 仍按现有逻辑）。

## 选定方案

**Gateway 查库 + 拼 preamble 进 `QualifiedMessage.text`**（方案 A）。

- 原料：`group_messages` 已有全量缓冲（含未 @ 消息）。
- 改动面：`repo` 查询 + 会话 `prior_since` + 索引 + `gateway` 拼接；orchestrator / agent 无需新字段。
- 意图门 `classify(probe)` 自动看到历史（probe 含 `q.text`）。

## 行为规格

### 触发（不变）

- `botMentioned` 或 `isAtTrigger(atList, botQQ, extraAtQQs)` 为真才继续。
- 未 `@` → 不查 prior、不 emit `message.qualified`。

### 正文归一化（C2）

全文统一：

```ts
const body = (msg.rawText ?? "").trim()
const hasBody = body.length > 0
const hasImages = !!msg.images?.length
```

「无正文」= `!hasBody`。空格/换行/制表符的 `@` 与纯 `@` 同等。  
空消息门、占位文案、`lastQuestion`、`formatPriorContext` 的 current 参数均用 `body`，不用裸 `rawText` 真值判断。

### 对话纪元 `prior_since`（C1）

产品语义：**当前对话纪元内**该用户在本群的近期发言，不是「该用户有史以来任意 10 条」。

| 项 | 规则 |
|----|------|
| 存储 | `sessions.prior_since INTEGER NULL`（毫秒；`NULL`/缺行 = `0`，即无下界） |
| 查询下界 | `created_at > prior_since`（严格大于） |
| 何时推进 | `clearResumeId(key)`、`clearAllResumeIds()`（见下） |
| 推进值 | SQLite `unixepoch('subsec')*1000`（与列默认一致，避免 JS/DB 时钟分叉） |
| 管理面 `!reset <sessionKey>` | 调 `clearResumeId` → 推进该 key |
| 不推进 | 普通 `@`、转人工、human-mode 进出（除非同时 reset） |

#### 重置命令不得成为新 prior（第二轮 Critical）

时序：gateway 内 `clearResumeId`（写 `prior_since=now`）→ 之后 message-buffer 才可能把本条「重置」写入 `group_messages`，其 `created_at` 往往 **>** `prior_since`，下一轮纯 `@` 会把「重置」当 prior 进 agent，验收失败。

**强制规则：**

1. **`message-buffer` 不缓冲** 与 gateway 相同的整句命令：`RESET_KEYWORDS` / `HELP_KEYWORDS` / `HANDOFF_KEYWORDS`（精确匹配，与 gateway 同源正则或抽到 `lib/agent/command-keywords.ts` 共享）。
2. 管理面 `!reset` / `!resume` 本就不在生效群用户路径；无需额外处理。
3. 不靠 `prior_since + 1ms` 等脆弱时钟技巧。

端到端测例：缓冲两条业务消息 → 用户 `@`「重置」→ buffer **无**「重置」行且 `prior_since` 已推进 → 再纯 `@` → **用法说明**（无 prior），不得进 agent。

#### `clearResumeId` / `clearAllResumeIds`

- **`clearResumeId(key)`**：upsert 语义——行不存在则 `INSERT (key, resume_id=NULL, prior_since=now)`；存在则 `resume_id=NULL, prior_since=now, updated_at=now`。
- **`clearAllResumeIds()`**（第二轮 Important）：
  1. 返回值语义保持：**仅** `resume_id IS NOT NULL` 的行数（后台文案「清了 N 个会话」不变）。
  2. 另执行：`UPDATE sessions SET prior_since = now, updated_at = now` **对全部 sessions 行**（含本已 `resume_id IS NULL` 的遗留行），避免「已无 resume 但 prior_since 仍 NULL」的会话在一键重置后仍带全历史 prior。

### 回看规则

| 项 | 规则 |
|----|------|
| 维度 | `channel` + `chatId` + **同一 `userId`** + `created_at > prior_since` |
| 上限条数 | `PRIOR_USER_CONTEXT_LIMIT = 10` |
| 字符预算 | `PRIOR_CONTEXT_MAX_CHARS = 2000`（见下） |
| 角色 | 不按 `sender_role` 过滤 |
| 文本 | 仅 `length(trim(text)) > 0` |
| 稳定顺序（I1） | SQL：`ORDER BY created_at DESC, id DESC LIMIT ?`；应用层 reverse → 升序 `(created_at ASC, id ASC)` |
| 排除本条 | `excludeMessageId = msg.messageId`（防御 listener 顺序变更） |
| 注册顺序 | `assemble` 中 `registerGateway` **必须**在 `registerMessageBuffer` 之前（注释锁定） |

### 字符预算（I3）

在已取到的最多 10 条（升序）上再裁：

1. **当前消息优先**：`body` 不计入 prior 预算；始终完整保留（若单条极长，与改前一致，不在本特性截断）。
2. **prior 从新到旧**纳入，累计 `format` 后文本长度（含列表前缀）≤ `PRIOR_CONTEXT_MAX_CHARS`；放不下的更旧消息丢弃。
3. **单条 prior 上限** `PRIOR_LINE_MAX_CHARS = 400`：超出则 `trim` 后截断并加 `…`。
4. 多行 prior：`trim` 后，内部换行改为续行缩进 `"  "`，保证每条视觉上仍是一个列表项（M2）。

### 空 @ 行为

| 情况 | 行为 |
|------|------|
| `!hasBody && !hasImages && prior.length === 0` | 用法说明 + `empty-after-mention` |
| `!hasBody && !hasImages && prior.length > 0` | **进 agent** |
| 纯图 @ | 仍放行；有 prior 则附上 |
| `hasBody` | 本条 + prior 一并进 prompt |

### 拼接格式

有 prior 时：

```
【用户近期发言（@前，旧→新）】
- 怎么充值？
- 第一行
  续行缩进
【当前消息】
帮我看看
```

纯 @ 有 prior：`【当前消息】` 下为  
`（用户仅 @ 了 bot，无新正文；请结合近期发言作答）`。

无 prior：`text === body`（可为空串），**不**包壳。

`lastQuestion`：`body || priorTexts[priorTexts.length - 1] || ""`（空则不写）；截断仍走现有 `setLastQuestion` 的 500 字逻辑。

### 分支顺序（M1）

在 `triggered` 且 dedupe 通过后：

1. **human-mode**（与现网一致；重置关键词在人工模式下仍可清上下文——现逻辑保留，并经 `clearResumeId` 推进 `prior_since`）。
2. **重置 / 帮助 / 转人工**——只匹配 `body`（归一化后的 rawText），**不**查 prior。
3. **查 prior**（try/catch 降级）。
4. **空消息门**：`!hasBody && !hasImages && prior.length === 0` → 用法说明。
5. `setLastQuestion` + emit `message.qualified`。

这样「帮助/重置/转人工」不付 prior 查询成本；空 `@` 仍能在步骤 3–4 决定帮助 vs 进 agent。

### 查库失败（I4）

- try/catch：prior = `[]`，主链路继续（空 @ → 用法说明；有正文 → 仅当前条）。
- `bus.emit("error.occurred", { scope: "gateway.prior-context", err, sessionKey, channel, chatId })`。
- 测例必覆盖。

## 组件改动

### 1. Schema / 迁移（`lib/db/index.ts`）（第二轮 Critical：可执行升级）

现网已是 `user_version = 2`；`CREATE TABLE IF NOT EXISTS sessions` **不会**给已有表加列。必须写清升级路径：

**`user_version` 3**

```
migrate():
  if version < 2: …现有 v1→v2…
  if version < 3:
    // 幂等：已是 v2 的生产库 / 刚升到 2 的库
    ensureSessionsPriorSince(db)   // 见下
    ensureGmUserTimeIndex(db)
    setUserVersion(db, 3)
  else:
    createV2Tables(db, dim)       // 最终形态 DDL 含 prior_since
    ensureSessionsPriorSince(db)  // 双保险
    ensureGmUserTimeIndex(db)
```

**`ensureSessionsPriorSince`**

```ts
if (tableExists(sessions) && !tableColumns(sessions).has("prior_since")) {
  db.exec("ALTER TABLE sessions ADD COLUMN prior_since INTEGER")
}
```

**`createV1Tables` / `createV2Tables` 的 sessions DDL** 同步写入 `prior_since INTEGER`，保证全新库建表即带列。

**索引**

```sql
CREATE INDEX IF NOT EXISTS idx_gm_channel_group_user_time
  ON group_messages(channel, group_id, user_id, created_at, id);
```

（与现有索引风格一致，不依赖 DESC 索引；查询 `ORDER BY created_at DESC, id DESC` 仍可走该前缀。）

**迁移测例**：打开已是 v2、无 `prior_since` 的 fixture 库 → `openDb` 后列存在、读写 `priorSince`/`clearResumeId` 不抛。

### 2. `Repo`（`lib/db/repo.ts`）

**`clearResumeId` / `clearAllResumeIds`**：清 `resume_id` 同时 `prior_since = unixepoch('subsec')*1000`。  
无 sessions 行时：`clearResumeId` 应 `INSERT ... prior_since=now` 或 upsert，保证后续查询有下界（重置时用户可能尚无 session 行——用户关键词重置路径会先有 sessionKey；`!reset` 亦然。若行不存在，upsert 建行只写 `prior_since`）。

**`priorSince(sessionKey): number`**：读 `prior_since ?? 0`。

**`recentUserGroupMessages`**：

```ts
recentUserGroupMessages(
  channel: string,
  chatId: string,
  userId: string,
  limit: number,
  opts?: {
    excludeMessageId?: string | null
    sinceTs?: number // 默认 0；created_at > sinceTs
  }
): { text: string; createdAt: number; messageId: string | null; id: number }[]
```

SQL：

```sql
SELECT id, text, created_at, message_id FROM group_messages
WHERE channel = ? AND group_id = ? AND user_id = ?
  AND length(trim(text)) > 0
  AND created_at > ?
  AND (? IS NULL OR message_id IS NULL OR CAST(message_id AS TEXT) != ?)
ORDER BY created_at DESC, id DESC
LIMIT ?
```

（`message_id` 类型以现表为准；比较时统一转 string，与 `IncomingMessage.messageId` 一致。）

应用层 reverse → 升序。`limit <= 0` → `[]`。

### 3. 命令关键词共享（新小文件，可选但推荐）

`lib/agent/command-keywords.ts`：导出 `RESET_KEYWORDS` / `HELP_KEYWORDS` / `HANDOFF_KEYWORDS`（从 gateway 挪出或 re-export），供 gateway 与 message-buffer 共用，避免两处正则漂移。

### 4. `gateway`（`lib/agent/gateway.ts`）

导出常量与纯函数（单测友好）：

- `PRIOR_USER_CONTEXT_LIMIT = 10`
- `PRIOR_CONTEXT_MAX_CHARS = 2000`
- `PRIOR_LINE_MAX_CHARS = 400`
- `formatPriorContext(prior: string[], currentBody: string): string`
- `clipPriorTexts(texts: string[], maxChars, lineMax): string[]`（从新到旧纳入）

接线见「分支顺序」。

### 5. `message-buffer`

在现有过滤之后增加：若 `RESET_KEYWORDS|HELP_KEYWORDS|HANDOFF_KEYWORDS` 命中 `rawText` → **不** `bufferGroupMessage`。单测覆盖。

### 6. orchestrator / agent

无 API 变更。

### 7. `assemble.ts`

gateway / message-buffer 注册处注释：顺序依赖 + prior 排除本条的双保险。

## 数据流

```
message.received
  ├─ gateway (先于 buffer)
  │    ├─ !@ / 未生效 → return
  │    ├─ dedupe
  │    ├─ human-mode / 重置 / 帮助 / 转人工（仅 body；重置→clearResumeId→prior_since）
  │    ├─ recentUserGroupMessages(..., sinceTs=priorSince(sessionKey))
  │    ├─ 空@且无 prior → help
  │    └─ message.qualified { text: formatPriorContext(clipped, body) }
  └─ message-buffer
       └─ bufferGroupMessage(当前条)
```

## 测试计划

### `tests/lib/db/repo.test.ts`

- 同用户多条、他人消息、空文本、`sinceTs`、`excludeMessageId`。
- 相同 `created_at` 不同 `id` → 升序稳定（I1）。
- `clearResumeId` 推进 `prior_since`；其后 `recentUserGroupMessages` 看不到边界前消息。

### `tests/lib/agent/gateway.test.ts`

- 预置两条历史 + 纯 `@` → qualified 含两条 + 占位；不发用法说明。
- 历史 + `@ 帮我看看` → 含历史与正文。
- 无历史纯 `@` / 仅空白 `@` → 用法说明 + `empty-after-mention`（C2）。
- 历史含「重置」+ 当前 `@ 订单呢` → 不误触重置。
- **重置后 prior 隔离（C1）**：缓冲 → `@` 成功带 prior → 用户「重置」→ 再纯 `@` → 用法说明。
- 查库抛错（I4）：mock/spy repo 方法 throw → 有正文仍 qualified（无 prior 壳）；无正文 → help；`error.occurred` 一次且含 `sessionKey/channel/chatId`。
- 超长 prior（I3）：单条 >400 被截断；总长受 2000 约束，保留较新。
- 多行 prior（M2）：续行缩进。
- `lastQuestion`：有 body 用 body；纯 @ 用 prior 末条。
- 纯图无 prior：`text === ""` 仍放行（回归）。

### 索引（I2）

- 迁移存在；可选：内存库 `EXPLAIN QUERY PLAN` 含 `idx_gm_channel_group_user_time`（若测试环境易做则加，否则实现时手工验一次即可写进 plan）。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 重置后仍带旧上下文 | `prior_since` + 测例 C1 |
| 空白 `@` 误进 agent | 统一 `trim`（C2） |
| 同毫秒顺序乱 | `id` 次级排序（I1） |
| 高活跃群扫表 | 复合索引（I2） |
| 超长 prompt | 条数 + 字符预算 + 单行上限（I3） |
| 闲聊污染 | 仅本人、纪元内、≤10 条 |
| listener 顺序 | 注释 + `excludeMessageId` |
| 关键词误触 | 只匹配 `body`；查 prior 在关键词之后 |

## 实现顺序（供 plan）

1. Schema：`user_version` 3 + `ensureSessionsPriorSince` + 复合索引；v2 fixture 升级测  
2. Repo：`clearResumeId` upsert 推进纪元、`clearAllResumeIds` 全表 `prior_since`、`priorSince`、`recentUserGroupMessages` + 单测  
3. 抽 `command-keywords`；message-buffer 跳过命令句 + 单测  
4. `formatPriorContext` / `clipPriorTexts` + gateway 接线 + 单测（含重置隔离）  
5. assemble 注释  
6. `pnpm typecheck && pnpm lint && pnpm test`  

## 验收标准

- 先发「怎么充值？」再纯 `@Bot` → 进 agent 作答，不回用法说明。  
- 先发问题再 `@Bot 支付宝行吗` → agent 同时看到问题与补充。  
- 无历史 / 仅空白的纯 `@` → 与改前一致（用法说明）。  
- 「重置」后再纯 `@` → 不带重置前缓冲。  
- 未 `@` 仍不触发主链路。  

## 审查记录

| 轮次 | 结论 | 处理 |
|------|------|------|
| Codex #1 | Block：C1 会话边界、C2 trim；I1–I4 | `prior_since`、统一 trim、id 排序、索引、预算、失败测 |
| Codex #2 | Block：重置入缓冲成 prior；v2 无补列路径；clearAll 范围 | buffer 跳过命令句；`user_version` 3 幂等补列；`clearAllResumeIds` 全表推进 prior_since |
| M1/M2 | Minor | 查库时机后移；多行缩进 |
