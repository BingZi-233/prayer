# 模块化分层重构 · 阶段 5b（拆 reflection 页）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `app/admin/reflection/page.tsx`（683 行）拆成区块组件 + 集中状态管理，页面本身降到约 200 行。

**Architecture:** 沿用 `components/admin/config/` 已确立的模式 —— **区块组件与状态 hook 同目录**（那里已有 `use-config-form.ts`）。四个页面里 reflection **最省力**：`CompactionRow`、`EntryRow`、`EntryList` 三个组件**都已自带状态**（各自的 `detail`/`pending`/`err` + 异步 `load`），外提几乎零摩擦。

**为什么先做它：** 设计文档阶段 5 把它排在省力到难的第一位，用它先把「拆分手法」跑通，后面 groups/sessions/kb 照做。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（「阶段 5」第 1 条）

## Global Constraints

- **行为不变。** 这是纯重组：组件的 props、渲染结果、异步时序、事件处理一律不变。**唯一允许的改动是把代码搬位置与改 import。**
- **分层硬约束：** 拆出的组件若放进 `components/`，**只可 import `components/*` 与 `lib/core/*`**。`layering.test.ts` 有一条用例卡这个（`components/` 只依赖 `core`）。**实测 `reflection/page.tsx` 目前只 import `@/components/*` 与 `@/lib/core/*`，没有 conversation/knowledge/model —— 所以这次拆分不会撞上它。但改的时候一旦想让组件拿到 `lib/` 其它层的东西，立刻停下问我。**
- **隔离检出：** 本阶段实现者在 **独立 git worktree** 里工作（用户已确认）。主检出（`/Users/ziyou/projects/prayer`）供 controller 用，两边互不干扰。
- **分支**：`refactor/stage5b-reflection`。不 push。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**；也不要对 main 上本就不合 prettier 的文件跑 `--write`。

## 当前结构（实施前自己复核一遍，行号会漂）

```
  1– 46   import + "use client"
 48–100   types：GroupRow, Entry, EntryDetail, Compaction, CompactionDetail, Data
102–112   diff(before, after)          —— 只被 CompactionRow 用
114–216   CompactionRow({ c })         —— 自带 detail/pending/err 状态 + load()
217–242   EntryList({ ... })           —— 纯列表容器
243–385   EntryRow({ ... })            —— 自带 detail/pending/err 状态 + load()
386–683   ReflectionPage()             —— busy/promoteBusy/acting 状态 + compact/autoPromote/act
```

## 目标结构

```
components/admin/reflection/
  types.ts                  # 共享的视图类型（来自 /api/reflection 的响应形状）
  diff.ts                   # diff() —— 只被 CompactionRow 用，可并进 compaction-row.tsx，二选一
  compaction-row.tsx        # CompactionRow
  entry-row.tsx             # EntryRow
  entry-list.tsx            # EntryList
  use-reflection-actions.ts # busy/promoteBusy/acting + compact/autoPromote/act + 数据拉取与刷新
app/admin/reflection/page.tsx  # 只做编排：PageShell/PageHeader/SectionCard + 组装区块
```

**为什么共享类型放 `components/admin/reflection/types.ts`：** 它们既被页面用、也被区块组件用。**不能留在 `app/` 里让组件反向 import `app/`** —— 那方向是反的。

## Task 1: 抽出三个区块组件

**Files:**
- Create: `components/admin/reflection/types.ts`、`compaction-row.tsx`、`entry-row.tsx`、`entry-list.tsx`
- Modify: `app/admin/reflection/page.tsx`

- [ ] **Step 0: 隔离环境准备**

**本阶段的实现者跑在它自己的 git worktree 里**（派发时用 Agent 的 worktree 隔离，整个会话都在隔离副本内，不可能误改主检出）。

worktree 里**没有 `node_modules`**（它被 gitignore，不进 worktree）。依赖本阶段没变，不必重装 —— 从主检出符号链接过来：

```bash
ln -s /Users/ziyou/projects/prayer/node_modules node_modules
pnpm vitest run tests/lib/core/format-duration.test.ts   # 冒烟:确认能跑测试
```

若符号链接后 `better-sqlite3` / `sqlite-vec` 这类 native 模块报错（少数情况下 bindings 路径会失效），**停下报我**，改用主检出跑验证、只在提交前回主检出执行 `pnpm check`。

- [ ] **Step 1: 抽 `types.ts`**

把页面顶部那批**共享**类型搬过来（`GroupRow`、`Entry`、`EntryDetail`、`Compaction`、`CompactionDetail`、`Data`）。**逐个确认谁在用** —— 只被某一个组件用的类型跟着那个组件走，别一股脑塞进 `types.ts`。

- [ ] **Step 2: 抽 `compaction-row.tsx`**

把 `CompactionRow` 整段（含它的 `useState` 与 `load`）搬过去。**代码原样搬，只改 import。**

`diff()` 只被它用 —— 一并搬进本文件（或放 `diff.ts`，二选一，**保持只此一处**）。

- [ ] **Step 3: 抽 `entry-row.tsx`**

把 `EntryRow` 整段（含它的状态与 `load`）搬过去。

- [ ] **Step 4: 抽 `entry-list.tsx`**

把 `EntryList` 搬过去。它是容器组件，注意它给 `EntryRow` 传的 props 一个不差。

- [ ] **Step 5: 页面改为 import 这些区块**

`app/admin/reflection/page.tsx` 删掉已搬走的定义，改成 import。**页面里剩下的应当只有编排与布局。**

- [ ] **Step 6: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: typecheck 无输出；975 用例全过；分层护栏 9 绿（`components/` 仍只依赖 core）。

**并自查**：新组件文件的 import 有没有越出 `components/*` 与 `lib/core/*`？

```bash
grep -n "^import" components/admin/reflection/*.tsx components/admin/reflection/*.ts
```

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor(admin): 拆出 reflection 页的三个区块组件

CompactionRow / EntryRow / EntryList 原本都自带状态、可独立理解,
只是和页面挤在一个 683 行的文件里。按 components/admin/config/ 已有的
模式,区块组件与共享类型放进 components/admin/reflection/。
代码原样搬移,只改 import。"
```

## Task 2: 抽 `use-reflection-actions.ts`

**Files:**
- Create: `components/admin/reflection/use-reflection-actions.ts`
- Modify: `app/admin/reflection/page.tsx`
- **Modify: `tests/ui/admin-knowledge-contracts.test.ts`**（见下，Task 1 实施时才发现）

> **⚠️ 会打破一条已有的契约测试（Task 1 实施者发现，原计划未提）。**
>
> `tests/ui/admin-knowledge-contracts.test.ts:36-43` 的
> 「preserves reflection moderation and promotion semantics」，**直接读页面源码**并断言它含：
>
> ```ts
> expect(source).toContain('action: "approve" | "reject" | "promote"')
> expect(source).toContain('"/api/reflection/compact"')
> expect(source).toContain('"/api/reflection/promote"')
> expect(source).toContain('method: "PATCH"')
> ```
>
> 本任务把这三个动作搬进 hook 后，这四段字符串**不再出现在页面里** → 该用例必红。
>
> **修法：把新 hook 文件加进那个用例的读取列表**，让它同时读页面与 hook（断言的对象是「这套动作的语义仍在」，不是「必须写在某个文件里」）：
>
> ```ts
> const source = [await read("app/admin/reflection/page.tsx"), await read("components/admin/reflection/use-reflection-actions.ts")].join("\n")
> ```
>
> **不要**为了让测试过而把动作留在页面里 —— 那是本末倒置。**也不要**删掉那条断言。
>
> 顺带核一下同一文件 `:7-17` 那条（断言页面含 `<TableShell` 与 `@/components/admin/table-shell`）—— Task 1 之后它**仍然通过**，但若本任务又搬动了相关 JSX，同样要处理。

- [ ] **Step 1: 先看清页面剩下的状态是几块**

`ReflectionPage` 里现在有：`busy`、`promoteBusy`、`acting`、数据本身与刷新、以及 `compact()`/`autoPromote()`/`act()` 三个动作。

**动手前先判断**：这些状态与动作是**一体**还是**可再分**？特别看 `act()` 是否依赖 `busy`/`acting`、`compact()` 与 `autoPromote()` 是否互相独立。**若它们互相纠缠（例如共同维护一份「正在操作哪一行」的锁），就整体进一个 hook，不要硬拆。** 拿不准停下问我。

- [ ] **Step 2: 抽出 hook**

把状态 + 动作 + 数据拉取/刷新搬进 `use-reflection-actions.ts`，页面改为调用它。**逻辑原样搬，只改承载形式。**

- [ ] **Step 3: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 同上。

**并确认页面行数真的降下来了**：

```bash
wc -l app/admin/reflection/page.tsx
```

Expected: 约 200 行（设计文档的估计）。**若仍在 300 行以上，说明还有东西没搬出去** —— 回报里说明是哪些、为什么留着。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(admin): reflection 页的状态与动作收进 use-reflection-actions

页面自此只做编排。区块组件与状态 hook 同目录,沿用
components/admin/config/ 的模式。"
```

## Task 3: 真机验证（本阶段特有）

**为什么必须做：** `docs/development.md` 明写「涉及页面时应真机验证」，且这是第一个被拆的后台页 —— 拆分本身可能改变渲染时序或事件绑定。

- [ ] **Step 1: 按仓库的隔离配方起一个实例**

配方见 `docs/development.md` 的「环境与验证」一节：**临时数据库、独立 Claude 配置目录、清空 QQ/TG 连接参数、关闭知识库预热与主动回复**，避免开发检查触发真实客服应答。对应的环境变量：

```bash
mkdir -p /tmp/verify-5b
DB_PATH=/tmp/verify-5b/agent.db \
CLAUDE_CONFIG_DIR=/tmp/verify-5b/claude-config \
ONEBOT_WS_URL= \
TELEGRAM_ENABLED_CHATS= \
ADMIN_GROUP_ID= \
NEXT_DIST_DIR=.next-verify \
pnpm dev
```

**自己核对**这几个变量确实是这套配置要用的（读 `lib/core/config/env.ts` 的 `seedFromEnv`）；若还有控制「知识库预热」「主动回复」的开关**不在 env 里而在 AppConfig**，起服务后先从后台把那两项关掉。**这一步的目的是「不让任何真实客服应答发生」——宁可多关，不要漏。**

- [ ] **Step 2: 用浏览器打开 `/admin/reflection`**

（可用 Playwright MCP 工具，或自己开浏览器。）

**逐项核对与拆分前一致：**
- 页面正常渲染，两个区块（压缩记录 / 待审条目）都在
- 展开某条压缩记录 → 详情懒加载出来
- 展开某条条目 → 详情懒加载出来
- 三个动作按钮（压缩 / 自动升格 / 单条 approve·reject·promote）点击后行为与本阶段之前一致（能点、有 loading、有 toast）
- 轮询没有把展开状态冲掉

**若无法起服务或无法开浏览器，如实报告，不要跳过这项就说完成。**

- [ ] **Step 3: 记录结果**

把实际观察到的现象写进回报（**截图更好**）。**任何与拆分前不一致的现象都要报出来**，哪怕很小。

- [ ] **Step 4: 清理**

```bash
rm -rf /tmp/verify-5b
```

（`.next-verify` 已 gitignore，可留。）

## Task 4: 收口

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

- [ ] **Step 2: 清理 worktree**

主检出里（worktree 外）执行：

```bash
cd /Users/ziyou/projects/prayer
git worktree remove .claude/worktrees/stage5b
```

（合回 main 之后再做，见下。）

- [ ] **Step 3: 工作区干净**

```bash
git status --short
```

## 给 5c–5e 的注意事项

1. **本阶段跑通的手法**（区块组件 + 同目录 hook + 共享类型单独一个 `types.ts`）后面三个页面照做。
2. **`components/` 只可依赖 `core`** —— 拆组件前先确认该页面的 import 没越过这条线（reflection 没越，groups/sessions/kb 要各自确认）。
3. **sessions 页是四者里最硬的**：设计文档说它有**八个 ref** 跨 `openSession` ↔ effect ↔ poller 共享、且 URL 同步与三个 effect 是一体的竞态治理，**必须整体进同一个 hook**。
