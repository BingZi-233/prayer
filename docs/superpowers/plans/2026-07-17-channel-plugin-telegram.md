# Channel 插件化 + Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将消息 IO 抽成可插拔 Channel（qq/tg，预留 discord），完成 QQ 行为零回归的兼容层后，接入 Telegram 群聊 @bot 文字客服（双通道并行）。

**Architecture:** Event bus 领域事件统一带 `channel` + string `chatId/userId/messageId`；`ChannelRegistry` 管理多 client 生命周期；业务（gateway/orchestrator/旁路）只认领域模型与 `enabled-chats`；TG 用 grammY long poll，管理通知仍走 QQ admin。

**Tech Stack:** Next.js 16、better-sqlite3、vitest、grammY、现有 event bus。Prettier 无分号双引号。测试在 `tests/`。

参考 spec：`docs/superpowers/specs/2026-07-17-channel-plugin-telegram-design.md`

**分支：** `feat/channel-telegram`

**验收总命令：** `pnpm typecheck && pnpm lint && pnpm test`

---

## 文件结构

### 新建

- `lib/channels/types.ts` — `ChannelId`、`Channel`、`ChannelCapabilities`、`ChannelStatus`
- `lib/channels/ids.ts` — sessionKey / dedupeKey / parseSessionKey / legacy 迁移
- `lib/channels/enabled-chats.ts` — `listEnabledChats` / `isChatEnabled`
- `lib/channels/registry.ts` — register / startAll / stopAll / get / status
- `lib/channels/qq/*` — 自 `lib/onebot` 迁入的实现（client/parse/enrich/media/…）
- `lib/channels/tg/client.ts`、`parse.ts`、`enrich.ts`、`media.ts`、`admins-cache.ts`、`trigger.ts`
- `lib/channels/discord/README.md` — 二期占位
- `tests/lib/channels/ids.test.ts`、`enabled-chats.test.ts`、`tg/parse.test.ts`、`registry.test.ts`

### 修改（Phase 0 必改）

- `lib/events.ts` — 全量 channel + string ids
- `lib/db/index.ts` — `user_version` 迁移矩阵
- `lib/db/repo.ts` — 读写签名
- `lib/config-store.ts` — TG 字段 + policy key 兼容
- `lib/assemble.ts`、`lib/runtime.ts`、`instrumentation.ts`
- `lib/agent/gateway.ts`、`orchestrator.ts`、`reply-mapper.ts`、`message-buffer.ts`
- `lib/agent/handoff-handler.ts`、`error-handler.ts`、`resolution-recorder.ts`
- `lib/agent/reflection-poller.ts`、`reflection-compactor.ts`、`reflection-promoter.ts`
- `lib/agent/topic-poller.ts`、`unanswered-poller.ts`
- `lib/log-classify.ts`、`lib/api.ts`
- `lib/onebot/*` — re-export 或迁走
- `app/api/status/route.ts`、`app/api/config/route.ts`
- `app/api/onebot/*` — `getChannel("qq")`
- 全部相关 `tests/**`

### 修改（Phase 1）

- `lib/channels/tg/*`、`package.json`（grammY）、`next.config.ts`（若需 external）
- 配置 API 掩码、status.channels 展示数据

### 修改（Phase 2+）

- 旁路扫 TG、图片、后台 activity/ranking 带 channel、admin UI

---

## Task 1: ChannelId 工具与单测

**Files:**
- Create: `lib/channels/ids.ts`
- Create: `tests/lib/channels/ids.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest"
import {
  makeSessionKey,
  makeDedupeKey,
  parseSessionKey,
  legacySessionKeyToCanonical,
} from "@/lib/channels/ids"

describe("channels/ids", () => {
  it("sessionKey 与 parse 往返（含 TG 负 chatId）", () => {
    const key = makeSessionKey("tg", "-100123", "42")
    expect(key).toBe("tg:-100123:42")
    expect(parseSessionKey(key)).toEqual({
      channel: "tg",
      chatId: "-100123",
      userId: "42",
    })
  })

  it("legacy QQ 键升级", () => {
    expect(legacySessionKeyToCanonical("123:456")).toBe("qq:123:456")
    expect(legacySessionKeyToCanonical("qq:123:456")).toBe("qq:123:456")
  })

  it("dedupeKey", () => {
    expect(makeDedupeKey("qq", "1", "99")).toBe("qq:1:99")
  })

  it("非法 key 返回 null", () => {
    expect(parseSessionKey("nope")).toBeNull()
    expect(parseSessionKey("")).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run tests/lib/channels/ids.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `lib/channels/ids.ts`**

```ts
import type { ChannelId } from "./types"

const CHANNELS = new Set<string>(["qq", "tg", "discord"])

export function makeSessionKey(
  channel: ChannelId,
  chatId: string,
  userId: string
): string {
  return `${channel}:${chatId}:${userId}`
}

export function makeDedupeKey(
  channel: ChannelId,
  chatId: string,
  messageId: string
): string {
  return `${channel}:${chatId}:${messageId}`
}

export function makeChatRef(channel: ChannelId, chatId: string): string {
  return `${channel}:${chatId}`
}

/** 首段 channel，末段 userId，中间全部为 chatId（支持负号与多段） */
export function parseSessionKey(
  key: string
): { channel: ChannelId; chatId: string; userId: string } | null {
  if (!key) return null
  const i = key.indexOf(":")
  if (i <= 0) return null
  const channel = key.slice(0, i)
  if (!CHANNELS.has(channel)) return null
  const rest = key.slice(i + 1)
  const j = rest.lastIndexOf(":")
  if (j <= 0 || j === rest.length - 1) return null
  const chatId = rest.slice(0, j)
  const userId = rest.slice(j + 1)
  if (!chatId || !userId) return null
  return { channel: channel as ChannelId, chatId, userId }
}

export function legacySessionKeyToCanonical(key: string): string {
  const parsed = parseSessionKey(key)
  if (parsed) return makeSessionKey(parsed.channel, parsed.chatId, parsed.userId)
  // 旧 QQ: gid:uid
  const m = /^(\d+):(\d+)$/.exec(key)
  if (m) return makeSessionKey("qq", m[1], m[2])
  return key
}
```

同步最小 `lib/channels/types.ts`：

```ts
export type ChannelId = "qq" | "tg" | "discord"
```

- [ ] **Step 4: 测试通过并提交**

```bash
pnpm vitest run tests/lib/channels/ids.test.ts
git add lib/channels/ids.ts lib/channels/types.ts tests/lib/channels/ids.test.ts
git commit -m "feat(channels): 添加 session/dedupe 键工具"
```

---

## Task 2: 事件类型改为 channel + string

**Files:**
- Modify: `lib/events.ts`
- 暂不改消费者（下一步编译会红，按 Task 3+ 修）

- [ ] **Step 1: 重写 `lib/events.ts` 核心接口**

按 spec §4.1：`IncomingMessage` / `QualifiedMessage` / `ReplyReady` / `ActionSend` / `ErrorOccurred` / `HandoffRequested` / `ResolutionRecorded` 全部带 `channel?:` 或必填 `channel`，ID 改 `string`。

约定 Phase 0：**必填** `channel`（强制编译器扫全库）。

- [ ] **Step 2: `pnpm typecheck` 记录错误列表**

```bash
pnpm typecheck 2>&1 | head -80
```

用错误列表驱动后续 Task，不要一次手改漏文件。

- [ ] **Step 3: Commit 类型定义（可与 Task 3 同提交若希望 CI 不破）**

更稳妥：本 Task 与 Task 3–6 在同一工作分支连续完成后再 commit「Phase 0 类型迁移」大提交，或按模块小提交但保持分支可 typecheck。

推荐节奏：**每完成一类消费者 + 测试绿就 commit**。

---

## Task 3: DB 版本化迁移

**Files:**
- Modify: `lib/db/index.ts`
- Modify: `lib/db/repo.ts`
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写迁移测试**

```ts
describe("channel schema migration", () => {
  it("group_messages 支持 channel 与复合唯一", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const db = (repo as any).db as import("better-sqlite3").Database
    repo.bufferGroupMessage("qq", "100", "200", "member", "hi", "1")
    repo.bufferGroupMessage("tg", "100", "200", "member", "hi", "1") // 同数字不同 channel 不撞
    const n = (
      db.prepare("SELECT COUNT(*) n FROM group_messages").get() as { n: number }
    ).n
    expect(n).toBe(2)
  })

  it("seenMessage 用 dedupe_key", () => {
    const repo = new Repo(openDb(":memory:", 3))
    expect(repo.seenMessage("qq:1:2")).toBe(false)
    expect(repo.seenMessage("qq:1:2")).toBe(true)
  })

  it("legacy session key 可迁移为 canonical", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const db = (repo as any).db as import("better-sqlite3").Database
    db.prepare(
      "INSERT INTO sessions (key, session_id) VALUES (?, ?)"
    ).run("123:456", "sid")
    // 触发 migrate 已在 openDb；若 migrate 内含 sessions 升级：
    // 重新 open 或调用 migrateSessions
    repo.migrateLegacySessionKeys?.()
    const row = db
      .prepare("SELECT key FROM sessions")
      .get() as { key: string }
    expect(row.key).toBe("qq:123:456")
  })
})
```

- [ ] **Step 2: 实现 migrate**

在 `migrate()` 末尾根据 `PRAGMA user_version`：

1. `user_version < 2`：重建 `seen_messages` 为 `dedupe_key TEXT PK`（清空）。
2. 重建 `group_messages`：列 `channel TEXT NOT NULL DEFAULT 'qq'`，`group_id/user_id/message_id` TEXT，`UNIQUE(channel, group_id, message_id)`，索引 `(channel, group_id, created_at)`；从旧表 `CAST(id AS TEXT)` 拷贝。
3. 同类处理 `proactive_replies`、`resolution_events`、`question_occurrences`、`reflection_meta`。
4. `UPDATE sessions/tickets` 旧 key → `qq:…`（冲突保留 `updated_at` 较大者）。
5. config 键 `reflect_cursor:{n}` → `reflect_cursor:qq:{n}`（topic/proactive 同理）。
6. `PRAGMA user_version = 2`。

- [ ] **Step 3: 改 Repo 方法签名**

示例：

```ts
seenMessage(dedupeKey: string): boolean {
  const info = this.db
    .prepare("INSERT OR IGNORE INTO seen_messages (dedupe_key) VALUES (?)")
    .run(dedupeKey)
  return info.changes === 0
}

bufferGroupMessage(
  channel: string,
  chatId: string,
  userId: string,
  senderRole: string | null,
  text: string,
  messageId?: string | null
): void { /* INSERT OR IGNORE 含 channel */ }

groupReflectCursor(channel: string, chatId: string): number {
  return Number(this.getConfigRow(`reflect_cursor:${channel}:${chatId}`) ?? "0")
}
```

所有 `groupId: number` 查询改为 string + channel。`parseReflectionSource` 兼容：

- 新：`human-reflection:{channel}:{chatId}:{ts}`
- 旧：`human-reflection:{qqGroupId}:{ts}` → channel=qq

- [ ] **Step 4: 测试通过**

```bash
pnpm vitest run tests/lib/db/repo.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(db): channel 化 schema 与 repo 读写"
```

---

## Task 4: enabled-chats + config

**Files:**
- Create: `lib/channels/enabled-chats.ts`
- Create: `tests/lib/channels/enabled-chats.test.ts`
- Modify: `lib/config-store.ts`
- Modify: `lib/api.ts`、`app/api/config/route.ts`

- [ ] **Step 1: 实现**

```ts
// enabled-chats.ts
import type { ChannelId } from "./types"
import type { AppConfig } from "../config-store"

export function listEnabledChats(
  cfg: AppConfig
): { channel: ChannelId; chatId: string }[] {
  const out: { channel: ChannelId; chatId: string }[] = []
  for (const g of cfg.enabledGroups ?? []) {
    out.push({ channel: "qq", chatId: String(g) })
  }
  for (const c of cfg.telegramEnabledChats ?? []) {
    const id = String(c).trim()
    if (id) out.push({ channel: "tg", chatId: id })
  }
  return out
}

export function isChatEnabled(
  cfg: AppConfig,
  channel: ChannelId,
  chatId: string
): boolean {
  if (channel === "qq") {
    return (cfg.enabledGroups ?? []).some((g) => String(g) === chatId)
  }
  if (channel === "tg") {
    return (cfg.telegramEnabledChats ?? []).some((c) => String(c).trim() === chatId)
  }
  return false
}

export function policyKey(channel: ChannelId, chatId: string): string {
  return `${channel}:${chatId}`
}

/** 读 groupPolicies：先新键，再回退旧 QQ 裸数字键 */
export function getGroupPolicy(cfg: AppConfig, channel: ChannelId, chatId: string) {
  const p = cfg.groupPolicies ?? {}
  return p[policyKey(channel, chatId)] ?? (channel === "qq" ? p[chatId] : undefined)
}
```

AppConfig 增加：

```ts
telegramBotToken: string
telegramEnabledChats: string[]
```

seedFromEnv：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_ENABLED_CHATS`（逗号分隔，**保持字符串**，不要 `Number`）。

- [ ] **Step 2: API 掩码**

在 `lib/api.ts` 对 `telegramBotToken` 与 `onebotAccessToken` 同样 mask；PUT 空串不覆盖密钥。

- [ ] **Step 3: 测试 + commit**

```bash
pnpm vitest run tests/lib/channels/enabled-chats.test.ts
git commit -m "feat(config): Telegram 配置字段与 enabled-chats"
```

---

## Task 5: QQ Channel + Registry + Runtime async

**Files:**
- Create: `lib/channels/registry.ts`
- Move/adapt: `lib/channels/qq/client.ts`（自 onebot）
- Modify: `lib/runtime.ts`、`instrumentation.ts`、`lib/onebot/client.ts`（re-export 或 channel 过滤）

- [ ] **Step 1: QQ client 只处理本 channel**

```ts
private onAction = (a: ActionSend) => {
  if (a.channel !== "qq") return
  this.sendAction(a)
}
```

发送参数：`group_id: Number(a.chatId)`（QQ 仍为数字协议）；`IncomingMessage` emit 时：

```ts
{
  channel: "qq",
  chatId: String(groupId),
  userId: String(userId),
  messageId: String(messageId),
  botMentioned: /* atList 命中 */,
  ...
}
```

- [ ] **Step 2: Registry**

```ts
export class ChannelRegistry {
  private map = new Map<ChannelId, Channel>()
  register(ch: Channel) { this.map.set(ch.id, ch) }
  get(id: ChannelId) { return this.map.get(id) }
  async startAll() {
    const results = await Promise.allSettled(
      [...this.map.values()].map((c) => c.start())
    )
    // 记录 rejected → 各 channel status.lastError
    return results
  }
  async stopAll() {
    await Promise.allSettled([...this.map.values()].map((c) => c.stop()))
    this.map.clear()
  }
  status() { return [...this.map.values()].map((c) => c.status()) }
}
```

- [ ] **Step 3: RuntimeManager**

- `start/stop/reconfigure(): Promise<void>`
- 构造 qq channel（url/token 非空时）；tg 留 Task 9
- `getChannel("qq")` 供 `/api/onebot/*`
- stop：await registry.stopAll + teardown assemble；**不要**依赖 `removeAllListeners` 作为主路径（可 assert 后 warn）
- status 暴露 `channels`

- [ ] **Step 4: instrumentation await start**

```ts
await runtime.start(cfg, builders)
```

- [ ] **Step 5: 单测 registry 路由隔离 + runtime 相关测试修绿**

```bash
pnpm vitest run tests/lib/runtime.test.ts tests/lib/onebot/
git commit -m "feat(runtime): ChannelRegistry 与 QQ channel 接管"
```

---

## Task 6: Gateway / Reply / Handoff / Error / Orchestrator

**Files:** 见绑定清单 §14

- [ ] **Step 1: Gateway**

- `isChatEnabled(cfg, msg.channel, msg.chatId)`
- 管理群：`msg.channel === "qq" && msg.chatId === String(adminGroupId)`
- `seenMessage(makeDedupeKey(...))`
- `sessionKey = makeSessionKey(...)`
- 触发：`msg.botMentioned ?? isAtTrigger(msg.atList.map(Number)…)` — atList 已是 string 时改 string 比较
- TG handoff 关键词：直接用户文案 + supportUrl，**不** `handoff.requested`（Phase 1 起；Phase 0 可仅 QQ）

- [ ] **Step 2: Reply mapper**

```ts
bus.emit("action.send", {
  channel: r.channel,
  chatId: r.chatId,
  text,
  replyToId: i === 0 ? r.replyToId : undefined,
})
```

- [ ] **Step 3: Handoff**

- 用户回复用 `e.channel` / `e.chatId`
- 管理通知强制 `channel: "qq", chatId: String(adminGroupId)`
- resume：`parseSessionKey(e.sessionKey)` 回用户 channel

- [ ] **Step 4: Error handler**

```ts
const channel = e.channel ?? parseSessionKey(e.sessionKey ?? "")?.channel
const chatId = e.chatId ?? parseSessionKey(e.sessionKey ?? "")?.chatId
if (e.userVisible === false) return // 仅日志
if (channel && chatId) {
  bus.emit("action.send", { channel, chatId, text: fallback })
}
```

- [ ] **Step 5: Orchestrator / resolution** 透传 channel

- [ ] **Step 6: 全量 agent 测试**

```bash
pnpm vitest run tests/lib/agent/
git commit -m "feat(agent): 事件链路 channel 化与解析修复"
```

---

## Task 7: 旁路 Poller 与 Buffer（Phase 0 先 QQ 语义）

**Files:** message-buffer、reflection-*、topic-poller、unanswered-poller

- [ ] **Step 1:** buffer 写 `channel`；bot 自过滤用 deps `botUserIds: Set` 或 `isBotUser`
- [ ] **Step 2:** 扫描循环改为 `listEnabledChats`，Phase 0 可 filter `channel === "qq"` 若 TG 未上
- [ ] **Step 3:** 管理通知 `action.send` 一律 qq + adminGroupId
- [ ] **Step 4:** 测试修绿 + commit

```bash
pnpm vitest run tests/lib/agent/reflection-poller.test.ts tests/lib/agent/topic-poller.test.ts tests/lib/agent/unanswered-poller.test.ts tests/lib/agent/message-buffer.test.ts
git commit -m "feat(agent): 旁路与缓冲 channel 化"
```

---

## Task 8: Phase 0 验收

- [ ] **Step 1:**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全绿

- [ ] **Step 2:** 手工 QQ 回归清单（@答、重置、人工、管理群 !resume、状态灯）

- [ ] **Step 3:** Commit 若有残留 + 打 tag 或 PR 描述「Phase 0 complete」

---

## Task 9: 依赖 grammY + TG parse

**Files:**
- `package.json` — `pnpm add grammy`
- Create: `lib/channels/tg/parse.ts`、`trigger.ts`
- Test: `tests/lib/channels/tg/parse.test.ts`

- [ ] **Step 1: parse 单测**（fixtures：群 @bot、私聊、forum thread、无 @）

- [ ] **Step 2: 实现 parse / trigger（UTF-16 剥 mention；忽略 private/channel/thread）

- [ ] **Step 3: commit**

```bash
git commit -m "feat(tg): Update 解析与 @ 触发"
```

---

## Task 10: TG Client long poll

**Files:**
- Create: `lib/channels/tg/client.ts`
- Modify: `lib/runtime.ts` — token 非空时 register tg
- Modify: `app/api/status/route.ts`

- [ ] **Step 1: client**

- `start`：getMe → 循环 getUpdates（timeout 30s）
- 每条：parse → enrich（Phase 1 可无 media）→ `bus.emit("message.received")` → **再** 写 offset
- `action.send` 仅 `channel==="tg"` → sendMessage
- `stop`：abort 标志 + 等待 loop 结束 + off 监听
- status：connected、lastError、offset detail

- [ ] **Step 2: Runtime 注册**

```ts
if (cfg.telegramBotToken.trim()) {
  registry.register(new TelegramChannel(cfg.telegramBotToken, ...))
}
```

- [ ] **Step 3: status API 返回 `channels: registry.status()`**

- [ ] **Step 4: 单测 mock fetch/grammY + commit**

```bash
git commit -m "feat(tg): long poll client 与 status 多通道"
```

---

## Task 11: Gateway TG handoff 与 Phase 1 验收

- [ ] **Step 1:** TG 人工关键词 → 用户侧文案 + supportUrl，无管理群事件
- [ ] **Step 2:** 集成测试：mock bus 双 channel 不串发送
- [ ] **Step 3:**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

- [ ] **Step 4:** 真机：关 Privacy Mode、填 enabled chat、@bot 问答
- [ ] **Step 5:** commit

```bash
git commit -m "feat(tg): 群聊文字主链路与 handoff 降级"
```

---

## Task 12: Phase 2 — 旁路 + 图片（摘要）

- [ ] admins-cache + senderRole
- [ ] Privacy 未满足时关闭该 chat 反思/补位并在 status 标明
- [ ] listEnabledChats 含 tg 进入 reflection/topic/unanswered
- [ ] media 下载限额 + images 入 agent
- [ ] 后台 API 返回 channel 字段
- [ ] 全量测试 + commit

---

## Task 13: Phase 3 — Admin UI

- [ ] 配置页 TG token / chats 表单项
- [ ] 首页分通道状态灯
- [ ] Privacy Mode / 取 chat id 帮助文案

---

## 执行注意

1. **先 Phase 0 全绿再启 TG poll**，避免半迁移生产库。
2. 每个 Task 保持 Prettier：`semi:false`、双引号。
3. 动 schema / agent 核心时对照 spec 绑定清单勾选。
4. 提交信息用 Conventional Commits + 中文正文，功能在 `feat/channel-telegram`，不直接推 main 除非用户要求。

---

## Spec 覆盖自检

| Spec 章节 | Task |
|-----------|------|
| §3 Channel 架构 | 5, 9–10 |
| §4 ID/事件 | 1–2, 6 |
| §5 TG 前置/offset | 10–12 |
| §6 迁移 | 3 |
| §7 业务 | 6–7, 11 |
| §8 配置/status | 4, 10, 13 |
| §10 测试 | 各 Task |
| §11 Phase | 8 / 11 / 12 / 13 |
