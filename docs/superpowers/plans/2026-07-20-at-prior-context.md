# @ 前回看用户本人历史（prior context）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户被 @ 时，gateway 将该用户在 `prior_since` 纪元内、本群最多 10 条近期发言拼进 agent prompt，修复「先提问再 @」拿不到上下文。

**Architecture:** `group_messages` 已缓冲全量消息。新增 `sessions.prior_since` 作对话纪元；`Repo.recentUserGroupMessages` 按用户回看；gateway 在关键词之后查库并用 `formatPriorContext` 写入 `QualifiedMessage.text`。命令句（重置/帮助/转人工）不入 buffer，避免重置后污染 prior。

**Tech Stack:** TypeScript、better-sqlite3、vitest、现有 bus/gateway/message-buffer。

**Spec:** `docs/superpowers/specs/2026-07-20-at-prior-context-design.md`

---

## File map

| 文件 | 职责 |
|------|------|
| `lib/db/index.ts` | `user_version` 3；`prior_since` 列；复合索引 |
| `lib/db/repo.ts` | `priorSince` / `recentUserGroupMessages`；`clearResumeId`/`clearAllResumeIds` 推进纪元 |
| `lib/agent/command-keywords.ts` | 共享 RESET/HELP/HANDOFF 正则 |
| `lib/agent/gateway.ts` | 查 prior、format、空 @ 逻辑、body trim |
| `lib/agent/message-buffer.ts` | 跳过命令句 |
| `lib/assemble.ts` | 注册顺序注释 |
| `tests/lib/db/repo.test.ts` | repo + 迁移 |
| `tests/lib/agent/gateway.test.ts` | 端到端 prior |
| `tests/lib/agent/message-buffer.test.ts` | 命令不缓冲 |
| `tests/lib/agent/prior-context.test.ts` | format/clip 纯函数（新建） |

---

### Task 1: Schema — `prior_since` + 索引 + user_version 3

**Files:**
- Modify: `lib/db/index.ts`
- Test: `tests/lib/db/repo.test.ts`（追加迁移用例）

- [ ] **Step 1: 写失败测 — v2 库升级后有列**

在 `tests/lib/db/repo.test.ts` 末尾追加：

```ts
describe("migrate prior_since (v3)", () => {
  it("已是 v2 无 prior_since 的库 openDb 后补列且可读写", () => {
    // 手工建「假 v2」：最小 sessions + group_messages，无 prior_since
    const raw = new BetterSqlite3(":memory:")
    raw.pragma("user_version = 2")
    raw.exec(`
      CREATE TABLE sessions (
        key TEXT PRIMARY KEY,
        session_id TEXT,
        resume_id TEXT,
        human_mode INTEGER NOT NULL DEFAULT 0,
        human_since INTEGER,
        last_question TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
      CREATE TABLE group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sender_role TEXT,
        text TEXT NOT NULL,
        message_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
      CREATE TABLE seen_messages (
        dedupe_key TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
    `)
    // 需要 sqlite-vec：走 openDb 同路径。用临时文件复制不可行；
    // 改为：openDb(":memory:", 3) 已是最新；单独测 ensure 逻辑：
    // 关闭 raw，改测「openDb 后 sessions 含 prior_since」
    raw.close()

    const db2 = openDb(":memory:", 3)
    const cols = db2
      .prepare("PRAGMA table_info(sessions)")
      .all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain("prior_since")
    const ver = Number(db2.pragma("user_version", { simple: true }))
    expect(ver).toBeGreaterThanOrEqual(3)
    db2.close()
  })
})
```

> 若 vitest 环境 `openDb(":memory:")` 已跑完整 migrate，`user_version>=3` 与列存在即可。更严的「旧 v2 文件升级」可在实现 `ensureSessionsPriorSince` 后用：先 `BetterSqlite3` 建 v2 表写盘，再 `openDb(path)`（需 load sqlite-vec — `openDb` 会 load）。**推荐**用 tmp 文件：

```ts
it("磁盘上的 v2 库升级补 prior_since", () => {
  const dir = mkdtempSync(join(tmpdir(), "prayer-v2-"))
  const path = join(dir, "t.db")
  const raw = new BetterSqlite3(path)
  raw.pragma("user_version = 2")
  raw.exec(`/* 同上最小 sessions 无 prior_since + 空 group_messages 等必需要表可省略若 migrate else 只 createV2 */`)
  raw.close()
  const db2 = openDb(path, 3)
  const names = (
    db2.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
  ).map((c) => c.name)
  expect(names).toContain("prior_since")
  expect(Number(db2.pragma("user_version", { simple: true }))).toBeGreaterThanOrEqual(3)
  db2.close()
  rmSync(dir, { recursive: true, force: true })
})
```

注意：`openDb` 在 `version>=2` 时调 `createV2Tables`；若 sessions 已存在且无列，**必须**在 migrate 里 `ALTER TABLE`，否则测会失败——这正是本 task 要修的。

- [ ] **Step 2: 跑测确认失败（列不存在或 version 仍为 2）**

```bash
pnpm vitest run tests/lib/db/repo.test.ts -t "prior_since"
```

Expected: FAIL（尚无 v3 迁移）

- [ ] **Step 3: 实现迁移**

在 `lib/db/index.ts`：

1. `createV1Tables` / `createV2Tables` 的 `sessions` 增加 `prior_since INTEGER`。
2. 新增：

```ts
function ensureSessionsPriorSince(db: Database.Database): void {
  if (!tableExists(db, "sessions")) return
  if (!tableColumns(db, "sessions").has("prior_since")) {
    db.exec("ALTER TABLE sessions ADD COLUMN prior_since INTEGER")
  }
}

function ensureGmUserTimeIndex(db: Database.Database): void {
  if (!tableExists(db, "group_messages")) return
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gm_channel_group_user_time
      ON group_messages(channel, group_id, user_id, created_at, id)
  `)
}
```

3. 改 `migrate`：

```ts
function migrate(db: Database.Database, dim: number): void {
  const version = userVersion(db)

  if (version < 2) {
    createV1Tables(db, dim)
    applyV1Patches(db)
    db.transaction(() => {
      migrateToV2(db)
    })()
    setUserVersion(db, 2)
  } else {
    createV2Tables(db, dim)
  }

  // v3: prior_since + 用户回看索引（幂等，可从任意 >=2 状态进入）
  if (userVersion(db) < 3) {
    ensureSessionsPriorSince(db)
    ensureGmUserTimeIndex(db)
    setUserVersion(db, 3)
  } else {
    ensureSessionsPriorSince(db)
    ensureGmUserTimeIndex(db)
  }
}
```

- [ ] **Step 4: 跑测通过**

```bash
pnpm vitest run tests/lib/db/repo.test.ts -t "prior_since"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/index.ts tests/lib/db/repo.test.ts
git commit -m "feat(db): sessions.prior_since 与用户消息索引 (v3)"
```

---

### Task 2: Repo — 纪元与 recentUserGroupMessages

**Files:**
- Modify: `lib/db/repo.ts`
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测**

```ts
describe("Repo prior context", () => {
  it("clearResumeId 推进 prior_since；边界前消息不可见", () => {
    repo.bufferGroupMessage("qq", "1", "2", "member", "旧问题", "m1")
    const before = Date.now()
    // 确保缓冲 created_at <= now
    repo.setSessionId("qq:1:2", "sid")
    repo.clearResumeId("qq:1:2")
    const since = repo.priorSince("qq:1:2")
    expect(since).toBeGreaterThanOrEqual(before)
    const rows = repo.recentUserGroupMessages("qq", "1", "2", 10, {
      sinceTs: since,
    })
    expect(rows).toHaveLength(0)
  })

  it("recentUserGroupMessages 只返回该用户非空、升序、exclude、limit", () => {
    repo.bufferGroupMessage("qq", "1", "2", null, "a", "1")
    repo.bufferGroupMessage("qq", "1", "2", null, "b", "2")
    repo.bufferGroupMessage("qq", "1", "9", null, "他人", "3")
    repo.bufferGroupMessage("qq", "1", "2", null, "   ", "4") // 若 buffer 拒空则手工 INSERT
    const rows = repo.recentUserGroupMessages("qq", "1", "2", 10, {
      excludeMessageId: "2",
    })
    expect(rows.map((r) => r.text)).toEqual(["a"])
  })

  it("同 created_at 按 id 升序稳定", () => {
    const t = Date.now()
    db.prepare(
      `INSERT INTO group_messages (channel, group_id, user_id, text, message_id, created_at)
       VALUES ('qq','1','2','x','10',?), ('qq','1','2','y','11',?)`
    ).run(t, t)
    const rows = repo.recentUserGroupMessages("qq", "1", "2", 10)
    expect(rows.map((r) => r.text)).toEqual(["x", "y"])
  })

  it("clearAllResumeIds 推进全部行 prior_since，返回值仍只计有 resume 的", () => {
    repo.setSessionId("qq:1:a", "s1")
    repo.setSessionId("qq:1:b", "s2")
    repo.clearResumeId("qq:1:b")
    const n = repo.clearAllResumeIds()
    expect(n).toBe(1)
    expect(repo.priorSince("qq:1:a")).toBeGreaterThan(0)
    expect(repo.priorSince("qq:1:b")).toBeGreaterThan(0)
  })
})
```

若 `bufferGroupMessage` 对空文本仍写入，则 exclude 空文本由 SQL `length(trim(text))>0` 保证；message-buffer 本就不缓冲空串，repo 单测可直接 SQL insert。

- [ ] **Step 2: 跑测 FAIL**

```bash
pnpm vitest run tests/lib/db/repo.test.ts -t "prior context"
```

- [ ] **Step 3: 实现 Repo 方法**

```ts
priorSince(key: string): number {
  const row = this.db
    .prepare("SELECT prior_since FROM sessions WHERE key = ?")
    .get(key) as { prior_since: number | null } | undefined
  return row?.prior_since ?? 0
}

// clearResumeId: upsert
clearResumeId(key: string): void {
  this.db
    .prepare(
      `INSERT INTO sessions (key, resume_id, prior_since, updated_at)
       VALUES (?, NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000)
       ON CONFLICT(key) DO UPDATE SET
         resume_id = NULL,
         prior_since = unixepoch('subsec')*1000,
         updated_at = unixepoch('subsec')*1000`
    )
    .run(key)
}

clearAllResumeIds(): number {
  const info = this.db
    .prepare(
      "UPDATE sessions SET resume_id = NULL, updated_at = unixepoch('subsec')*1000 WHERE resume_id IS NOT NULL"
    )
    .run()
  this.db
    .prepare(
      `UPDATE sessions SET prior_since = unixepoch('subsec')*1000,
         updated_at = unixepoch('subsec')*1000`
    )
    .run()
  return info.changes
}

recentUserGroupMessages(
  channel: string,
  chatId: string,
  userId: string,
  limit: number,
  opts?: { excludeMessageId?: string | null; sinceTs?: number }
): { text: string; createdAt: number; messageId: string | null; id: number }[] {
  if (limit <= 0) return []
  const sinceTs = opts?.sinceTs ?? 0
  const ex = opts?.excludeMessageId ?? null
  const rows = this.db
    .prepare(
      `SELECT id, text, created_at, message_id FROM group_messages
       WHERE channel = ? AND group_id = ? AND user_id = ?
         AND length(trim(text)) > 0
         AND created_at > ?
         AND (? IS NULL OR message_id IS NULL OR CAST(message_id AS TEXT) != ?)
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(channel, chatId, userId, sinceTs, ex, ex, limit) as {
    id: number
    text: string
    created_at: number
    message_id: string | number | null
  }[]
  return rows
    .map((r) => ({
      id: r.id,
      text: r.text,
      createdAt: r.created_at,
      messageId: r.message_id == null ? null : String(r.message_id),
    }))
    .reverse()
}
```

- [ ] **Step 4: 跑测 PASS + 确认旧 clearResumeId 测仍过**

```bash
pnpm vitest run tests/lib/db/repo.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(db): recentUserGroupMessages 与 prior_since 纪元"
```

---

### Task 3: command-keywords + message-buffer 跳过命令

**Files:**
- Create: `lib/agent/command-keywords.ts`
- Modify: `lib/agent/gateway.ts`（改为 import 关键词）
- Modify: `lib/agent/message-buffer.ts`
- Test: `tests/lib/agent/message-buffer.test.ts`

- [ ] **Step 1: 抽取关键词**

`lib/agent/command-keywords.ts`:

```ts
export const RESET_KEYWORDS =
  /^\s*(重新开始|重置对话|重置会话|重置|\/new|\/reset|\/clear)\s*$/i

export const HANDOFF_KEYWORDS = /^\s*(人工|转人工|人工客服|转接人工|客服)\s*$/i

export const HELP_KEYWORDS = /^\s*(帮助|怎么用|使用说明|\/help|help)\s*$/i

export function isCommandMessage(text: string): boolean {
  return (
    RESET_KEYWORDS.test(text) ||
    HANDOFF_KEYWORDS.test(text) ||
    HELP_KEYWORDS.test(text)
  )
}
```

gateway 删除本地常量，改为 `import { RESET_KEYWORDS, HANDOFF_KEYWORDS, HELP_KEYWORDS } from "./command-keywords"`。

- [ ] **Step 2: buffer 跳过命令 — 失败测**

```ts
it("重置/帮助/转人工整句不缓冲", () => {
  const stop = registerMessageBuffer({
    repo,
    botQQ: 1,
    adminSurface: { channel: "qq" as const, chatId: "999" },
    enabledChats: [{ channel: "qq" as const, chatId: "100" }],
  })
  for (const rawText of ["重置", "帮助", "人工", "怎么充值"]) {
    bus.emit("message.received", msg({ rawText, messageId: rawText }))
  }
  const win = repo.groupMessageWindow("qq", "100", 0, 10)
  expect(win.map((w) => w.text)).toEqual(["怎么充值"])
  stop()
})
```

- [ ] **Step 3: message-buffer 实现**

```ts
import { isCommandMessage } from "./command-keywords"
// in onReceived, after empty check:
if (isCommandMessage(msg.rawText)) return
```

- [ ] **Step 4: 跑测**

```bash
pnpm vitest run tests/lib/agent/message-buffer.test.ts tests/lib/agent/gateway.test.ts
```

Expected: PASS（gateway 关键词行为不变）

- [ ] **Step 5: Commit**

```bash
git add lib/agent/command-keywords.ts lib/agent/gateway.ts lib/agent/message-buffer.ts tests/lib/agent/message-buffer.test.ts
git commit -m "feat(agent): 命令关键词共享且不入 group_messages 缓冲"
```

---

### Task 4: formatPriorContext / clipPriorTexts 纯函数

**Files:**
- Create: `lib/agent/prior-context.ts`
- Create: `tests/lib/agent/prior-context.test.ts`

- [ ] **Step 1: 写测**

```ts
import { describe, it, expect } from "vitest"
import {
  formatPriorContext,
  clipPriorTexts,
  PRIOR_LINE_MAX_CHARS,
  EMPTY_AT_PLACEHOLDER,
} from "@/lib/agent/prior-context"

describe("formatPriorContext", () => {
  it("无 prior → 原样 body", () => {
    expect(formatPriorContext([], "hi")).toBe("hi")
    expect(formatPriorContext([], "")).toBe("")
  })
  it("有 prior + body", () => {
    const s = formatPriorContext(["怎么充值"], "支付宝呢")
    expect(s).toContain("【用户近期发言（@前，旧→新）】")
    expect(s).toContain("- 怎么充值")
    expect(s).toContain("【当前消息】")
    expect(s).toContain("支付宝呢")
  })
  it("有 prior 无 body → 占位", () => {
    const s = formatPriorContext(["问"], "")
    expect(s).toContain(EMPTY_AT_PLACEHOLDER)
  })
  it("多行续行缩进", () => {
    const s = formatPriorContext(["L1\nL2"], "x")
    expect(s).toContain("- L1\n  L2")
  })
})

describe("clipPriorTexts", () => {
  it("单行超长截断", () => {
    const long = "字".repeat(PRIOR_LINE_MAX_CHARS + 50)
    const [one] = clipPriorTexts([long], 2000, PRIOR_LINE_MAX_CHARS)
    expect(one.length).toBeLessThanOrEqual(PRIOR_LINE_MAX_CHARS)
    expect(one.endsWith("…")).toBe(true)
  })
  it("总预算保留较新", () => {
    const old = "旧".repeat(100)
    const neu = "新".repeat(100)
    const out = clipPriorTexts([old, neu], 150, 400)
    expect(out.some((t) => t.includes("新"))).toBe(true)
    expect(out.join("").length).toBeLessThanOrEqual(200)
  })
})
```

- [ ] **Step 2: 实现 `lib/agent/prior-context.ts`**

```ts
export const PRIOR_USER_CONTEXT_LIMIT = 10
export const PRIOR_CONTEXT_MAX_CHARS = 2000
export const PRIOR_LINE_MAX_CHARS = 400
export const EMPTY_AT_PLACEHOLDER =
  "（用户仅 @ 了 bot，无新正文；请结合近期发言作答）"

function normalizeLine(text: string, lineMax: number): string {
  let t = text.trim()
  if (t.length > lineMax) t = t.slice(0, lineMax - 1) + "…"
  return t.replace(/\n+/g, "\n").split("\n").map((line, i) =>
    i === 0 ? line : `  ${line}`
  ).join("\n")
}

/** texts 已是旧→新；从新到旧纳入直到 maxChars */
export function clipPriorTexts(
  texts: string[],
  maxChars: number,
  lineMax: number
): string[] {
  const kept: string[] = []
  let used = 0
  for (let i = texts.length - 1; i >= 0; i--) {
    const line = normalizeLine(texts[i], lineMax)
    const cost = line.length + 3 // "- " + "\n"
    if (kept.length > 0 && used + cost > maxChars) break
    if (kept.length === 0 && cost > maxChars) {
      kept.push(line.slice(0, Math.max(1, maxChars - 1)) + "…")
      break
    }
    kept.push(line)
    used += cost
  }
  return kept.reverse()
}

export function formatPriorContext(prior: string[], currentBody: string): string {
  if (!prior.length) return currentBody
  const lines = prior.map((p) => `- ${p}`).join("\n")
  const cur = currentBody.trim() ? currentBody.trim() : EMPTY_AT_PLACEHOLDER
  return `【用户近期发言（@前，旧→新）】\n${lines}\n【当前消息】\n${cur}`
}
```

注意：`clipPriorTexts` 应在 format **之前**做单行截断；format 收到的已是 clip 后文本。测里「多行」应对 **未 clip 的 format** 或 clip 内 normalize——上面 normalize 在 clip 内，format 只做 `- ${p}`。多行测应对 clip 输出或 format 输入已含 `\n  `。

调整：要么 format 内 normalize，要么测 clip。推荐 **clip 内 normalize，format 信任输入**；多行测改为：

```ts
const clipped = clipPriorTexts(["L1\nL2"], 2000, 400)
expect(formatPriorContext(clipped, "x")).toContain("- L1\n  L2")
```

- [ ] **Step 3: 跑测 PASS**

```bash
pnpm vitest run tests/lib/agent/prior-context.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add lib/agent/prior-context.ts tests/lib/agent/prior-context.test.ts
git commit -m "feat(agent): formatPriorContext 与字符预算裁剪"
```

---

### Task 5: Gateway 接线

**Files:**
- Modify: `lib/agent/gateway.ts`
- Modify: `lib/assemble.ts`（注释）
- Test: `tests/lib/agent/gateway.test.ts`

- [ ] **Step 1: 追加 gateway 测例**

```ts
function seedPrior(texts: string[]) {
  for (let i = 0; i < texts.length; i++) {
    repo.bufferGroupMessage("qq", "1", "2", "member", texts[i], `p${i}`)
  }
}

it("纯 @ 有 prior → qualified 含历史，不发用法说明", async () => {
  seedPrior(["怎么充值？"])
  const help = vi.fn()
  bus.on("action.send", help)
  const p = collectQualified()
  bus.emit("message.received", qqMsg({ messageId: "200", rawText: "", atList: [BOT] }))
  const q = await p
  expect(q.text).toContain("怎么充值？")
  expect(q.text).toContain("【当前消息】")
  expect(help).not.toHaveBeenCalled()
})

it("空白 @ 无 prior → 用法说明", async () => {
  const p = new Promise<any>((res) => bus.once("action.send", res))
  bus.emit(
    "message.received",
    qqMsg({ messageId: "201", rawText: "  \n\t", atList: [BOT] })
  )
  const a = await p
  expect(a.text).toContain("用法说明")
})

it("有 prior + 短正文", async () => {
  seedPrior(["原问题"])
  const q = await collectQualified()
  // 需先挂 listener 再 emit — 与现测一致
})

// 完整写法见下「接线后」同文件批量添加

it("重置后 prior 隔离", async () => {
  seedPrior(["敏感旧问"])
  repo.setSessionId(SK, "sid")
  // @ 重置
  await new Promise<any>((res) => {
    bus.once("action.send", res)
    bus.emit(
      "message.received",
      qqMsg({ messageId: "210", rawText: "重置", atList: [BOT] })
    )
  })
  // 同步 buffer 不写入「重置」（Task 3）；prior_since 已推进
  const spy = vi.fn()
  bus.on("message.qualified", spy)
  const p = new Promise<any>((res) => bus.once("action.send", res))
  bus.emit(
    "message.received",
    qqMsg({ messageId: "211", rawText: "", atList: [BOT] })
  )
  const a = await p
  expect(a.text).toContain("用法说明")
  expect(spy).not.toHaveBeenCalled()
})

it("查 prior 抛错时有正文仍放行", async () => {
  const spy = vi
    .spyOn(repo, "recentUserGroupMessages")
    .mockImplementation(() => {
      throw new Error("db down")
    })
  const err = new Promise<any>((res) => bus.once("error.occurred", res))
  const p = collectQualified()
  bus.emit(
    "message.received",
    qqMsg({ messageId: "220", rawText: "还在吗", atList: [BOT] })
  )
  const q = await p
  expect(q.text).toBe("还在吗")
  const e = await err
  expect(e.scope).toBe("gateway.prior-context")
  expect(e.sessionKey).toBe(SK)
  expect(e.channel).toBe("qq")
  expect(e.chatId).toBe("1")
  spy.mockRestore()
})
```

补全「有 prior + 短正文」：

```ts
it("有 prior + 短正文拼进 text", async () => {
  seedPrior(["原问题"])
  const p = collectQualified()
  bus.emit(
    "message.received",
    qqMsg({ messageId: "202", rawText: "帮我看看", atList: [BOT] })
  )
  const q = await p
  expect(q.text).toContain("原问题")
  expect(q.text).toContain("帮我看看")
})
```

`lastQuestion`：

```ts
it("纯 @ 有 prior 时 lastQuestion 用 prior 末条", async () => {
  seedPrior(["第一问", "第二问"])
  const p = collectQualified()
  bus.emit(
    "message.received",
    qqMsg({ messageId: "203", rawText: "", atList: [BOT] })
  )
  await p
  const s = repo.listSessions().find((x) => x.key === SK)
  expect(s?.lastQuestion).toBe("第二问")
})
```

- [ ] **Step 2: 跑测 FAIL**

```bash
pnpm vitest run tests/lib/agent/gateway.test.ts -t "prior"
```

- [ ] **Step 3: 改 gateway `onReceived` 核心逻辑**

在 dedupe 与 `sessionKey` 之后：

```ts
const body = (msg.rawText ?? "").trim()
const hasBody = body.length > 0
const hasImages = !!msg.images?.length

// human-mode 块：RESET 仍用 RESET_KEYWORDS.test(msg.rawText) 或 test(body)
// 重置/帮助/转人工：一律 body / rawText trim 后匹配

// —— 关键词与 human 处理完后 ——
let priorTexts: string[] = []
try {
  const since = repo.priorSince(sessionKey)
  const rows = repo.recentUserGroupMessages(
    channel,
    chatId,
    userId,
    PRIOR_USER_CONTEXT_LIMIT,
    { excludeMessageId: messageId, sinceTs: since }
  )
  priorTexts = clipPriorTexts(
    rows.map((r) => r.text),
    PRIOR_CONTEXT_MAX_CHARS,
    PRIOR_LINE_MAX_CHARS
  )
} catch (err) {
  bus.emit("error.occurred", {
    scope: "gateway.prior-context",
    err,
    sessionKey,
    channel,
    chatId,
  })
  priorTexts = []
}

if (!hasBody && !hasImages && priorTexts.length === 0) {
  sendText(channel, chatId, helpText(supportUrl), messageId)
  bus.emit("resolution.recorded", {
    kind: "ack",
    sessionKey,
    channel,
    chatId,
    userId,
    detail: "empty-after-mention",
  })
  return
}

const text = formatPriorContext(priorTexts, body)
const lastQ = body || priorTexts[priorTexts.length - 1] || ""
if (lastQ) repo.setLastQuestion(sessionKey, lastQ)

bus.emit("message.qualified", {
  channel,
  sessionKey,
  chatId,
  userId,
  messageId,
  text,
  images: msg.images,
  quoted: msg.quoted,
  forwarded: msg.forwarded,
})
```

**重要：** 删除原先「纯 @ 无正文」在 human-mode **之前**的空消息 early-return；空消息门移到 prior 查询之后。human-mode / 重置 / 帮助 / 转人工 保持在 prior 查询 **之前**，且匹配 `body`（`RESET_KEYWORDS.test(body)` 等）。

human-mode 内对空 body 的 `@`：现网 empty 在 human 前就 return help。新顺序下 human-mode 先：

```ts
if (repo.isHumanMode(sessionKey)) {
  if (RESET_KEYWORDS.test(body)) { ... }
  return
}
```

纯 `@` 在 human-mode 下仍静默（不 help）——与「human 不抢答」一致；若需 help，规格未要求，保持静默。

- [ ] **Step 4: assemble 注释**

```ts
// gateway 必须先于 message-buffer：prior 回看时当前条尚未入库；
// 另以 excludeMessageId 双保险。
registerGateway({...}),
...
registerMessageBuffer({...}),
```

- [ ] **Step 5: 全量相关测**

```bash
pnpm vitest run tests/lib/agent/gateway.test.ts tests/lib/agent/message-buffer.test.ts tests/lib/agent/prior-context.test.ts tests/lib/db/repo.test.ts
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add lib/agent/gateway.ts lib/assemble.ts tests/lib/agent/gateway.test.ts
git commit -m "feat(gateway): @ 触发时拼接用户 prior 上下文"
```

---

### Task 6: 全量校验

- [ ] **Step 1: typecheck + lint + test**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全部通过

- [ ] **Step 2: 若有失败，修到绿再 commit**

```bash
git add -A
git commit -m "fix: prior context 全量校验修复"
```

（无修复则跳过）

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| prior 10 条、仅本人 | T2, T5 |
| prior_since 纪元 / 重置隔离 | T1, T2, T3, T5 |
| trim 空 @ | T5 |
| id 稳定排序 | T2 |
| 复合索引 + v3 迁移 | T1 |
| 字符预算 | T4, T5 |
| 查库失败降级 | T5 |
| 命令不入 buffer | T3 |
| clearAll 全表 prior_since | T2 |
| format 拼接 / 占位 | T4 |
| assemble 顺序注释 | T5 |

## 执行注意

- Prettier：无分号、双引号。
- 路径别名 `@/*`。
- 改 agent 核心已有 spec；实现严格按本 plan，勿扩 scope。
