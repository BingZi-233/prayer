# 模块化分层重构 · 阶段 0（清永久违规 + 建护栏）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清掉两条会让分层永久失效的逆向依赖，并让 `tests/architecture/layering.test.ts` 以空基线落地，为后续 6 个搬迁阶段提供机器护栏。

**Architecture:** 两处行为不变的依赖调整——把 `KB_SEARCH_SQL` 从工具层下沉到独立的纯常量模块（避开 cs 子进程 strip-only 不能加载参数属性的限制），把 `loadGroupMembers` 对 `getRuntime()` 的向上依赖反转成由调用方注入 `fetchFn`。随后建立结构契约测试：按「目标层」给每个 `lib/` 文件归层，断言不存在未登记的逆向依赖，并用合成样例自检扫描器不会因失灵而空过。

**Tech Stack:** TypeScript 5.9、Node 20（ESM）、Vitest 4、pnpm、Next.js 16.3 App Router。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`

## Global Constraints

- **行为不变。** 本阶段只改依赖方向与常量归属。任何函数的运行时行为、SQL 文本、提示词文案、模型参数都必须一字不动。
- **不引入新依赖。** 结构契约测试只用 `node:fs` / `node:path` / `vitest`。
- **旧路径直接删，不写兼容 shim。** 删掉 `lib/tools/kb.ts` 里的常量定义后不得再 re-export。
- **分支**：全程在已存在的 `refactor/modularize-layering` 上提交；不推 main。
- **提交信息**：Conventional Commits + 中文正文，与现有 git log 一致。
- **分层映射按「目标层」判定**，不按磁盘当前位置。`lib/channels/types.ts` 现在虽在 `lib/channels/` 下，映射表就当它是 `core`，因为它最终去 `lib/core/chat/`。
- 验证命令一律用 `pnpm`，不用 `npx`。

## File Structure

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `lib/db/kb-sql.ts` | 知识检索 SQL 的唯一事实源；**零 import**，cs 子进程按路径直接加载 | 新建 |
| `lib/tools/kb.ts` | 知识检索工具层（`runKbSearch`、`KB_TOOL_DESC`）；仍只允许 `import type` | 删常量 |
| `lib/db/repositories/knowledge.ts` | 知识仓储；改从 `../kb-sql.ts` 取 SQL | 改 import |
| `lib/onebot/members-fetch.ts` | 群成员拉取 + 缓存；去掉对组合根的向上依赖 | 改签名 |
| `app/api/onebot/admins/route.ts` | 注入 `fetchFn` | 改调用点 |
| `app/api/onebot/members/route.ts` | 注入 `fetchFn` | 改调用点 |
| `plugins/cs/scripts/cs-mcp.ts` | cs 子进程入口；按硬编码路径动态 import 主仓模块 | 改路径 |
| `tests/plugins/cs/cs-mcp.test.ts` | cs 插件检索过滤的回归测试 | 改 import |
| `tests/architecture/layering.test.ts` | 分层结构契约测试 | 新建 |
| `docs/development.md` | 补分层规则 + 待改写条目清单 | 追加 |
| `CLAUDE.md` | Git 约定增补 `refactor/*` 前缀 | 追加 |

## Task 1: 把 KB_SEARCH_SQL 下沉到 lib/db/kb-sql.ts

**Files:**
- Create: `lib/db/kb-sql.ts`
- Modify: `lib/tools/kb.ts`（删除 L17-32 的注释块与常量）
- Modify: `lib/db/repositories/knowledge.ts:3`
- Modify: `plugins/cs/scripts/cs-mcp.ts:55-59,67`
- Test: `tests/plugins/cs/cs-mcp.test.ts:4`

**背景（动手前必读）：** `lib/tools/kb.ts` 顶部的注释写明——cs 插件子进程以 Node strip-only 模式按路径直接加载它，而 `lib/db/repositories/knowledge.ts` 的类用了**参数属性**（`constructor(private readonly sql: SqliteContext)`），strip-only 无法处理。所以 `KB_SEARCH_SQL` **不能**搬进仓储类所在文件；必须放进一个零 import 的独立模块。

- [ ] **Step 1: 先改测试的 import，制造失败**

`tests/plugins/cs/cs-mcp.test.ts:4` 改为：

```ts
import { KB_SEARCH_SQL } from "@/lib/db/kb-sql"
```

同文件 L6 的注释同步改为：

```ts
// cs 插件子进程的 kb_search 用 KB_SEARCH_SQL 直接查库(lib/db/kb-sql.ts 唯一事实源)。
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/plugins/cs/cs-mcp.test.ts`
Expected: FAIL —— 无法解析模块 `@/lib/db/kb-sql`

- [ ] **Step 3: 新建 lib/db/kb-sql.ts**

SQL 文本必须与 `lib/tools/kb.ts` 里的原样一致，逐字符复制：

```ts
/**
 * 知识检索的向量近邻 SQL(唯一事实源)。
 * 过滤 reflection_meta.status:rejected(人工纠错须立刻从检索消失)与
 * promoted(已升格为正式文档,避免与升格文档双份占坑)。
 * 消费者:KnowledgeRepository.searchKb 与 cs 插件子进程的内联语句——此前
 * 插件侧内联副本漏了过滤,管理员驳回的错误知识仍会经 kb_search 工具漏给用户。
 *
 * 本文件不得引入任何 import:cs 子进程以 Node strip-only 模式按路径直接加载它。
 */
export const KB_SEARCH_SQL = `SELECT c.id, c.content, c.source, v.distance
     FROM kb_vec v
     JOIN kb_chunks c ON c.id = v.chunk_id
     LEFT JOIN reflection_meta m ON m.chunk_id = c.id
     WHERE v.embedding MATCH ? AND k = ?
       AND COALESCE(m.status, 'approved') NOT IN ('rejected', 'promoted')
     ORDER BY v.distance`
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/plugins/cs/cs-mcp.test.ts`
Expected: PASS

- [ ] **Step 5: 仓储改指新位置**

`lib/db/repositories/knowledge.ts:3` 改为：

```ts
import { KB_SEARCH_SQL } from "../kb-sql.ts"
```

- [ ] **Step 6: cs 子进程改指新位置**

`plugins/cs/scripts/cs-mcp.ts` 中，把 L55-59 的两次动态 import 拆成两次：

```ts
  const { embed } = await import(
    pathToFileURL(join(root, "lib/tools/embed.ts")).href
  )
  const { runKbSearch, KB_TOOL_DESC } = await import(
    pathToFileURL(join(root, "lib/tools/kb.ts")).href
  )
  const { KB_SEARCH_SQL } = await import(
    pathToFileURL(join(root, "lib/db/kb-sql.ts")).href
  )
```

同文件 L67 的注释改为：

```ts
  // 与 repo.searchKb 共用 KB_SEARCH_SQL(lib/db/kb-sql.ts 唯一事实源):此前内联副本
```

- [ ] **Step 7: 从 lib/tools/kb.ts 删除常量**

删掉 `lib/tools/kb.ts` 中 L17-32 整段（`/** 知识检索的向量近邻 SQL(唯一事实源)。…*/` 注释块 + `export const KB_SEARCH_SQL = …` 语句）。保留文件开头的 strip-only 说明注释、`KB_TOOL_DESC`、`runKbSearch` 及其余内容不变。

- [ ] **Step 8: 确认没有残留引用**

Run: `grep -rn "KB_SEARCH_SQL" --include='*.ts' app lib tests plugins scripts`
Expected: 只剩 4 个文件——`lib/db/kb-sql.ts`（定义）、`lib/db/repositories/knowledge.ts`、`plugins/cs/scripts/cs-mcp.ts`、`tests/plugins/cs/cs-mcp.test.ts`。`lib/tools/kb.ts` 不再出现。

- [ ] **Step 9: 跑相关测试**

Run: `pnpm vitest run tests/plugins/cs/ tests/lib/db/ tests/lib/tools/`
Expected: 全部 PASS

- [ ] **Step 10: 提交**

```bash
git add lib/db/kb-sql.ts lib/tools/kb.ts lib/db/repositories/knowledge.ts \
  plugins/cs/scripts/cs-mcp.ts tests/plugins/cs/cs-mcp.test.ts
git commit -m "refactor(kb): KB_SEARCH_SQL 下沉到 lib/db/kb-sql.ts

仓储层此前从工具层 lib/tools/kb.ts 取 SQL 常量,属于向上依赖。
搬到零 import 的独立模块后,仓储与 cs 子进程都向下依赖它。
不能直接搬进仓储文件:cs 子进程是 strip-only 运行,加载不了
带参数属性的仓储类。"
```

## Task 2: 把 members-fetch 的向上依赖反转成注入

**Files:**
- Modify: `lib/onebot/members-fetch.ts:6,57-65,71-74,87-88`
- Modify: `app/api/onebot/admins/route.ts:2-8,49-52`
- Modify: `app/api/onebot/members/route.ts:3,16`

- [ ] **Step 1: 确认现有测试已全部显式传 fetchFn**

Run: `grep -n "loadGroupMembers(" tests/lib/onebot/members-fetch.test.ts`
Expected: 每一处调用都带 `fetchFn`。若有遗漏，先补上 `fetchFn`，否则 Step 4 会失败。

- [ ] **Step 2: 改 lib/onebot/members-fetch.ts**

删除 L6 的 `import { getRuntime } from "@/lib/runtime"`。

L57-65 的 `LoadGroupMembersOpts` 中，`fetchFn` 改为必填：

```ts
export type LoadGroupMembersOpts = {
  /** 拉取原始成员列表的实现。必填:由调用方注入,避免本模块向上依赖组合根 */
  fetchFn: FetchMembers
  /** 强制绕过缓存 */
  refresh?: boolean
  /** 为 true 时:缓存命中但无 role 字段 → 视为 miss(admins 需要 role) */
  requireRoles?: boolean
  cache?: ReturnType<typeof getNameCache>
}
```

L71-74 的函数签名去掉默认值（否则必填参数与 `= {}` 冲突）：

```ts
export async function loadGroupMembers(
  groupId: number,
  opts: LoadGroupMembersOpts
): Promise<UserNameRow[] | null> {
```

L87-91 删掉 `getRuntime()` 兜底，直接用注入的实现：

```ts
  const p = (async () => {
    const raw = await opts.fetchFn(groupId)
    if (!Array.isArray(raw)) return null
```

- [ ] **Step 3: 改两个调用点**

`app/api/onebot/admins/route.ts` —— 在 L3 的 `import { collectAdmins }` 后新增一行：

```ts
import { getRuntime } from "@/lib/runtime"
```

并把 L49-52 改为：

```ts
      const members = await loadGroupMembers(groupId, {
        refresh,
        requireRoles: true,
        fetchFn: (gid) => getRuntime().getGroupMembers(gid),
      })
```

`app/api/onebot/members/route.ts` —— 在 L3 的 `import { loadGroupMembers }` 后新增一行：

```ts
import { getRuntime } from "@/lib/runtime"
```

并把 L16 改为：

```ts
  const list = await loadGroupMembers(group, {
    refresh,
    fetchFn: (gid) => getRuntime().getGroupMembers(gid),
  })
```

- [ ] **Step 4: 跑测试与类型检查**

Run: `pnpm vitest run tests/lib/onebot/ && pnpm typecheck`
Expected: 全部 PASS，typecheck 无错误

- [ ] **Step 5: 确认不再有向上依赖**

Run: `grep -rn "lib/runtime" lib/onebot lib/channels`
Expected: 无输出

- [ ] **Step 6: 提交**

```bash
git add lib/onebot/members-fetch.ts app/api/onebot/admins/route.ts \
  app/api/onebot/members/route.ts
git commit -m "refactor(onebot): members-fetch 改为注入 fetchFn

此前 lib/onebot/members-fetch.ts 默认 import getRuntime(),让通道层
向上依赖组合根,分层无法成立。改为 fetchFn 必填,由两个 API 路由注入。
行为不变:两处调用点注入的正是原来那份默认实现。"
```

## Task 3: 分层结构契约测试

**Files:**
- Create: `tests/architecture/layering.test.ts`

- [ ] **Step 1: 新建测试文件**

```ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

type Layer =
  | "core"
  | "model"
  | "channels"
  | "knowledge"
  | "conversation"
  | "composition"

/** 数值越大越靠上。文件只可 import 层号 <= 自己的层。 */
const RANK: Record<Layer, number> = {
  core: 0,
  model: 1,
  channels: 2,
  knowledge: 2,
  conversation: 3,
  composition: 4,
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "../..")
const LIB_DIR = join(REPO_ROOT, "lib")

/**
 * 前缀 -> 该文件最终归属的层。
 * 按「目标层」判定,不按磁盘当前位置:lib/channels/types.ts 眼下仍在
 * channels/ 下,但它最终去 lib/core/chat/,这里就记 core。搬迁中途的
 * 物理位置不一致不算违规,只有最终归属错位才算。
 * 顺序敏感:具体文件规则必须排在目录通配之前。
 */
const PREFIX_RULES: Array<[string, Layer]> = [
  ["lib/runtime.ts", "composition"],

  // core —— 目标位
  ["lib/core/", "core"],
  // core —— 当前位置
  ["lib/db/", "core"],
  ["lib/config/", "core"],
  ["lib/bus.ts", "core"],
  ["lib/logger.ts", "core"],
  ["lib/log-context.ts", "core"],
  ["lib/app-context.ts", "core"],
  ["lib/config-store.ts", "core"],
  ["lib/auth.ts", "core"],
  ["lib/settings-writer.ts", "core"],
  ["lib/concurrency.ts", "core"],
  ["lib/utils.ts", "core"],
  ["lib/brand.ts", "core"],
  ["lib/api.ts", "core"],
  ["lib/events.ts", "core"],
  ["lib/name-cache.ts", "core"],
  ["lib/name-cache-store.ts", "core"],
  ["lib/group-name.ts", "core"],
  // 通道词汇:目标 core/chat,当前位置仍在 channels/
  ["lib/channels/types.ts", "core"],
  ["lib/channels/ids.ts", "core"],
  ["lib/channels/enabled-chats.ts", "core"],

  // model
  ["lib/tools/embed.ts", "model"],
  ["lib/agent/sanitize-input.ts", "model"],
  ["lib/agent/json-output.ts", "model"],
  ["lib/agent/timeout.ts", "model"],
  ["lib/usage-stats.ts", "model"],
  ["lib/tool-stats.ts", "model"],
  ["lib/plugins/manager.ts", "model"],

  // knowledge
  ["lib/tools/kb.ts", "knowledge"],
  ["lib/kb-path.ts", "knowledge"],
  ["lib/agent/kb-prefetch.ts", "knowledge"],
  ["lib/agent/reflection-poller.ts", "knowledge"],
  ["lib/agent/reflection-compactor.ts", "knowledge"],
  ["lib/agent/reflection-promoter.ts", "knowledge"],
  ["lib/reflect-promote.ts", "knowledge"],
  ["lib/reflect-stats.ts", "knowledge"],

  // channels
  ["lib/channels/", "channels"],
  ["lib/onebot/", "channels"],

  // conversation(其余 agent/* 与两个装配模块)
  ["lib/agent/", "conversation"],
  ["lib/transcript.ts", "conversation"],
  ["lib/assemble.ts", "conversation"],
]

/**
 * 已退役的前缀。阶段 N 完成搬迁后,把该阶段的旧前缀填进来,
 * 「退役前缀已清空」用例会断言没有任何文件命中它。
 */
const RETIRED_PREFIXES: string[] = []

/**
 * 阶段间容忍的逆向依赖。removedBy 是消掉它的阶段标签。
 * 只应存在阶段间的临时条目,不得长期驻留。
 * 边的写法由 scanLib 产出:两端都去掉扩展名,用 " -> " 连接。
 */
const TOLERATED: Array<{ edge: string; removedBy: string }> = [
  { edge: "lib/agent/reflection-compactor -> lib/agent/agent", removedBy: "3" },
  { edge: "lib/agent/reflection-poller -> lib/agent/agent", removedBy: "3" },
  { edge: "lib/agent/reflection-promoter -> lib/agent/agent", removedBy: "3" },
]

/** 当前所处阶段。每阶段 PR 更新此常量。 */
const CURRENT_STAGE = "0"
const STAGE_ORDER = ["0", "1", "2a", "2b", "3", "4", "5", "6"]

function layerOf(rel: string): Layer | null {
  for (const [prefix, layer] of PREFIX_RULES) {
    const hit = prefix.endsWith("/") ? rel.startsWith(prefix) : rel === prefix
    if (hit) return layer
  }
  return null
}

const TS_EXTS = [".ts", ".tsx"]

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) listFiles(abs, out)
    else if (TS_EXTS.some((ext) => abs.endsWith(ext))) out.push(abs)
  }
  return out
}

function resolveSpecifier(fromAbs: string, spec: string): string | null {
  let rel: string
  if (spec.startsWith("@/")) rel = spec.slice(2)
  else if (spec.startsWith("."))
    rel = relative(REPO_ROOT, resolve(dirname(fromAbs), spec))
  else return null
  return rel.replace(/\.ts$/, "")
}

/** 解析出被导入文件真正的层,兼容 lib/x.ts 与 lib/x/index.ts 两种落点。 */
function layerAt(rel: string): Layer | null {
  for (const candidate of [`${rel}.ts`, rel, `${rel}/index.ts`]) {
    const layer = layerOf(candidate)
    if (layer) return layer
  }
  return null
}

/** 给定两个仓库内相对路径,判断是否构成逆向依赖。 */
function isViolation(fromRel: string, toRel: string): boolean {
  const from = layerOf(fromRel)
  const to = layerOf(toRel)
  if (!from || !to) throw new Error(`未归层: ${fromRel} 或 ${toRel}`)
  return RANK[to] > RANK[from]
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g

function scanLib(): string[] {
  const found: string[] = []
  for (const abs of listFiles(LIB_DIR)) {
    const rel = relative(REPO_ROOT, abs)
    const from = layerOf(rel)
    if (!from) continue
    const src = readFileSync(abs, "utf8")
    for (const match of src.matchAll(IMPORT_RE)) {
      const resolved = resolveSpecifier(abs, match[1])
      if (!resolved) continue
      const to = layerAt(resolved)
      if (!to) continue
      if (RANK[to] > RANK[from])
        found.push(`${rel.replace(/\.tsx?$/, "")} -> ${resolved}`)
    }
  }
  return [...new Set(found)].sort()
}

describe("分层结构契约", () => {
  it("lib 下每个文件都归属于某一层", () => {
    const unassigned = listFiles(LIB_DIR)
      .map((abs) => relative(REPO_ROOT, abs))
      .filter((rel) => layerOf(rel) === null)
    expect(unassigned).toEqual([])
  })

  it("已退役前缀没有任何文件命中", () => {
    const hits = listFiles(LIB_DIR)
      .map((abs) => relative(REPO_ROOT, abs))
      .filter((rel) => RETIRED_PREFIXES.some((p) => rel.startsWith(p)))
    expect(hits).toEqual([])
  })

  it("逆向依赖与容忍集合精确一致", () => {
    expect(scanLib()).toEqual(TOLERATED.map((t) => t.edge).sort())
  })

  it("没有早该消失的容忍条目", () => {
    const stale = TOLERATED.filter(
      (t) =>
        STAGE_ORDER.indexOf(t.removedBy) <= STAGE_ORDER.indexOf(CURRENT_STAGE)
    )
    expect(stale).toEqual([])
  })

  it("扫描器能识别逆向依赖(防止护栏因失灵而空过)", () => {
    // 合法的向下依赖
    expect(isViolation("lib/agent/reflection-poller.ts", "lib/tools/embed.ts")).toBe(false)
    expect(isViolation("lib/tools/kb.ts", "lib/db/kb-sql.ts")).toBe(false)
    // 逆向:core 文件引传输实现
    expect(isViolation("lib/config/chats.ts", "lib/channels/tg/client.ts")).toBe(true)
    // 逆向:知识层引会话层
    expect(isViolation("lib/agent/reflection-poller.ts", "lib/agent/agent.ts")).toBe(true)
  })

  it("components/ 只依赖 core", () => {
    const bad: string[] = []
    for (const abs of listFiles(join(REPO_ROOT, "components"))) {
      const rel = relative(REPO_ROOT, abs)
      const src = readFileSync(abs, "utf8")
      for (const match of src.matchAll(IMPORT_RE)) {
        const resolved = resolveSpecifier(abs, match[1])
        if (!resolved || !resolved.startsWith("lib/")) continue
        const to = layerAt(resolved)
        if (to && RANK[to] > RANK.core) bad.push(`${rel} -> ${resolved}`)
      }
    }
    expect([...new Set(bad)].sort()).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试**

Run: `pnpm vitest run tests/architecture/layering.test.ts`
Expected: 6 个用例全部 PASS

若「逆向依赖与容忍集合精确一致」失败，先看报出的差异：多出来的边说明还有一处未发现的向上依赖（按 spec 的规则修掉或登记为容忍），少了的边说明 Task 1 或 Task 2 没改干净。

参考：在 Task 1、Task 2 都**尚未**完成时跑，这条会报 2 条差额——
`lib/db/repositories/knowledge -> lib/tools/kb` 与 `lib/onebot/members-fetch -> lib/runtime`。
按顺序执行则不会看到。

- [ ] **Step 3: 故意制造一次违规，确认护栏真的会红**

临时在 `lib/config/chats.ts` 顶部加一行：

```ts
import { OneBotClient } from "../channels/qq/client"
```

Run: `pnpm vitest run tests/architecture/layering.test.ts`
Expected: `逆向依赖与容忍集合精确一致` FAIL，报出 `lib/config/chats.ts -> lib/channels/qq/client`

确认后**删掉这一行**，再跑一次确认恢复 PASS。

- [ ] **Step 4: 提交**

```bash
git add tests/architecture/layering.test.ts
git commit -m "test(arch): 加分层结构契约测试

按目标层给每个 lib/ 文件归层,断言不存在未登记的逆向依赖。
以空基线落地:两条永久违规已在 pre阶段修掉,当前仅容忍 3 条阶段间
的 knowledge→conversation 临时边,阶段 3 消掉。
含扫描器自检用例,避免护栏因失灵而空过。"
```

## Task 4: 同步既有文档

**Files:**
- Modify: `docs/development.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 在 docs/development.md 的「模块边界」章节前插入分层规则**

在 `## 模块边界`（约 L19）之前插入：

```markdown
## 分层结构

`lib/` 按能力分五层,单向依赖,只准从上往下:

```
    runtime.ts          # 组合根,接通道 + agent + 后台循环
        ↓
   conversation         # 会话与编排
        ↓
  ┌─────┴─────┐
channels   knowledge    # 通道实现 / 知识库与反思(同级,互不依赖)
  └─────┬─────┘
        ↓
      model             # SDK 调用与模型 I/O
        ↓
       core             # 地基:db、config、日志、总线、通道词汇
```

- 新增消息通道写 `lib/channels/<通道>/`;新增 Agent 能力写 `lib/conversation/`;
  新增知识库能力写 `lib/knowledge/`。
- `app/` 可依赖全部;`components/` 只可依赖 `core`。
- 规则由 `tests/architecture/layering.test.ts` 执行,不靠自觉。跨层依赖会直接让测试失败。

### 搬迁中:待改写条目

`lib/` 正分阶段搬到上述结构。以下条目描述的路径在搬迁完成后不再存在,
**由对应阶段负责改写,不是遗留说明**:

| 条目 | 作废阶段 |
| --- | --- |
| 本节下方「模块边界」中提到 `lib/config/schema.ts`、`lib/config/{env,migrate,chats,patch}.ts`、`lib/config-store.ts`、`lib/db/repositories/`、`lib/db/migrations/` 的位置 | 2a |
| 「模块边界」中涉及 `channels/` 承载类型与词汇的表述 | 2b |
| `lib/tools/`、`lib/plugins/` 两个目录的存在 | 3 |
| `lib/agent/` 目录的存在(拆为 `conversation/` 与 `knowledge/`) | 4 |
```

- [ ] **Step 2: 修正 docs/development.md 中被证伪的一句**

`docs/development.md` 的「模块边界」里有一句「`lib/config-store.ts` 负责配置读写及存量导入兼容，只依赖存储的两个键值操作」。该描述与代码不符——它运行时 import `channels/enabled-chats`。改为：

```markdown
- `lib/config-store.ts` 负责配置读写及存量导入兼容，依赖 `lib/db/repositories/config.ts` 与
  `lib/channels/enabled-chats.ts`。新增纯业务规则应放在专门模块，便于脱离 Next.js 与数据库测试。
```

- [ ] **Step 3: 在 CLAUDE.md 的 Git 约定里增补 refactor 前缀**

`CLAUDE.md` 的 `## Git 约定` 一节，把「功能分支开发(`feat/*`),不直接提交 main。」改为两行：

```markdown
- 功能分支开发(`feat/*`),不直接提交 main。
- 纯结构性重构用 `refactor/*` 前缀(目录重组、文件搬迁、无行为变更)。
```

- [ ] **Step 4: 确认没引入格式问题**

Run: `pnpm format && git diff --stat`
Expected: 格式统一。若 `pnpm format` 改动了本任务之外的文件，说明仓库存量格式已漂移——只提交本任务涉及的两个文件。

- [ ] **Step 5: 提交**

```bash
git add docs/development.md CLAUDE.md
git commit -m "docs: 补分层结构规则与待改写条目清单

development.md 增补五层依赖规则与各层落点,并列出搬迁完成后会作废的
既有条目及其负责阶段;同时修正一句与代码不符的描述(config-store 并非
只依赖两个键值操作)。CLAUDE.md 的 Git 约定增补 refactor/* 前缀。"
```

## Task 5: 全量验证

- [ ] **Step 1: 跑完整检查**

Run: `pnpm check`
Expected: typecheck、lint、全部 Vitest 通过

- [ ] **Step 2: 确认本阶段的目标已达成**

Run: `grep -rn "lib/runtime" lib/onebot lib/channels; grep -rn "KB_SEARCH_SQL" lib/tools/kb.ts; node -e "1"`
Expected: 前两条 grep 均无输出——向上依赖与常量都已搬走。

- [ ] **Step 3: 确认容忍集合只剩 3 条**

Run: `pnpm vitest run tests/architecture/layering.test.ts 2>&1 | tail -20`
Expected: 全绿。`TOLERATED` 恰为 3 条 reflection 边。

- [ ] **Step 4: 提交（若 Step 1-3 有格式修正）**

```bash
git add -A
git commit -m "chore: 阶段 0 收尾验证"
```

若 Step 2 有输出或 Step 3 未全绿，**不要提交**，回到对应任务修复。
