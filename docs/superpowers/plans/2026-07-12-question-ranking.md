# 问题排行榜 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统计 QQ 群用户高频提问、LLM 归并成主题排名，并旁标知识库是否覆盖，配套只读后台页，辅助补文档。

**Architecture:** 新增 `topic-poller`（仿 `reflection-poller`），每群独立时间游标增量扫 `group_messages` 用户提问 → 强制 JSON Schema 的 LLM 归主题 → 落持久表 `question_topics` / `question_occurrences`。时间窗聚合基于 occurrences。改 `pruneGroupMessages` 下界为 `min(反思阈值, 全群 topic 游标)` 防丢数据。后台 `/admin/ranking` 按窗口聚合 + KB 命中。

**Tech Stack:** Next.js 16 App Router、better-sqlite3、sqlite-vec、`@anthropic-ai/claude-agent-sdk`（MiniMax-M3）、vitest。Prettier 无分号双引号。测试在 `tests/`。

参考 spec：`docs/superpowers/specs/2026-07-12-question-ranking-design.md`

---

## 文件结构

- Modify `lib/db/index.ts` — migrate 加两表 + 索引
- Modify `lib/db/repo.ts` — topic/occurrence 读写、每群 topic 游标、`minTopicCursor`、窗口聚合、样例
- Modify `lib/agent/reflection-poller.ts:267` — prune 下界协调
- Create `lib/agent/topic-poller.ts` — 轮询器 + LLM 归类 schema/校验
- Modify `lib/usage-stats.ts:7` — `UsageSite` 加 `"topic"`
- Modify `lib/config-store.ts` — 加 4 个 topic 节奏字段 + env 种子
- Modify `lib/assemble.ts` — deps + `registerTopicPoller`
- Modify `lib/runtime.ts:123` — 配置透传
- Create `app/api/ranking/route.ts` — GET `?window=`
- Create `app/admin/ranking/page.tsx` — 后台页
- Modify `components/app-sidebar.tsx` — 导航入口
- Test `tests/lib/db/repo.test.ts`（追加）、`tests/lib/agent/topic-poller.test.ts`（新建）

---

## Task 1: DB schema — 两张新表

**Files:**
- Modify: `lib/db/index.ts`（migrate 的 `db.exec` 模板字符串内，紧接现有 `CREATE TABLE` 块末尾、`` ` `` 之前）
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/lib/db/repo.test.ts` 末尾（`describe` 外或新增 `describe`）追加。若文件顶部尚无这些 import，确保有：
```ts
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
```
新增：
```ts
describe("question ranking schema", () => {
  it("question_topics / question_occurrences 表存在且可写", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const db = (repo as any).db as import("better-sqlite3").Database
    db.prepare("INSERT INTO question_topics (title) VALUES (?)").run("退款相关")
    const tid = (db.prepare("SELECT id FROM question_topics").get() as { id: number }).id
    db.prepare(
      "INSERT INTO question_occurrences (topic_id, group_id, user_id, text, msg_ts) VALUES (?,?,?,?,?)"
    ).run(tid, 100, 200, "怎么退款", 1000)
    const n = (db.prepare("SELECT COUNT(*) n FROM question_occurrences").get() as { n: number }).n
    expect(n).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/db/repo.test.ts -t "表存在且可写"`
Expected: FAIL（`no such table: question_topics`）

- [ ] **Step 3: 加建表 SQL**

在 `lib/db/index.ts` 的 `migrate` 内 `db.exec(\`...\`)` 模板里，`name_cache_members` 表之后、闭合反引号前插入：
```sql
    CREATE TABLE IF NOT EXISTS question_topics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS question_occurrences (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id   INTEGER NOT NULL,
      group_id   INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      text       TEXT NOT NULL,
      msg_ts     INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_qo_topic ON question_occurrences(topic_id);
    CREATE INDEX IF NOT EXISTS idx_qo_ts ON question_occurrences(msg_ts);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/db/repo.test.ts -t "表存在且可写"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/index.ts tests/lib/db/repo.test.ts
git commit -m "feat(ranking): 新增 question_topics / question_occurrences 表"
```

---

## Task 2: Repo — topic/occurrence 写入 + 每群 topic 游标

**Files:**
- Modify: `lib/db/repo.ts`（在 `setGroupReflectCursor` 之后、`compactAt` 之前，即约 `repo.ts:329` 处，新增一段问题排行方法）
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("ranking repo 写入与游标", () => {
  it("upsertTopic 复用同名主题;insertOccurrence 落库;topicCursor 读写", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const t1 = repo.insertQuestionTopic("退款相关", 1000)
    const t2 = repo.insertQuestionTopic("退款相关", 2000) // 已存在同名 → 复用
    expect(t2).toBe(t1)
    repo.insertQuestionOccurrence(t1, 100, 200, "怎么退款", 1500)
    expect(repo.topicCursor(100)).toBe(0)
    repo.setTopicCursor(100, 1500)
    expect(repo.topicCursor(100)).toBe(1500)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/db/repo.test.ts -t "写入与游标"`
Expected: FAIL（`repo.insertQuestionTopic is not a function`）

- [ ] **Step 3: 加 repo 方法**

在 `lib/db/repo.ts` `setGroupReflectCursor(...)` 方法之后插入：
```ts
  // ── 问题排行榜 ──────────────────────────────────────────
  // 主题目录:同名(精确)复用,返回主题 id。近义归并由 poller 侧 textNearlySame 处理。
  insertQuestionTopic(title: string, now: number): number {
    const exist = this.db
      .prepare("SELECT id FROM question_topics WHERE title = ?")
      .get(title) as { id: number } | undefined
    if (exist) {
      this.db
        .prepare("UPDATE question_topics SET updated_at = ? WHERE id = ?")
        .run(now, exist.id)
      return exist.id
    }
    const info = this.db
      .prepare("INSERT INTO question_topics (title, created_at, updated_at) VALUES (?, ?, ?)")
      .run(title, now, now)
    return Number(info.lastInsertRowid)
  }

  insertQuestionOccurrence(
    topicId: number,
    groupId: number,
    userId: number,
    text: string,
    msgTs: number
  ): void {
    this.db
      .prepare(
        "INSERT INTO question_occurrences (topic_id, group_id, user_id, text, msg_ts) VALUES (?,?,?,?,?)"
      )
      .run(topicId, groupId, userId, text, msgTs)
  }

  // 现有主题清单(供 poller 喂 LLM 与近义归并),按最近活跃降序
  questionTopics(limit = 500): { id: number; title: string }[] {
    return this.db
      .prepare("SELECT id, title FROM question_topics ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as { id: number; title: string }[]
  }

  // 每群问题排行游标(config key = topic_cursor:{gid}),已处理到的 group_messages.created_at
  topicCursor(groupId: number): number {
    return Number(this.getConfigRow(`topic_cursor:${groupId}`) ?? "0")
  }

  setTopicCursor(groupId: number, ts: number): void {
    this.setConfigRow(`topic_cursor:${groupId}`, String(ts))
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/db/repo.test.ts -t "写入与游标"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(ranking): repo 主题/归属写入与每群游标"
```

---

## Task 3: Repo — 窗口聚合 + 样例 + minTopicCursor

**Files:**
- Modify: `lib/db/repo.ts`（接 Task 2 那段之后）
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("ranking repo 聚合", () => {
  it("rankingByWindow 按 msg_ts 窗口计数并降序;topicSamples 取样;minTopicCursor 忽略 0", () => {
    const repo = new Repo(openDb(":memory:", 3))
    const a = repo.insertQuestionTopic("退款", 0)
    const b = repo.insertQuestionTopic("改密码", 0)
    repo.insertQuestionOccurrence(a, 100, 1, "怎么退款", 1000)
    repo.insertQuestionOccurrence(a, 100, 2, "退款多久", 2000)
    repo.insertQuestionOccurrence(b, 100, 3, "改密码", 500)
    // 窗口 [1500, ∞):只剩 a 的 1 条
    const win = repo.rankingByWindow(1500)
    expect(win[0]).toMatchObject({ id: a, count: 1 })
    // 全部窗口(sinceTs=0):a=2 排 b=1 前
    const all = repo.rankingByWindow(0)
    expect(all.map((r) => r.count)).toEqual([2, 1])
    expect(all[0].id).toBe(a)
    expect(repo.topicSamples(a, 5)).toContain("退款多久")
    // minTopicCursor:群100 游标 3000,群200 无游标(0)→ 忽略,取 3000
    repo.setTopicCursor(100, 3000)
    expect(repo.minTopicCursor([100, 200])).toBe(3000)
    // 全部为 0 → MAX_SAFE_INTEGER(不约束 prune)
    expect(repo.minTopicCursor([200])).toBe(Number.MAX_SAFE_INTEGER)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/db/repo.test.ts -t "聚合"`
Expected: FAIL（`repo.rankingByWindow is not a function`）

- [ ] **Step 3: 加 repo 方法**

接 Task 2 段落之后插入：
```ts
  // 时间窗排行:msg_ts >= sinceTs 的归属按主题计数,降序。sinceTs=0 即全部。
  rankingByWindow(sinceTs: number): { id: number; title: string; count: number; lastTs: number }[] {
    return this.db
      .prepare(
        `SELECT t.id AS id, t.title AS title, COUNT(o.id) AS count, MAX(o.msg_ts) AS lastTs
         FROM question_occurrences o
         JOIN question_topics t ON t.id = o.topic_id
         WHERE o.msg_ts >= ?
         GROUP BY t.id
         ORDER BY count DESC, lastTs DESC`
      )
      .all(sinceTs) as { id: number; title: string; count: number; lastTs: number }[]
  }

  // 某主题窗口内代表问题样例,按最近降序
  topicSamples(topicId: number, limit: number, sinceTs = 0): string[] {
    const rows = this.db
      .prepare(
        `SELECT text FROM question_occurrences
         WHERE topic_id = ? AND msg_ts >= ?
         ORDER BY msg_ts DESC LIMIT ?`
      )
      .all(topicId, sinceTs, limit) as { text: string }[]
    return rows.map((r) => r.text)
  }

  // 生效群中 topic 游标的最小值(忽略从未处理过的 0 群,避免恒卡 prune)。
  // 无任何 >0 游标 → MAX_SAFE_INTEGER(prune 不受 topic 侧约束)。
  minTopicCursor(enabledGroups: number[]): number {
    let min = Number.MAX_SAFE_INTEGER
    for (const g of enabledGroups) {
      const c = this.topicCursor(g)
      if (c > 0 && c < min) min = c
    }
    return min
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/db/repo.test.ts -t "聚合"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(ranking): repo 窗口聚合/样例/minTopicCursor"
```

---

## Task 4: prune 协调 — 反思删除下界纳入 topic 游标

**Files:**
- Modify: `lib/agent/reflection-poller.ts:267`
- Test: `tests/lib/db/repo.test.ts`（验证 minTopicCursor 语义，prune 行为在 topic-poller 测试里覆盖）

说明：`minTopicCursor` 的回归测试已在 Task 3 覆盖。本任务只改一行调用点，改后靠现有反思测试 + typecheck 兜底（现有反思测试未设 topic 游标 → `minTopicCursor` 返回 MAX_SAFE_INTEGER，`Math.min` 不改变原行为，反思测试仍绿）。

- [ ] **Step 1: 改 prune 调用**

`lib/agent/reflection-poller.ts` 第 267 行：
```ts
  d.repo.pruneGroupMessages(now - d.lookbackMs - d.settleMs);
```
改为：
```ts
  // 删除下界纳入问题排行游标:只删反思与 topic 两侧都已越过的消息,防止未归类提问被提前 prune。
  d.repo.pruneGroupMessages(
    Math.min(now - d.lookbackMs - d.settleMs, d.repo.minTopicCursor(d.enabledGroups))
  );
```

- [ ] **Step 2: 跑现有反思测试确认不回归**

Run: `pnpm vitest run tests/lib/agent/reflection-poller.test.ts`
Expected: PASS（全绿，游标断言不变）

- [ ] **Step 3: Commit**

```bash
git add lib/agent/reflection-poller.ts
git commit -m "feat(ranking): prune 下界纳入 topic 游标,防丢未归类提问"
```

---

## Task 5: usage-stats — 新增 topic 站点

**Files:**
- Modify: `lib/usage-stats.ts:7`
- Test: 无（纯类型联合，靠 typecheck）

- [ ] **Step 1: 改类型**

`lib/usage-stats.ts` 第 7 行：
```ts
export type UsageSite = "agent" | "intent" | "answerability" | "reflect" | "compact" | "promote";
```
改为：
```ts
export type UsageSite = "agent" | "intent" | "answerability" | "reflect" | "compact" | "promote" | "topic";
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 通过（无新错误）

- [ ] **Step 3: Commit**

```bash
git add lib/usage-stats.ts
git commit -m "feat(ranking): usage-stats 增加 topic 站点"
```

---

## Task 6: topic-poller — LLM 归类校验（纯函数，先 TDD 校验层）

**Files:**
- Create: `lib/agent/topic-poller.ts`
- Test: `tests/lib/agent/topic-poller.test.ts`

先实现并测通「解析 + 对齐 + 校验」纯函数 `classifyItems`，这是 A3 的核心健壮性。

- [ ] **Step 1: 写失败测试**

创建 `tests/lib/agent/topic-poller.test.ts`：
```ts
import { describe, it, expect } from "vitest"
import { classifyItems } from "@/lib/agent/topic-poller"

describe("classifyItems 校验", () => {
  const existing = new Set([1, 2])
  it("结构化优先:合法项对齐;越界/重复/缺 i 丢弃;幻觉 topicId 丢弃", () => {
    const structured = {
      items: [
        { i: 0, topicId: 1 }, // 归入已有
        { i: 1, newTitle: "新主题" }, // 新建
        { i: 2, noise: true }, // 噪声丢弃
        { i: 3, topicId: 99 }, // 幻觉 id → 丢弃
        { i: 1, topicId: 2 }, // 重复 i → 丢弃
        { i: 9, topicId: 1 }, // 越界 → 丢弃
        { topicId: 1 }, // 缺 i → 丢弃
      ],
    }
    const out = classifyItems(structured, "", 4, existing)
    expect(out).toEqual([
      { i: 0, topicId: 1 },
      { i: 1, newTitle: "新主题" },
    ])
  })

  it("无结构化时回退文本解析", () => {
    const raw = '这是解释 {"items":[{"i":0,"topicId":2}]} 结尾'
    const out = classifyItems(undefined, raw, 1, existing)
    expect(out).toEqual([{ i: 0, topicId: 2 }])
  })

  it("解析失败 → 返回 null(调用方跳过、不推进游标)", () => {
    expect(classifyItems(undefined, "抱歉无法处理", 3, existing)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/agent/topic-poller.test.ts -t "校验"`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `lib/agent/topic-poller.ts`（先只写校验层与依赖 import）**

```ts
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import { bus } from "../bus"
import type { Repo } from "../db/repo"
import { embed as defaultEmbed } from "../tools/embed"
import { noToolQueryOptions, drainQuery } from "./agent"
import { textNearlySame } from "./reflection-poller"

// LLM 每条问题的归类结果:归入已有 topicId / 新建 newTitle / 噪声 noise。
export interface ClassifyItem {
  i: number
  topicId?: number
  newTitle?: string
}

// 从 structured_output(优先)或原始文本中抽出 items 数组。
function rawItems(structured: unknown, rawText: string): unknown[] | null {
  if (structured && typeof structured === "object" && Array.isArray((structured as any).items)) {
    return (structured as any).items
  }
  if (Array.isArray(structured)) return structured
  // 文本兜底:匹配 {"items":[...]} 或裸数组
  const objMatch = rawText.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const v = JSON.parse(objMatch[0])
      if (v && Array.isArray(v.items)) return v.items
    } catch {
      /* fall through */
    }
  }
  const arrMatch = rawText.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      const v = JSON.parse(arrMatch[0])
      if (Array.isArray(v)) return v
    } catch {
      /* noop */
    }
  }
  return null
}

// 解析 + 对齐 + 校验。batchLen=本轮问题条数,existingIds=本轮传入 LLM 的现有主题 id 集。
// 返回对齐后的合法归类项(noise/非法项已剔除);解析失败返回 null(调用方本轮跳过、不推进游标)。
export function classifyItems(
  structured: unknown,
  rawText: string,
  batchLen: number,
  existingIds: Set<number>
): ClassifyItem[] | null {
  const items = rawItems(structured, rawText)
  if (!items) return null
  const seen = new Set<number>()
  const out: ClassifyItem[] = []
  for (const it of items) {
    if (!it || typeof it !== "object") continue
    const rec = it as Record<string, unknown>
    const i = rec.i
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= batchLen) continue
    if (seen.has(i)) continue
    if (rec.noise === true) {
      seen.add(i)
      continue
    }
    if (typeof rec.topicId === "number" && existingIds.has(rec.topicId)) {
      seen.add(i)
      out.push({ i, topicId: rec.topicId })
      continue
    }
    if (typeof rec.newTitle === "string" && rec.newTitle.trim()) {
      seen.add(i)
      out.push({ i, newTitle: rec.newTitle.trim() })
      continue
    }
    // 既非合法 topicId 也无 newTitle(含幻觉 id)→ 丢弃
    seen.add(i)
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/agent/topic-poller.test.ts -t "校验"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent/topic-poller.ts tests/lib/agent/topic-poller.test.ts
git commit -m "feat(ranking): topic-poller LLM 归类解析与校验层"
```

---

## Task 7: topic-poller — 扫描主循环 `runScan` + 装配

**Files:**
- Modify: `lib/agent/topic-poller.ts`（接 Task 6，追加 schema/系统提示/`scanOnce`/`runScan`/`registerTopicPoller`）
- Test: `tests/lib/agent/topic-poller.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/lib/agent/topic-poller.test.ts` 追加。顶部补充 import：
```ts
import { beforeEach, vi } from "vitest"
import { openDb } from "@/lib/db/index"
import { Repo } from "@/lib/db/repo"
import { bus } from "@/lib/bus"
import { runScan } from "@/lib/agent/topic-poller"
```
测试体：
```ts
const embed = async () => new Float32Array([1, 0, 0])
function seed(repo: Repo, groupId: number, userId: number, role: string | null, text: string, at: number) {
  ;(repo as any).db
    .prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
    .run(groupId, userId, role, text, at)
}
// 假 query:返回带 structured 的 result(仿 drainQuery 消费形状)
function fakeQuery(items: unknown[]) {
  return async function* () {
    yield {
      type: "result",
      subtype: "success",
      structured_output: { items },
    }
  }
}
const NOW = 10_000_000
const opts = (repo: Repo, over: Record<string, unknown> = {}) => ({
  repo,
  adminGroupId: 999,
  enabledGroups: [100],
  embed,
  now: () => NOW,
  scanMs: 1,
  settleMs: 1000,
  windowMax: 50,
  topicPromptMax: 40,
  ...over,
})

describe("topic-poller runScan", () => {
  let repo: Repo
  beforeEach(() => {
    bus.removeAllListeners()
    repo = new Repo(openDb(":memory:", 3))
  })

  it("member/NULL role 提问被归主题落库并推进游标", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    seed(repo, 100, 201, null, "退款要多久", NOW - 4000) // NULL role 也纳入(A2)
    seed(repo, 100, 202, "admin", "客服发言不计", NOW - 3000) // 客服排除
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([
          { i: 0, newTitle: "退款相关" },
          { i: 1, topicId: -1 }, // 首轮无现有主题 → 幻觉 id 丢弃,但下句用 newTitle 更稳
        ]) as never,
      })
    )
    // 只 i=0 落库(i=1 的 topicId 非法被丢);游标推进到本批最大 created_at(NOW-4000)
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: "退款相关", count: 1 })
    expect(repo.topicCursor(100)).toBe(NOW - 4000)
  })

  it("noise 全丢 → 无 occurrence,游标仍推进", async () => {
    seed(repo, 100, 200, "member", "在吗", NOW - 5000)
    await runScan(opts(repo, { queryFn: fakeQuery([{ i: 0, noise: true }]) as never }))
    expect(repo.rankingByWindow(0)).toHaveLength(0)
    expect(repo.topicCursor(100)).toBe(NOW - 5000)
  })

  it("空窗口 → 游标推进到 now-settle(防 prune 卡死),不调 LLM", async () => {
    const qf = vi.fn(fakeQuery([]))
    await runScan(opts(repo, { queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.topicCursor(100)).toBe(NOW - 1000)
  })

  it("newTitle 与现有主题近义 → 归并到现有,不新建", async () => {
    // 归一化后仅差空格 → textNearlySame=true(bigramJaccard 对"三↔3"这类字符替换会 <0.72,故用空格差)
    const t = repo.insertQuestionTopic("退款一般3个工作日到账", 0)
    seed(repo, 100, 200, "member", "退款多久", NOW - 5000)
    await runScan(
      opts(repo, {
        queryFn: fakeQuery([{ i: 0, newTitle: "退款一般 3 个工作日到账" }]) as never, // 仅差空格,近义
      })
    )
    const rows = repo.rankingByWindow(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(t) // 归并到已有,不新建
  })

  it("LLM 畸形输出 → 不落库,游标不动(下轮重试)", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    await runScan(opts(repo, { queryFn: fakeQueryText("抱歉无法处理") as never }))
    expect(repo.rankingByWindow(0)).toHaveLength(0)
    expect(repo.topicCursor(100)).toBe(0)
  })

  it("非生效群跳过,不调 LLM,游标不动", async () => {
    seed(repo, 100, 200, "member", "怎么退款", NOW - 5000)
    const qf = vi.fn(fakeQuery([{ i: 0, newTitle: "x" }]))
    await runScan(opts(repo, { enabledGroups: [], queryFn: qf as never }))
    expect(qf).not.toHaveBeenCalled()
    expect(repo.topicCursor(100)).toBe(0)
  })
})
```
并在 import 区补一个返回纯文本的假 query（上面「LLM 畸形输出」用例用）：
```ts
function fakeQueryText(text: string) {
  return async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text }] } }
    yield { type: "result", subtype: "success" }
  }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/lib/agent/topic-poller.test.ts -t "runScan"`
Expected: FAIL（`runScan` 未导出）

- [ ] **Step 3: 追加实现到 `lib/agent/topic-poller.ts`**

在 Task 6 文件末尾追加：
```ts
export interface TopicPollerDeps {
  repo: Repo
  adminGroupId: number
  enabledGroups?: number[]
  scanMs?: number
  settleMs?: number
  windowMax?: number
  topicPromptMax?: number
  embed?: (text: string) => Promise<Float32Array>
  queryFn?: typeof sdkQuery
  now?: () => number
}

interface Resolved {
  repo: Repo
  adminGroupId: number
  enabledGroups: number[]
  settleMs: number
  windowMax: number
  topicPromptMax: number
  embed: (text: string) => Promise<Float32Array>
  queryFn: typeof sdkQuery
  now: () => number
}

const TOPIC_SYSTEM = `你是客服问题归类助手。用户消息给出:
一、【现有主题】清单,每行 [id] 标题(可能为空)。
二、【待归类问题】清单,每行 [序号] 用户提问原文。
任务:对每条待归类问题,判断它属于哪个已有主题,或需要新建主题,或是无意义噪声。
规则:
- 能归入某个现有主题 → 输出该主题的 id(topicId,必须来自【现有主题】清单)。
- 是有意义的新问题但无匹配主题 → 输出简洁的中文主题标题(newTitle,概括问题要点,如"退款到账时间")。
- 寒暄/表情/闲聊/纯指令/无信息量 → 标记 noise:true,丢弃。
- 语义相同的多条新问题应共用同一个 newTitle。
只输出 JSON 对象 {"items":[...]},每项含输入序号 i。不要额外文字、不要 Markdown。
形如 {"items":[{"i":0,"topicId":3},{"i":1,"newTitle":"退款到账时间"},{"i":2,"noise":true}]}`

const TOPIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          i: { type: "integer" },
          topicId: { type: "integer" },
          newTitle: { type: "string" },
          noise: { type: "boolean" },
        },
        required: ["i"],
      },
    },
  },
  required: ["items"],
}

function resolve(deps: TopicPollerDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    enabledGroups: deps.enabledGroups ?? [],
    settleMs: deps.settleMs ?? 60_000,
    windowMax: deps.windowMax ?? 50,
    topicPromptMax: deps.topicPromptMax ?? 40,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
  }
}

async function scanOnce(d: Resolved): Promise<void> {
  const now = d.now()
  const until = now - d.settleMs
  if (until <= 0) return
  const enabled = new Set(d.enabledGroups)

  for (const groupId of d.enabledGroups) {
    if (!enabled.has(groupId)) continue
    const cursor = d.repo.topicCursor(groupId)
    if (until <= cursor) continue
    try {
      const msgs = d.repo
        .groupMemberMessagesBetween(groupId, cursor, until)
        .filter((m) => m.text.trim())
        .slice(0, d.windowMax)
      if (!msgs.length) {
        // 空窗口也推进游标 → 防止沉默群把 minTopicCursor/prune 卡在 0
        d.repo.setTopicCursor(groupId, until)
        continue
      }
      const topics = d.repo.questionTopics(d.topicPromptMax)
      const existingIds = new Set(topics.map((t) => t.id))
      const topicBlock =
        topics.length > 0 ? topics.map((t) => `[${t.id}] ${t.title}`).join("\n") : "(无)"
      const qBlock = msgs.map((m, i) => `[${i}] ${m.text}`).join("\n")
      const prompt = `【现有主题】\n${topicBlock}\n\n【待归类问题】\n${qBlock}`

      const { text: out, structuredOutput } = await drainQuery(
        d.queryFn({
          prompt,
          options: noToolQueryOptions({
            systemPrompt: TOPIC_SYSTEM,
            outputFormat: { type: "json_schema", schema: TOPIC_SCHEMA },
            thinking: { type: "disabled" },
            canUseTool: async () => ({ behavior: "deny" as const, message: "归类阶段不使用工具" }),
            maxTurns: 2,
          }) as never,
        }) as AsyncIterable<any>,
        "topic"
      )

      const classified = classifyItems(structuredOutput, out, msgs.length, existingIds)
      if (classified === null) {
        // 解析失败 → 本群不推进,下轮重试(不落库)
        bus.emit("error.occurred", {
          scope: "topic",
          err: new Error("LLM 归类输出解析失败"),
          groupId,
        })
        continue
      }

      for (const c of classified) {
        const m = msgs[c.i]
        if (!m) continue
        let topicId: number
        if (c.topicId != null) {
          topicId = c.topicId
        } else {
          // newTitle:与现有主题近义则归并,否则新建(insertQuestionTopic 同名复用)
          const near = topics.find((t) => textNearlySame(t.title, c.newTitle!))
          topicId = near ? near.id : d.repo.insertQuestionTopic(c.newTitle!, now)
        }
        d.repo.insertQuestionOccurrence(topicId, groupId, m.userId, m.text, m.createdAt)
      }
      // 推进到本批实际取到的最大 created_at
      const maxTs = msgs[msgs.length - 1].createdAt
      d.repo.setTopicCursor(groupId, maxTs)
    } catch (err) {
      bus.emit("error.occurred", { scope: "topic", err, groupId })
    }
  }
}

export async function runScan(deps: TopicPollerDeps): Promise<void> {
  await scanOnce(resolve(deps))
}

export function registerTopicPoller(deps: TopicPollerDeps): () => void {
  const d = resolve(deps)
  const scanMs = deps.scanMs ?? 300_000
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void scanOnce(d)
      .catch((err) => bus.emit("error.occurred", { scope: "topic", err }))
      .finally(() => {
        running = false
      })
  }, scanMs)
  return () => clearInterval(timer)
}
```

注意：`groupMemberMessagesBetween` 返回项含 `{ userId, text, createdAt, messageId }`（见 `repo.ts:300`），按 `created_at ASC` 排序，`msgs[msgs.length-1].createdAt` 即本批最大 ts。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/lib/agent/topic-poller.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add lib/agent/topic-poller.ts tests/lib/agent/topic-poller.test.ts
git commit -m "feat(ranking): topic-poller 扫描主循环与装配"
```

---

## Task 8: 配置字段 + 装配 + 运行时透传

**Files:**
- Modify: `lib/config-store.ts`（`AppConfig` + `seedFromEnv`）
- Modify: `lib/assemble.ts`（`AssembleDeps` + 注册）
- Modify: `lib/runtime.ts:123`（透传）
- Test: 无（装配/类型，靠 typecheck + 后续手测）

- [ ] **Step 1: config-store 加字段**

`lib/config-store.ts` 的 `AppConfig` 接口内，`maxReplyChars` 之后加：
```ts
  /** 问题排行归类扫描周期(ms)。默认 5 分钟 */
  topicScanMs: number
  /** 归类静置窗(ms):只处理早于 now-该值的提问。默认 1 分钟 */
  topicSettleMs: number
  /** 每群每轮最多归类条数。默认 50 */
  topicWindowMax: number
  /** 喂 LLM 的现有主题上限。默认 40 */
  topicPromptMax: number
```
`seedFromEnv` 返回对象内，`maxReplyChars` 之后加：
```ts
    topicScanMs: Number(env.TOPIC_SCAN_MS ?? "300000"),
    topicSettleMs: Number(env.TOPIC_SETTLE_MS ?? "60000"),
    topicWindowMax: Number(env.TOPIC_WINDOW_MAX ?? "50"),
    topicPromptMax: Number(env.TOPIC_PROMPT_MAX ?? "40"),
```

- [ ] **Step 2: assemble 加 deps + 注册**

`lib/assemble.ts` 顶部 import 加：
```ts
import { registerTopicPoller } from "./agent/topic-poller";
```
`AssembleDeps` 接口内加：
```ts
  topicScanMs?: number;
  topicSettleMs?: number;
  topicWindowMax?: number;
  topicPromptMax?: number;
```
在 `cleanups` 数组内 `registerMessageBuffer(...)` 之后加一项：
```ts
    registerTopicPoller({
      repo,
      adminGroupId,
      enabledGroups,
      scanMs: deps.topicScanMs,
      settleMs: deps.topicSettleMs,
      windowMax: deps.topicWindowMax,
      topicPromptMax: deps.topicPromptMax,
    }),
```

- [ ] **Step 3: runtime 透传**

`lib/runtime.ts` 的 `builders.assemble({ ... })` 调用内，`maxReplyChars: cfg.maxReplyChars,` 之后加：
```ts
        topicScanMs: cfg.topicScanMs,
        topicSettleMs: cfg.topicSettleMs,
        topicWindowMax: cfg.topicWindowMax,
        topicPromptMax: cfg.topicPromptMax,
```

- [ ] **Step 4: typecheck + 全量测试**

Run: `pnpm typecheck && pnpm vitest run`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add lib/config-store.ts lib/assemble.ts lib/runtime.ts
git commit -m "feat(ranking): 配置字段与运行时装配 topic-poller"
```

---

## Task 9: API — `GET /api/ranking`

**Files:**
- Create: `app/api/ranking/route.ts`
- Test: `tests/lib/agent/topic-poller.test.ts` 或新增 `tests/lib/ranking.test.ts`（聚合口径已在 repo 测试覆盖；此处补窗口换算与 KB 命中的单元函数）

为便于测试，把「窗口换算 + KB 命中」抽成可测纯逻辑放 route 内即可，但 KB 命中判定复用现有 `isDuplicateOfHits`。KB 命中直接在 route 内计算，不再单测（isDuplicateOfHits 已有测试）。

- [ ] **Step 1: 创建 route**

`app/api/ranking/route.ts`：
```ts
import { NextRequest, NextResponse } from "next/server"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { ok, fail } from "@/lib/api"
import { embed } from "@/lib/tools/embed"
import { isDuplicateOfHits, DEFAULT_DUP_TOP_K, DEFAULT_DUP_MAX_DISTANCE } from "@/lib/agent/reflection-poller"

// 窗口 → 起始时间戳(ms)。all → 0。
function sinceTs(window: string, now: number): number {
  if (window === "30d") return now - 30 * 86_400_000
  if (window === "all") return 0
  return now - 7 * 86_400_000 // 默认 7d
}

const TOP_KB = 30 // 只对前 N 主题算 KB 命中,控制 embedding 次数

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")))
    const repo = new Repo(sharedDb(cfg.dbPath))
    const now = Date.now()
    const window = req.nextUrl.searchParams.get("window") ?? "7d"
    const since = sinceTs(window, now)

    const ranked = repo.rankingByWindow(since)
    const topics = []
    let gaps = 0
    let questions = 0
    for (let idx = 0; idx < ranked.length; idx++) {
      const r = ranked[idx]
      questions += r.count
      const samples = repo.topicSamples(r.id, 5, since)
      // null = 未评估(排名 TOP_KB 之外不算 KB,避免误标盲区)
      let kbCovered: boolean | null = null
      let kbDistance: number | null = null
      if (idx < TOP_KB) {
        const probe = samples[0] ?? r.title
        const hits = repo.searchKb(await embed(probe), DEFAULT_DUP_TOP_K)
        const dup = isDuplicateOfHits(probe, hits, DEFAULT_DUP_MAX_DISTANCE)
        kbCovered = dup.duplicate
        kbDistance = hits.length ? hits[0].distance : null
        if (!kbCovered) gaps++
      }
      topics.push({
        id: r.id,
        title: r.title,
        count: r.count,
        kbCovered,
        kbDistance,
        lastTs: r.lastTs,
        samples,
      })
    }

    return NextResponse.json(
      ok({
        window,
        totals: { topics: ranked.length, questions, gaps },
        topics,
      })
    )
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 })
  }
}
```

需确认 `reflection-poller.ts` 已 `export` 常量 `DEFAULT_DUP_TOP_K`、`DEFAULT_DUP_MAX_DISTANCE`（见 `reflection-poller.ts:57-58`，已 `export const`）。`sharedDb` / `getConfig` / `embed` 用法与 `app/api/reflection/route.ts` 一致。

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 手测 route(需 build 或 dev 起后)**

见 Task 11 端到端验证；此步仅 typecheck 通过即可提交。

- [ ] **Step 4: Commit**

```bash
git add app/api/ranking/route.ts
git commit -m "feat(ranking): GET /api/ranking 窗口聚合 + KB 命中"
```

---

## Task 10: 后台页面 + 导航入口

**Files:**
- Create: `app/admin/ranking/page.tsx`
- Modify: `components/app-sidebar.tsx`
- Test: 无（UI，端到端手测在 Task 11）

- [ ] **Step 1: 导航加入口**

`components/app-sidebar.tsx`：import 行加图标 `TrendingUp`（lucide-react 内已有），即在现有 `LifeBuoy,` 后加 `TrendingUp,`。在 `navGroups` 的「知识」组 items 内，`反思` 之后加：
```ts
      { href: "/admin/ranking", label: "问题排行", icon: TrendingUp },
```

- [ ] **Step 2: 创建页面**

`app/admin/ranking/page.tsx`（沿用 reflection 页组件族；`usePolling` 支持带 query 的 url）：
```tsx
"use client"

import { useState } from "react"
import { TrendingUp, HelpCircle, ShieldCheck, ShieldAlert } from "lucide-react"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { MetricBadge, MetricBadgeRow } from "@/components/admin/stat"
import { DataState } from "@/components/admin/data-state"
import { usePolling } from "@/components/admin/use-polling"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RelativeTime } from "@/components/relative-time"

type Win = "7d" | "30d" | "all"
interface Topic {
  id: number
  title: string
  count: number
  kbCovered: boolean | null // null = 未评估(TOP_KB 之外)
  kbDistance: number | null
  lastTs: number
  samples: string[]
}
interface Data {
  window: string
  totals: { topics: number; questions: number; gaps: number }
  topics: Topic[]
}

const WINDOWS: { key: Win; label: string }[] = [
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "all", label: "全部" },
]

export default function RankingPage() {
  const [win, setWin] = useState<Win>("7d")
  const { data: d, error, loading, refresh } = usePolling<Data>(`/api/ranking?window=${win}`)

  return (
    <PageShell>
      <PageHeader
        title="问题排行榜"
        description="用户高频提问归并排名,旁标知识库覆盖,辅助针对性补文档。"
        actions={
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w.key}
                size="sm"
                variant={win === w.key ? "default" : "outline"}
                onClick={() => setWin(w.key)}
              >
                {w.label}
              </Button>
            ))}
          </div>
        }
      />

      <MetricBadgeRow>
        <MetricBadge icon={TrendingUp} label="主题数" value={d ? d.totals.topics : "—"} loading={loading} />
        <MetricBadge icon={HelpCircle} label="窗口内提问" value={d ? d.totals.questions : "—"} loading={loading} />
        <MetricBadge
          icon={ShieldAlert}
          label="疑似盲区"
          value={d ? d.totals.gaps : "—"}
          loading={loading}
          tone={d && d.totals.gaps > 0 ? "primary" : undefined}
        />
      </MetricBadgeRow>

      <SectionCard icon={TrendingUp} title="问题排行" description="按窗口内提问数降序;命中提示来自知识库向量近邻。">
        <DataState
          loading={loading}
          error={error}
          empty={!d || d.topics.length === 0}
          onRetry={refresh}
          emptyIcon={TrendingUp}
          emptyTitle="暂无排行数据"
          emptyDescription="用户提问经归类后会出现在这里(随运行逐步积累)。"
          skeleton={<Skeleton className="h-60 w-full" />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>主题</TableHead>
                <TableHead className="text-right">提问数</TableHead>
                <TableHead>知识库</TableHead>
                <TableHead className="text-right">最近提问</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d?.topics.map((t, i) => (
                <TableRow key={t.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <details>
                      <summary className="cursor-pointer font-medium">{t.title}</summary>
                      <div className="mt-1.5 flex flex-col gap-1 border-l-2 pl-2 text-xs text-muted-foreground">
                        {t.samples.map((s, j) => (
                          <p key={j} className="whitespace-pre-wrap">
                            {s}
                          </p>
                        ))}
                      </div>
                    </details>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                  <TableCell>
                    {t.kbCovered === null ? (
                      <Badge variant="outline">未评估</Badge>
                    ) : t.kbCovered ? (
                      <Badge variant="secondary">
                        <ShieldCheck data-icon="inline-start" />
                        已覆盖
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <ShieldAlert data-icon="inline-start" />
                        疑似盲区
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <RelativeTime ts={t.lastTs} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataState>
      </SectionCard>
    </PageShell>
  )
}
```

注意：`MetricBadge` / `MetricBadgeRow` 的导入路径与 props 需与 `app/admin/reflection/page.tsx` 里的一致 —— 实现时以 reflection 页实际 import 为准（本文件按其惯例书写）。若组件路径不同，照 reflection 页更正 import。

- [ ] **Step 3: 校验组件契约**

打开 `app/admin/reflection/page.tsx`，核对 `PageShell`/`PageHeader`/`SectionCard`/`MetricBadge`/`MetricBadgeRow`/`DataState`/`usePolling` 的实际 import 路径与 props 名，逐一对齐 ranking 页。

- [ ] **Step 4: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add app/admin/ranking/page.tsx components/app-sidebar.tsx
git commit -m "feat(ranking): 问题排行后台页与导航入口"
```

---

## Task 11: 端到端验证 + 收尾

**Files:** 无（验证）

- [ ] **Step 1: 全量校验**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: 全绿

- [ ] **Step 2: 生产构建起服务(严禁 next dev)**

Run: `pnpm build && pnpm start`
Expected: 构建成功、`[agent] OneBot 客服 Agent 已启动`

- [ ] **Step 3: 手测 API**

Run: `curl -s 'http://localhost:3000/api/ranking?window=7d' | head -c 400`
Expected: `{"ok":true,"data":{"window":"7d","totals":{...},"topics":[...]}}`（无提问数据时 topics 为空数组、totals 全 0，也算通过）

- [ ] **Step 4: 手测页面**

浏览器开 `http://localhost:3000/admin/ranking`，确认：侧栏「问题排行」入口高亮、时间窗按钮可切换、空态文案正确；若库里已有归类数据则表格渲染、命中 badge 显示。

- [ ] **Step 5: 用 verify skill 或 playwright 截图留证(可选),然后 Commit 收尾**

```bash
git add -A
git commit -m "chore(ranking): 端到端验证通过" --allow-empty
```

---

## Self-Review 摘要（已核对 spec 覆盖）

- 口径「全部用户提问」→ Task 7 用 `groupMemberMessagesBetween`（含 NULL role）✓
- 「LLM 主题提炼」→ Task 6/7 强制 json_schema + 归类校验 ✓
- 「可选时间窗」→ Task 3 `rankingByWindow` + Task 9 window 换算 + Task 10 切换 ✓
- 「榜单 + KB 命中」→ Task 9 `isDuplicateOfHits` + Task 10 badge ✓
- A1 prune 协调 → Task 4 + Task 3 `minTopicCursor` + Task 7 空窗口推进 ✓
- 成本护栏 → Task 8 `topicScanMs`/`topicWindowMax`/`topicPromptMax` ✓
- 类型一致：`insertQuestionTopic`/`insertQuestionOccurrence`/`topicCursor`/`setTopicCursor`/`rankingByWindow`/`topicSamples`/`minTopicCursor`/`classifyItems`/`runScan`/`registerTopicPoller` 全程同名 ✓
