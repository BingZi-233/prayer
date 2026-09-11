# 模块化分层重构 · 阶段 5a（清理与统一）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先清掉后台页面上三处「同一个东西散在多处」的债务 —— 删死代码、把渠道中文标签合成一处、把时长格式化合成一处。

**Architecture:** 小范围、可独立验证的前置清理。**先做这一步，后面拆页面时新抽出的组件直接 import 统一后的实现**，不必先复制再合并。纯 UI 侧改动，不碰 `lib/` 的分层。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（「阶段 5」下「顺带清理」三个 bullet）

## Global Constraints

- **行为不变 —— 有一处已同意的例外。** 除下面点名的合并与删除外，页面逻辑一字不动。**唯一例外**：时长格式化统一成最细粒度后，`g.lagMs`（轮询滞后）这类秒级输入会从 `0 分` 显示成 `30 秒`、超 1 小时的从 `90 分` 显示成 `1.5 时`。**这是刻意且已同意的改动**（见 Task 2 Step 1），其余一切照旧。
- **分支**：`refactor/stage5a-dedup`，从 `main` 切出。不直接提交 main，**不 push**。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**；也不要对 main 上本就不合 prettier 的文件跑 `--write`。
- 包管理器用 `pnpm`。

## 三处债务的实测现状

**一、死代码。** `components/admin/nav-list-item.tsx`（866B）全仓 **0 引用**（含动态字符串），确认可删。

**二、渠道中文标签散在 3 处**（设计文档写的「两处」，实测是**三处**）：

| 位置 | 内容 |
| --- | --- |
| `app/admin/sessions/page.tsx:76` | `CHANNEL_LABEL`，**含 `discord → "Discord"`** |
| `app/admin/groups/page.tsx:117` | `channelLabel(c)`，**无 `discord` 映射**，非 qq/tg 直接返回原值 |
| `components/channel-dot.tsx:6` | `CHANNEL_LABEL`（**设计文档与阶段 0 的分析都漏了这处**） |

**三、时长格式化散在 3 处**（设计文档写的「5 处」，实测是 **3 处**）：

| 位置 | 形态 |
| --- | --- |
| `app/admin/groups/page.tsx:93` | `(ms) => \`${Math.round(ms / 60_000)} 分\`` |
| `app/admin/reflection/page.tsx:101-103` | `min`（分钟）+ `hr`（小时，`>= 3600000` 时用） |
| `app/admin/proactive/page.tsx:66-67` | **多一档「秒」粒度**：`< 60_000` 时出「N 秒」，否则「N 分」 |

**注意**：`app/admin/handoff/page.tsx:38` 与 `app/admin/sessions/page.tsx:139` 里的 `const min = Math.max(0, Math.round((Date.now() - since) / 60_000))` **不是格式化函数**，是算出「已过多少分钟」的**局部数字变量**，名字撞车而已，**本阶段不要动它们**。

## Task 1: 统一渠道中文标签

**Files:**
- Create: `lib/core/chat/channel-labels.ts`
- Modify: `app/admin/sessions/page.tsx`、`app/admin/groups/page.tsx`、`components/channel-dot.tsx`

**为什么放 `lib/core/chat/`：** `components/channel-dot.tsx` 要用它，而 `components/` 只可依赖 `core`（分层护栏里有这条用例）。`core/chat/` 已有 `group-name.ts` 这样的 UI 相关模块，先例成立。

- [ ] **Step 1: 新建 `lib/core/chat/channel-labels.ts`**

合并三处，**取并集**（`sessions` 那版有 `discord`，`groups` 那版没有）：

```ts
import type { ChannelId } from "./types"

/** 渠道的中文显示名。全仓唯一出处 —— 三处曾各写一份，且 discord 那条只在其中一处有。 */
const CHANNEL_LABELS: Record<ChannelId, string> = {
  qq: "QQ",
  tg: "Telegram",
  discord: "Discord",
}

/** 未知渠道回退成大写原值（与合并前的行为一致）。 */
export function channelLabel(channel: ChannelId | string): string {
  return (
    CHANNEL_LABELS[channel as ChannelId] ?? String(channel).toUpperCase()
  )
}
```

⚠️ **先把三处的实际内容都读一遍再定这张表**：若某处有本模板没覆盖的键（或大小写不同），以实际为准补全，并在回报里说明。

- [ ] **Step 2: 三处改为引用它**

- `app/admin/sessions/page.tsx`：删掉本地的 `CHANNEL_LABEL`，改成 `import { channelLabel } from "@/lib/core/chat/channel-labels"`，把 L91 的 `CHANNEL_LABEL[channel] ?? channel.toUpperCase()` 换成 `channelLabel(channel)`
- `app/admin/groups/page.tsx`：删掉本地的 `channelLabel` 定义，改成 import
- `components/channel-dot.tsx`：删掉本地的 `CHANNEL_LABEL`，改用 import

**逐处确认行为等价**：特别核 `channel-dot.tsx` 原来对未知渠道的写法（`ch.id.toUpperCase()`）与新函数是否一致。

- [ ] **Step 3: 验证**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；972 用例全过。

再人工核一遍：三处原来各自能显示的渠道，现在都还能显示同样文字。**尤其 `discord`** —— 合并前只有 sessions 那处认识它。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(admin): 渠道中文标签合并为一处

四个后台页面里，渠道显示名散在三处（不是设计文档写的两处 —— 还有一处
在 components/channel-dot.tsx），且 discord 那条只在其中一处有。合并到
lib/core/chat/channel-labels.ts：放 core 是因为 components/ 只可依赖 core。
行为取并集。"
```

## Task 2: 统一时长格式化

**Files:**
- Create: `lib/core/format-duration.ts`
- Modify: `app/admin/groups/page.tsx`、`app/admin/reflection/page.tsx`、`app/admin/proactive/page.tsx`

**为什么放 `lib/core/`：** 它是纯函数、零依赖，且后台页面与（将来的）组件都可能用。

- [ ] **Step 1: 新建 `lib/core/format-duration.ts`**

合并三处，**保留最细的那档粒度**（`proactive` 支持「秒」，其余两处只到「分」）：

```ts
/**
 * 毫秒时长的人读格式。全仓唯一出处。
 * 粒度取合并前三处里最细的一档：不足 1 分钟出「N 秒」（原 proactive 的行为），
 * 满 1 小时出「N 时」（原 reflection 的行为）。
 */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`
  if (ms >= 3_600_000) {
    return `${(ms / 3_600_000).toFixed(ms % 3_600_000 ? 1 : 0)} 时`
  }
  return `${Math.round(ms / 60_000)} 分`
}
```

⚠️ **这会造成两处可见的显示变化，已获明确同意，照此执行：**

实测调用点里**确实有秒级输入** —— `groups:412`、`reflection:622`、`proactive:212` 都传 `g.lagMs`（轮询滞后），几十秒是常态。所以：

| 输入 | 原（`min`） | 新（`formatDuration`） |
| --- | --- | --- |
| 30 秒 | `0 分` | `30 秒` |
| 90 分钟 | `90 分` | `1.5 时` |

**两处变化都是刻意的、已同意的**（原「0 分」反而误导）。**不要为了「行为不变」而回退成带参数版本。**

**并在回报里列出受影响的调用点**（哪些站点会显示得和以前不同）。

- [ ] **Step 2: 三处改为引用它**

把各自的 `min`/`hr` 换成 import 的 `formatDuration`。**若某处原本只输出到「分」而调用点确实可能出现秒级输入**，按 Step 1 的结论处理。

- [ ] **Step 3: 验证**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；972 用例全过。

**建议为新函数补几条边界测试**（0ms、59s、60s、59min、1h、1h30m）—— 这是本任务唯一有真实逻辑的地方，值得覆盖。若补了测试，用例数会 +N，属正常（与本阶段其它任务无关）。`tests/lib/core/format-duration.test.ts`。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(admin): 时长格式化合并为一处

三处实现（不是设计文档写的五处 —— 另外两处 local 变量名字撞车但语义
不同，已排除）合并到 lib/core/format-duration.ts，粒度取最细的一档。"
```

## Task 3: 删除死代码

**Files:**
- Delete: `components/admin/nav-list-item.tsx`

- [ ] **Step 1: 再确认一次确实无人引用**

```bash
grep -rn "nav-list-item\|NavListItem" --include='*.ts' --include='*.tsx' app lib components tests scripts plugins 2>/dev/null \
  | grep -v "^components/admin/nav-list-item.tsx"
```

Expected: **无输出**。若有输出，停下报我 —— 说明它活了，不能删。

- [ ] **Step 2: 删除**

```bash
git rm components/admin/nav-list-item.tsx
```

- [ ] **Step 3: 验证**

```bash
pnpm check
```

Expected: typecheck / lint / 972 用例全过。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(admin): 删掉 0 引用的 nav-list-item.tsx

全仓 grep（含动态字符串）确认无人引用。"
```

## Task 4: 全量验证

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出；eslint 0 error；vitest 全过（用例数因 Task 2 可能补了边界测试而增加，属正常）。

- [ ] **Step 2: 三处债务是否真的清了**

```bash
grep -rn "CHANNEL_LABEL\|channelLabel" --include='*.tsx' --include='*.ts' app components
grep -rn "Math.round(ms / 60_000)\|Math.round(ms / 60000)" --include='*.tsx' app/admin
ls components/admin/nav-list-item.tsx 2>&1
```

Expected：第一条只剩**引用**（定义只在 `lib/core/chat/channel-labels.ts`）；第二条无输出（格式化只在 `lib/core/format-duration.ts`）；第三条报不存在。

- [ ] **Step 3: 新增的共享模块能被 `components/` 用**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 全绿（`components/` 只依赖 `core` 那条用例仍通过 —— 新模块在 `core` 里，合法）。

- [ ] **Step 4: 工作区**

```bash
git status --short
```

Expected: 无输出。

本任务不产生新提交。若 Step 1–4 全部符合 Expected，阶段 5a 即可收口。

## 留给后续阶段的注意事项

1. **`lib/` 的护栏不扫 `app/`** —— 本阶段改的全是 `app/` 与 `components/`，跨层护栏管不到。**但有一点它管得到**：`components/` 只可依赖 `core`。所以任何放进 `components/` 的共享东西**必须**在 `core/` 里 —— 本阶段那两个新模块就是因此放在 `lib/core/` 的。
2. **5b–5e 拆页面时**，新抽出的区块组件若放 `components/`，**不能 import `conversation`/`knowledge`/`model`**（分层用例会红）；需要那些类型或数据就留在 `app/`。
