# Channel 插件化 + Telegram 接入设计

日期：2026-07-17  
分支：`feat/channel-telegram`（待开）  
状态：**已按 Codex 审查修订**（有条件通过 → 本稿吸收必须改项）

## 1. 背景与目标

`prayer` 当前整条消息链路默认 **QQ + OneBot**：

- IO 层：`lib/onebot/*`（正向 WS、CQ 码、`send_group_msg`）
- 领域事件：`IncomingMessage` / `ActionSend` 等 ID 全是 `number`
- 会话：`sessionKey = \`${groupId}:${userId}\``
- 去重：`seen_messages.message_id INTEGER PRIMARY KEY`（假定 message_id 近似全局唯一）
- 配置 / 后台：单条 OneBot 连接、数字群号白名单、名称缓存

核心 Agent（意图门、SDK 会话、KB、反思、排行、主动补位）**不直接调 OneBot API**，经 event bus 解耦，可复用。

**目标（第一期）**：

1. 抽出可插拔 **Channel** 层：平台 IO 与业务彻底分离。
2. 实现 **qq**（现有 OneBot 迁入）+ **tg**（Telegram Bot API long polling）。
3. **QQ + TG 双通道并行**；群聊 @bot 触发；文本为主，图片按 Phase 开关。
4. 旁路（缓冲、反思、排行、主动补位）在 **满足 TG 前置条件** 后按 channel 全接入；不满足则该 chat 旁路降级并在状态中可见。
5. **预留 Discord**：`ChannelId` 与目录约定到位，**不写实现**。
6. 管理侧第一期：**不做** TG 转人工通知 / TG 管理群命令；管理通知仍走 **QQ `adminGroupId`**（若配置）。

**非目标（第一期）**：

- Discord 实现、TG 私聊客服、Webhook 模式、TG 管理群、跨通道统一转人工工作台。
- 管理后台全面多平台 UI 重做（Phase 1 只做配置 API + 状态；UI 打磨 Phase 3）。
- Forum 超级群 topic 完整支持（见 §5.2：一期 **忽略带 `message_thread_id` 的 update**）。

## 2. 关键决策（已确认 + 审查锁定）

| 维度 | 决策 |
|------|------|
| 架构 | **方案 C：完整 Channel 插件化**（为 Discord 预留） |
| 场景 | **仅群聊**（对齐 QQ；忽略 TG 私聊 / 频道 / forum topic） |
| 并存 | QQ + TG **双开并行**；同 token **单实例 poll**（pm2 fork 单实例，与现网一致） |
| 触发 | 群内 **@bot**（TG：entities mention / text_mention，UTF-16 offset 剥前缀） |
| 消息能力 | Phase 1：**纯文本 + 引用**；Phase 2：图片下载入 Agent（有大小/超时上限） |
| 连接 | TG：**long polling**；QQ：现有正向 WS |
| 旁路 | 全接入，但依赖 §5.2 TG 前置（关 Privacy Mode + 管理员角色缓存） |
| Handoff | **显式 policy**（非 capability 路由）：用户回复回原 channel；管理通知 **仅 QQ admin** |
| 管理命令 | `!reset` / `!resume` 仅 QQ adminGroupId |
| 库 | **grammY** |
| edited_message | **一期忽略**（只处理 `message`） |
| Runtime | `start/stop/reconfigure` 改为 **async**；`startAll` 用 `allSettled` |

## 3. 架构总览

```
                    ┌──────────── Event Bus ────────────┐
                    │ message.received / qualified      │
                    │ reply.ready / action.send         │
                    │ handoff.* / error.* / resolution  │
                    └──────────▲───────────▲────────────┘
                               │           │
         ┌─────────────────────┴───┐   ┌───┴─────────────────────┐
         │ ChannelRegistry         │   │ Agent 核心（平台无关）    │
         │  - qq (OneBot)          │   │ Gateway / Orchestrator  │
         │  - tg (Bot API poll)    │   │ Buffer / Reflect / …    │
         │  - discord (二期 stub)  │   │ Handoff / Error         │
         └─────────────────────────┘   └─────────────────────────┘
```

### 3.1 核心原则

1. **Channel 只做 IO + 协议映射**（收 → `IncomingMessage`；订 `action.send` 且 `channel===自己` → 发）。
2. **业务只认** `channel` + **string** `chatId` / `userId` / `messageId`。
3. **Registry** 管生命周期；**disposer 唯一所有者**（assemble + registry），**禁止**依赖 `bus.removeAllListeners()` 作为正常路径（可保留 debug 断言：stop 后 listener 数为 0，失败只打 warn）。
4. **Capability 描述平台能力**，**不替代业务 policy**（handoff 路由见 §7.3）。
5. **未注册 channel** 的 `ActionSend` → 受控 `error.occurred`（scope `channel.unregistered`），禁止静默丢弃。
6. Discord：类型 + `lib/channels/discord/README.md`；不注册 builder。

### 3.2 目录

```
lib/channels/
  types.ts
  registry.ts
  ids.ts                 # sessionKey / dedupeKey / parseSessionKey / legacy 迁移
  enabled-chats.ts       # 统一 isChatEnabled / listEnabledChats（禁止业务 if-else 散落）
  qq/                    # 自 lib/onebot 迁入
  tg/
    client.ts
    parse.ts
    enrich.ts
    media.ts
    admins-cache.ts      # getChatAdministrators + TTL
    trigger.ts
  discord/README.md
lib/onebot/*             # 过渡期 thin re-export → channels/qq
lib/events.ts
```

## 4. 领域模型与 ID

### 4.1 事件类型（`lib/events.ts`）

```ts
export type ChannelId = "qq" | "tg" | "discord"

export interface IncomingMessage {
  channel: ChannelId
  chatId: string
  userId: string
  messageId: string
  rawText: string
  atList: string[]
  /** channel parse 填写；gateway 优先。QQ 也可由 atList 回退计算 */
  botMentioned?: boolean
  senderRole?: "owner" | "admin" | "member" | string
  images?: ImageInput[]
  quoted?: string
  forwarded?: string
}

export interface QualifiedMessage {
  channel: ChannelId
  sessionKey: string
  chatId: string
  userId: string
  messageId: string
  text: string
  images?: ImageInput[]
  quoted?: string
  forwarded?: string
}

export interface ReplyReady {
  channel: ChannelId
  chatId: string
  text: string
  replyToId?: string
}

export interface ActionSend {
  channel: ChannelId
  chatId: string
  text: string
  replyToId?: string
  /** 发送失败时 error 是否允许再触发用户兜底；默认 false（仅日志） */
  userVisibleOnFailure?: boolean
}

export interface ErrorOccurred {
  scope: string
  err: unknown
  sessionKey?: string
  channel?: ChannelId
  chatId?: string
  /** 是否允许对该 chat 再发用户可见兜底；channel.send 类 scope 必须 false */
  userVisible?: boolean
}

export interface HandoffRequested {
  channel: ChannelId
  sessionKey: string
  chatId: string
  userId: string
  lastQuestion: string
  reason?: "user" | "admin" | "system"
}

export interface ResolutionRecorded {
  kind: ResolutionKind
  sessionKey?: string
  channel?: ChannelId
  chatId?: string
  userId?: string
  detail?: string
}
```

**命名**：业务层统一 `chatId`。DB 列名可继续叫 `group_id` 但类型 **TEXT**，语义 = chatId。

### 4.2 键规则（`lib/channels/ids.ts`）

| 键 | 格式 | 示例 |
|----|------|------|
| `sessionKey` | `` `${channel}:${chatId}:${userId}` `` | `qq:123:456`、`tg:-100123:42` |
| `dedupeKey` | `` `${channel}:${chatId}:${messageId}` `` | |
| `chatRef` | `` `${channel}:${chatId}` `` | 白名单、游标、policy key |

- `parseSessionKey(key)`：唯一合法解析器；**禁止**业务 `split(":")` + `Number`。
- `legacySessionKeyToCanonical`：`gid:uid`（两段且无已知 channel 前缀）→ `qq:gid:uid`。
- 注意：`tg:-100xxx:uid` 含额外冒号式负号，解析必须按 **首段 channel + 末段 userId + 中间全部为 chatId**。

### 4.3 去重

- `seen_messages.dedupe_key TEXT PRIMARY KEY`。
- 迁移：**清空**旧表即可（短窗口防重放，可丢）。
- `repo.seenMessage(dedupeKey: string): boolean`。

### 4.4 @ 触发契约

| 通道 | 规则 |
|------|------|
| QQ | parse 填 `botMentioned`（atList ∩ {botQQ ∪ extraAtQQs}）；gateway 若缺省则 `isAtTrigger` 回退 |
| TG | `text_mention`：`entity.user.id === botId`；`mention`：规范化 username（去 `@`、小写）=== botUsername；按 entity **UTF-16** offset/length 从文本删除 mention |

Gateway：`if (!(msg.botMentioned ?? fallbackAt(msg))) return`。

## 5. Channel 接口与实现

```ts
export interface ChannelCapabilities {
  /** 平台是否具备「本通道管理侧通知」能力（未来用）；一期不用于 handoff 路由 */
  canNotifyOwnAdminSurface: boolean
  supportsAdminCommands: boolean
  supportsMemberList: boolean
  supportsGroupList: boolean
  supportsMediaDownload: boolean
  /** 旁路（反思/补位）是否具备可靠 senderRole + 全量消息 */
  supportsBypassPipeline: boolean
}

export interface Channel {
  readonly id: ChannelId
  readonly capabilities: ChannelCapabilities
  start(): Promise<void>
  stop(): Promise<void>
  isConnected(): boolean
  status(): ChannelStatus  // connected, lastError, detail (offset 等)
  listChats?(): Promise<{ id: string; name: string }[] | undefined>
  listMembers?(chatId: string): Promise<unknown[] | undefined>
}
```

### 5.1 QQ Channel

- 能力：除文档化外全部 true；`supportsBypassPipeline: true`。
- `action.send`：**仅** `channel === "qq"`（迁移首日必须过滤，防 TG 动作被 OneBot 误发）。
- id 全部 `String(...)`；填 `botMentioned`。

### 5.2 TG Channel

**部署前置（写入 README / 配置页说明 / 验收清单）**：

1. BotFather **关闭 Group Privacy Mode**（否则收不到非 @ 群消息 → 反思/补位原料不足）。
2. Bot 已加入目标超级群；`telegramEnabledChats` 填 **字符串** chat_id（可负，禁止 Number 比较）。
3. **单进程 poll**：与现 pm2 fork 单实例一致；多实例同 token → 409，状态 `lastError`，不假装健康。

**角色填充（旁路前置）**：

- `getMe` 后缓存 `botId` / `username` 于 **channel 内存**（不回写 AppConfig，避免与后台保存竞态）。
- `admins-cache`：`getChatAdministrators(chatId)`，TTL 建议 10–30 min；未知 chat 首次消息强制刷新。
- parse 时：`userId ∈ admin set` → `senderRole = creator? owner : admin`，否则 `member`。
- 缓存失败 / Privacy 未关导致几乎只有 bot 相关消息：该 chat `supportsBypassPipeline` 运行时降级为 false，**强制关闭**该 chat 的反思与主动补位；主链路 @ 问答仍可用；`ChannelStatus.detail` 写明原因。

**其它**：

- Long poll timeout 25–30s；offset 键 `tg:update_offset`。
- **Offset 提交点**：仅当本 update 已 `emit("message.received")`（或明确丢弃：非群/无资格）**之后**推进；enrich 失败仍 emit 降级消息再推进；**不得**在 enrich 前推进导致丢消息。
- 只处理 `message`（**忽略 `edited_message`**）。
- 忽略 `private` / `channel`；**忽略带 `message_thread_id` 的消息**（forum），避免回错 General。
- 发送：`sendMessage`；文本超 4096 再拆；`reply_to_message_id`。
- Phase 1：`supportsMediaDownload: false`（不下载图）。
- Phase 2：开启下载，限制 maxBytes（如 5MB）、timeout、MIME、失败降级无图。

### 5.3 Registry + Runtime

```ts
// startAll: Promise.allSettled — 单通道失败不回滚另一通道
// stopAll: 先 abort poll → await loop exit → off action.send → 清 registry
```

`RuntimeManager`：

- `start/stop/reconfigure(): Promise<void>`（`instrumentation` / 配置热更 `await`）。
- 持有 `ChannelRegistry`，不再 `client: OneBotClient` 单槽。
- QQ 专用 API（群列表/成员）：`registry.get("qq")?.listChats/listMembers`。
- 状态：`channels: ChannelStatus[]`；兼容字段 `wsConnected` = qq.connected（过渡一期可留）。
- 用量告警等：`ActionSend { channel:"qq", chatId: String(adminGroupId), ... }`。
- stop：**优先** registry + assemble disposer；`removeAllListeners` 降为开发断言或删除。

## 6. 数据模型与迁移

### 6.1 版本化

- 使用 `PRAGMA user_version`（或 `schema_migrations` 表）。
- 每个破坏性步骤：单事务「建新表 → 拷贝/转换 → 建索引 → 校验行数 → drop 旧表 → rename → 升 version」。
- 迁移必须 **可重跑**（version 已到则 no-op）。

### 6.2 迁移矩阵

| 对象 | 旧 | 新 | 策略 |
|------|----|----|------|
| `seen_messages` | `message_id INTEGER PK` | `dedupe_key TEXT PK` | 清空重建 |
| `group_messages` | int ids，`UNIQUE(message_id)` | `channel TEXT` + TEXT ids，`UNIQUE(channel, group_id, message_id)`，索引 `(channel, group_id, created_at)` | 重建表；旧行 `channel='qq'`，id `CAST` 为 TEXT |
| `proactive_replies` | int group/user | +channel，TEXT ids | 重建/加列+回填 |
| `resolution_events` | int | +channel，TEXT；`session_key` 迁 canonical | 更新 key + 加列 |
| `question_occurrences` | int | +channel，TEXT | 重建/加列 |
| `reflection_meta` | group_id int | +channel，chat TEXT | 回填 qq |
| `sessions.key` | `gid:uid` | `qq:gid:uid` | `UPDATE` + 冲突保留较新 `updated_at` |
| `tickets.session_key` | 同上 | canonical | 同上 |
| config 游标 | `reflect_cursor:{gid}` 等 | `reflect_cursor:qq:{gid}` | 键重命名 |
| `groupPolicies` JSON | `"123": {...}` | `"qq:123": {...}` | 读时兼容双格式，写时只写新 |
| `kb_chunks.source` | `human-reflection:{gid}:{ts}` | `human-reflection:{channel}:{chatId}:{ts}` | 写入新格式；**读解析兼容旧三段式**（默认 channel=qq） |

### 6.3 配置

```ts
// 新增
telegramBotToken: string              // 空 = 不注册 tg channel
telegramEnabledChats: string[]        // trim、去重、保留原始字符串（含负号）
// 不把 username 持久进 AppConfig 运行回写；可选只读缓存键 tg:bot_username 供展示

// 保留
enabledGroups: number[]               // QQ 生效群
adminGroupId: number                  // QQ only
groupPolicies: Record<string, GroupPolicy>  // key = chatRef
```

- `lib/channels/enabled-chats.ts`：`listEnabledChats(cfg): {channel, chatId}[]`、`isChatEnabled(cfg, channel, chatId)`。
- env：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_ENABLED_CHATS`。
- **API**：`/api/config` 接受 TG 字段；token **掩码** + 空串不覆盖（与 onebot token 相同，`lib/api.ts`）。
- **Phase 1 必须**：`/api/status` 返回 `channels[]`（connected / lastError / detail）。

### 6.4 Repo

所有按群读写改为 `(channel, chatId: string)`，包括但不限于：

`bufferGroupMessage`、`seenMessage`、`groupReflectCursor` / `set*`、`topicCursor`、`proactiveCursor`、`listGroupMessages*`、`insertQuestionOccurrence`、`insertResolution`、反思 source 解析、活动统计。

## 7. 业务层改造

### 7.1 Gateway

- 生效门：`isChatEnabled`；QQ 管理群特例 `channel==="qq" && chatId===String(adminGroupId)`。
- 管理命令：仅 QQ admin + `supportsAdminCommands`。
- 去重 / sessionKey / botMentioned 见上。
- **Handoff 关键词 policy**（显式，不用 capability 路由）：
  - **用户回复**：始终 `action.send` 回 `e.channel` + `e.chatId`。
  - **管理通知**：仅当 **来源 channel 为 qq** 且 `adminGroupId > 0` 且群策略允许 → `action.send` 到 QQ admin。
  - **TG 来源**：不 emit `handoff.requested` 也可；或 emit 但 handler 跳过 admin 通知，只回用户侧「请走 supportUrl」文案。推荐 **gateway 内对 TG 短路**，少一条无管理路径的事件。

### 7.2 Orchestrator / Reply mapper / Resolution

- 全链路透传 `channel` + string ids（ACK、拦截、正常答、`resolution.recorded`）。
- Reply mapper：透传 channel；**删除** `action: "send_group_msg"`。
- Agent metadata：string chat/user + channel。

### 7.3 Handoff / Error

- Handoff resume：`parseSessionKey` → 原 channel 回用户；admin 抄送固定 QQ。
- **Error handler**：禁止从 sessionKey 猜 number groupId。优先 `error.channel` + `error.chatId`；缺失则 `parseSessionKey(sessionKey)`；再缺失则只日志。
- scope 以 `channel.send` / `channel.unregistered` 开头的 **禁止** 再发用户可见消息（防循环）。

### 7.4 Buffer / 反思 / 排行 / 补位

- 写入带 channel；扫描 `listEnabledChats`。
- TG chat 若 `!supportsBypassPipeline`（运行时）：跳过反思与主动补位。
- 管理通知类（reflect / compact / promote / budget）：一律 `channel: "qq"` + adminGroupId。
- 后台 API（activity / proactive / reflection / ranking）Phase 2 起返回 channel 字段；Phase 0/1 QQ 路径保持兼容。

### 7.5 Message buffer bot 自过滤

- 不再写死 `userId === botQQ`；改为 channel 提供 `isBotUser(userId)` 或 deps 传入各 channel bot id 集合。

## 8. 配置与后台

| 阶段 | 内容 |
|------|------|
| Phase 0/1 API | TG token 掩码、enabled chats、status.channels |
| Phase 3 UI | 配置页表单项、状态灯分通道、文案说明 Privacy Mode |

## 9. 错误与韧性

- TG：网络退避；401/409 → lastError + 降速；**不**拖垮 QQ。
- 单 channel start 失败：另一通道继续；runtime 仍可为 `running`（assemble 成功）。
- 未连接发送：log + `error.occurred`（userVisible=false）。

## 10. 测试策略

- 单元：ids（含负 chatId 三段+）、TG parse（群/@/私聊忽略/forum 忽略/UTF-16 mention）、enabled-chats、admins-cache 角色。
- Gateway：双通道门、TG handoff 无管理抄送、QQ 管理命令。
- Error：canonical sessionKey 能回 TG 用户；channel.send 不循环。
- Repo：迁移可重跑、复合唯一、游标键迁移、source 双格式解析。
- Registry：action 路由隔离；startAll 一成一败。
- 回归：现有 onebot/agent 测试全量改 string+channel 后转绿。

## 11. 分阶段交付（审查修订后）

### Phase 0 — 兼容层（原子，可先合 main）

事件 + **全部** bus 生产/消费方 + Repo 全量 + DB 迁移 + ids + enabled-chats + QQ Channel 接管 OneBot + Error/Handoff 解析修复 + Runtime async 骨架（可先只挂 qq）+ 配置掩码扩展点。  
**出口**：QQ 行为与现网一致，`pnpm typecheck && lint && test` 全绿。

### Phase 1 — TG 文字主链路 + 可运维

grammY poll、offset 语义、getMe、abort/stop、status.channels、token 配置 API、enabled chats、@ 触发、文本+引用问答、TG handoff 用户侧文案、Privacy/单实例文档。  
**不含**：图片入 Agent；旁路可先对 TG **关闭**（或仅缓冲不跑反思/补位）直到 admins-cache 就绪。

### Phase 2 — 旁路对齐 + 图片

关 Privacy 验收；admins-cache；反思/排行/补位扫 TG；图片下载入 Agent（限额）；后台 API 带 channel。

### Phase 3 — UI 打磨

配置页、状态灯、帮助文案。

### Phase 4 — Discord（另开 spec）

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| number→string 改动面 | Phase 0 原子合入 + 类型驱动 |
| 全局 message_id UNIQUE | 复合唯一 |
| sessionKey 解析 | 唯一 parseSessionKey；修 handoff/error/log-classify |
| Privacy Mode | 部署清单 + 旁路降级可见 |
| 多实例 409 | 单实例约束 + 状态错误 |
| bus.removeAllListeners | disposer 所有权 |
| 大图拖垮 poll | Phase 2 限额 |

## 13. 成功标准

1. QQ 全回归通过。  
2. TG 生效群 @bot 文本问答；session 与 QQ 隔离；不串通道。  
3. TG「人工」无管理群抄送；用户得 supportUrl 引导。  
4. 错误兜底能回到正确 channel 用户。  
5. 迁移可重跑；旧 QQ 数据可读。  
6. status 可区分 qq/tg 连接与 lastError。  
7. `pnpm typecheck && pnpm lint && pnpm test` 全绿。  
8. Discord 无运行时路径。

## 14. 绑定点清单（实现核对表）

必须改到 channel + string（或显式 getChannel("qq")）的锚点：

- `lib/events.ts`、`lib/assemble.ts`、`lib/runtime.ts`、`instrumentation.ts`
- `lib/agent/gateway.ts`、`orchestrator.ts`、`reply-mapper.ts`、`message-buffer.ts`
- `lib/agent/handoff-handler.ts`、`error-handler.ts`、`resolution-recorder.ts`
- `lib/agent/reflection-poller.ts`、`reflection-compactor.ts`、`reflection-promoter.ts`
- `lib/agent/topic-poller.ts`、`unanswered-poller.ts`
- `lib/log-classify.ts`、`lib/db/index.ts`、`lib/db/repo.ts`、`lib/config-store.ts`
- `lib/onebot/client.ts`（channel 过滤）、`lib/api.ts`、`app/api/config/route.ts`、`app/api/status/route.ts`
- `app/api/groups/activity`、`proactive`、`reflection`、`ranking`（Phase 2）
- `app/api/onebot/*` → `runtime.getChannel("qq")`
- 对应 `tests/**`

## 15. 开放问题（已默认）

| # | 默认 |
|---|------|
| 库 | grammY |
| enabled 配置 | 双字段（enabledGroups + telegramEnabledChats） |
| 表迁移 | 版本化重建 |
| Forum | 忽略带 thread id |
| edited | 忽略 |
| 图片 | Phase 2 |
| username 缓存 | 仅内存 / 独立只读键，不回写 AppConfig |

## 附录 A — 审查记录

- 审查方：Codex（read-only），结论 **有条件通过**。
- 本稿已吸收：TG 旁路前置与 admins-cache、版本化迁移矩阵与 source 格式、Runtime async/allSettled/offset 语义、Error 显式路由、edited/media/phase 边界、handoff policy、status/token API 前移、forum 策略、绑定点清单。

## 附录 B — 旧→新事件对照

| 旧 | 新 |
|----|----|
| `groupId: number` | `channel + chatId: string` |
| `action: "send_group_msg"` | 删除；channel 自选 API |
| `sessionKey = gid:uid` | `channel:chatId:userId` |
| `seenMessage(messageId)` | `seenMessage(dedupeKey)` |
| 单 `OneBotClient` | `ChannelRegistry` |
