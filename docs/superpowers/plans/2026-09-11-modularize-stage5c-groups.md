# 模块化分层重构 · 阶段 5c（拆 groups 页）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `app/admin/groups/page.tsx`（622 行）拆成区块组件 + 状态 hook，页面本身降到约 200 行。

**Architecture:** 沿用 `components/admin/config/` 已确立的模式。摩擦点比 reflection 大：Sheet 的三个 Tri 状态经 `openEditor` 读取 `globals` 默认值，表格的 toggle/clearPolicy 动作调用页面级 fetch + refresh。拆法：纯函数与类型外提，表格与 Sheet 做成**受控组件**（状态仍在页面/hook），表单状态收进 `use-group-policy-form`。

**为什么它排 reflection 之后：** 设计文档阶段 5 按省力到难排序，groups 是第二（Sheet 状态跨组件、表格动作回写页面是主要摩擦点）。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5.9、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（「阶段 5」第 2 条）

## Global Constraints

- **行为不变。** 这是纯重组：组件 props、渲染结果、异步时序、事件处理一律不变。**唯一允许的改动是把代码搬位置与改 import、以及为组件/hook 引入新的接口签名（props 参数）。**
- **分层硬约束：** 拆出的组件放进 `components/`，**只可 import `components/*` 与 `lib/core/*`**。`layering.test.ts` 有一条用例卡这个（`components/` 只依赖 `core`）。**实测 `groups/page.tsx` 目前只 import `@/components/*` 与 `@/lib/core/*`，没越界。** 拆分后 `use-group-policy-form.ts`、`group-table.tsx`、`policy-sheet.tsx`、`types.ts`、`policy-payload.ts` 的 import 也必须守在这条线内。改的时候一旦想让组件拿到 `lib/` 其它层的东西，立刻停下问我。
- **隔离检出：** 本阶段实现者在 **独立 git worktree** 里工作（用户已确认）。主检出（`/Users/ziyou/projects/prayer`）供 controller 用，两边互不干扰。
- **分支**：`refactor/stage5c-groups`。不 push。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**；也不要对 main 上本就不合 prettier 的文件跑 `--write`。

## 当前结构（实施前自己复核一遍，行号会漂）

```
  1– 51   import + "use client"
 53– 92   types：Tri, GroupPolicy, Row, Globals, ActivityData
 94–102   triFrom(v) / triToBool(t)
104–114   rowLabel(r, nameFn)
116–128   policyWritePayload(row, policy)
130–280   GroupsPage()  —— 状态 + openEditor + toggle + savePolicy + clearPolicy
282–622   JSX：PageShell/PageHeader + MetricRows + DataState/TableShell 表格 + Sheet
```

## 目标结构

```
components/admin/groups/
  types.ts                  # 共享视图类型（来自 /api/groups/activity 的响应形状）
  policy-payload.ts         # 外提的全部纯函数：triFrom/triToBool/rowLabel/policyWritePayload
  group-table.tsx           # GroupTable —— 表格，受控组件
  policy-sheet.tsx          # PolicySheet —— Sheet 弹窗，受控组件
  use-group-policy-form.ts  # 表单状态 hook：editing + 三个 Tri 状态 + openEditor/closeEditor
app/admin/groups/page.tsx   # 只做编排 + toggle/savePolicy/clearPolicy 三个 fetch 动作
```

**为什么类型与纯函数分开：** 与 5b 一致 —— 共享类型放 `types.ts`，被页面与全部组件 import；纯函数放 `policy-payload.ts`（命名沿用 spec，实际承载「外提的全部纯函数」，含 `rowLabel` 这个展示助手）。**不能留在 `app/` 里让组件反向 import `app/`**。

**为什么表格与 Sheet 做成受控组件：** 它们的数据与动作仍依赖页面级的 `usePolling` + fetch + `refresh`，把状态搬进组件会造成组件直接 fetch（越出 `components/` 依赖边界，也破坏「组件只依赖 core」）。受控组件接收 `rows`/`busyKey`/`name`/回调 作 props，状态留在页面。

## Task 1: 抽 types.ts + policy-payload.ts

**Files:**
- Create: `components/admin/groups/types.ts`、`components/admin/groups/policy-payload.ts`
- Modify: `app/admin/groups/page.tsx`

- [ ] **Step 0: 隔离环境准备**

本阶段的实现者跑在它自己的 git worktree 里（派发时用 Agent 的 worktree 隔离）。

worktree 里**没有 `node_modules`**。依赖本阶段没变，不必重装 —— 从主检出符号链接过来：

```bash
ln -s /Users/ziyou/projects/prayer/node_modules node_modules
pnpm vitest run tests/lib/core/format-duration.test.ts   # 冒烟:确认能跑测试
```

若符号链接后 Turbopack 起 dev 报 `Symlink [project]/node_modules is invalid`（真机验证阶段会撞上），**按 Task 4 Step 0 的替代法**：删符号链接、本地 `CI=true pnpm install`。静态验证（typecheck/test）阶段符号链接够用。

- [ ] **Step 1: 抽 `types.ts`**

把 L53–92 的五个类型（`Tri`、`GroupPolicy`、`Row`、`Globals`、`ActivityData`）原样搬进 `types.ts`，**加 export**。其中 `Row.channel` 用 `ChannelId`，需要 `import type { ChannelId } from "@/lib/core/chat/types"`（合法：components 依赖 core）。

```ts
import type { ChannelId } from "@/lib/core/chat/types"

export type Tri = "inherit" | "on" | "off"

export interface GroupPolicy {
  proactiveEnabled?: boolean
  proactiveSilenceMs?: number
  notifyAdminOnHandoff?: boolean
}

export interface Row {
  channel: ChannelId
  chatId: string
  /** 兼容旧字段；勿作主键 */
  groupId: number
  /** 管理群：只跑管理命令，不可勾生效、无策略 */
  isAdmin?: boolean
  enabled: boolean
  messageCount: number
  lastTs: number
  cursor: number
  sedimentedCount: number
  policy: GroupPolicy
  hasOverride: boolean
  policyKey: string
  effective: {
    proactiveEnabled: boolean
    proactiveSilenceMs: number
    notifyAdminOnHandoff: boolean
  }
}

export interface Globals {
  proactiveEnabled: boolean
  proactiveSilenceMs: number
  notifyAdminOnHandoff: true
}

export interface ActivityData {
  groups: Row[]
  globals: Globals
}
```

- [ ] **Step 2: 抽 `policy-payload.ts`**

把 L94–128 的四个纯函数（`triFrom`、`triToBool`、`rowLabel`、`policyWritePayload`）原样搬进 `policy-payload.ts`，**加 export**，import 类型改从 `./types`：

```ts
import type { Tri, GroupPolicy, Row } from "./types"

export function triFrom(v: boolean | undefined): Tri {
  if (v === undefined) return "inherit"
  return v ? "on" : "off"
}

export function triToBool(t: Tri): boolean | undefined {
  if (t === "inherit") return undefined
  return t === "on"
}

export function rowLabel(
  r: Pick<Row, "channel" | "chatId" | "groupId">,
  nameFn: (id: number) => string
): string {
  if (r.channel === "qq" && r.groupId > 0) return nameFn(r.groupId)
  if (r.channel === "tg" && r.groupId !== 0) {
    const n = nameFn(r.groupId)
    if (n && n !== String(r.groupId)) return n
  }
  return r.chatId
}

/**
 * 策略写 payload：新键 policyKey；QQ 同时清掉历史裸群号键，避免 getGroupPolicy 回退读到旧覆盖。
 */
export function policyWritePayload(
  row: Pick<Row, "channel" | "chatId" | "policyKey">,
  policy: GroupPolicy | null
): Record<string, GroupPolicy | null> {
  const out: Record<string, GroupPolicy | null> = { [row.policyKey]: policy }
  if (row.channel === "qq" && row.chatId) {
    out[row.chatId] = null
  }
  return out
}
```

- [ ] **Step 3: 页面改为 import 这两个文件**

`app/admin/groups/page.tsx` 删掉 L53–128 的类型与纯函数定义，改成：

```ts
import type { Tri, GroupPolicy, Row, ActivityData } from "@/components/admin/groups/types"
import { triFrom, triToBool, rowLabel, policyWritePayload } from "@/components/admin/groups/policy-payload"
```

页面里原 `type Tri`、`interface GroupPolicy/Row/Globals/ActivityData` 与四个函数的定义全部删除，其余引用点不变（名字没变）。

- [ ] **Step 4: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；975 用例全过（此时契约测试还没红 —— 页面里仍有 `<TableShell`、`<RowActions`，`policyWritePayload` 也还在页面里作为 import 出现）。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor(admin): groups 页的类型与纯函数外提

Tri/GroupPolicy/Row/Globals/ActivityData 五个类型与 triFrom/triToBool/
rowLabel/policyWritePayload 四个纯函数,页面与后续区块组件共用,
按 5b 模式放进 components/admin/groups/ 的 types.ts 与 policy-payload.ts。
代码原样搬移,只改 import。"
```

## Task 2: 抽 use-group-policy-form.ts

**Files:**
- Create: `components/admin/groups/use-group-policy-form.ts`
- Modify: `app/admin/groups/page.tsx`

**摩擦点（本 Task 的核心）：** 原 `openEditor` 里 `silenceMode` 走「继承」分支时，`silenceMin` 初值来自 `globals?.proactiveSilenceMs`。外提成 hook 后，`globals` 作为参数传入 `openEditor(r, globals)`。

- [ ] **Step 1: 写 hook**

创建 `use-group-policy-form.ts`。**代码原样搬，只把状态与 `openEditor` 收进 hook 并返回。** 校验（静默阈值非负）留在页面 `savePolicy`，不进 hook，避免「空策略」与「校验失败」两个语义混淆：

```ts
import { useState } from "react"
import { triFrom } from "./policy-payload"
import type { Tri, Globals, Row } from "./types"

export function useGroupPolicyForm() {
  const [editing, setEditing] = useState<Row | null>(null)
  const [proactiveTri, setProactiveTri] = useState<Tri>("inherit")
  const [silenceMode, setSilenceMode] = useState<"inherit" | "custom">(
    "inherit"
  )
  const [silenceMin, setSilenceMin] = useState("3")
  const [handoffTri, setHandoffTri] = useState<Tri>("inherit")

  function openEditor(r: Row, globals?: Globals) {
    setEditing(r)
    setProactiveTri(triFrom(r.policy.proactiveEnabled))
    if (r.policy.proactiveSilenceMs !== undefined) {
      setSilenceMode("custom")
      setSilenceMin(String(Math.round(r.policy.proactiveSilenceMs / 60_000)))
    } else {
      setSilenceMode("inherit")
      setSilenceMin(
        String(Math.round((globals?.proactiveSilenceMs ?? 180_000) / 60_000))
      )
    }
    setHandoffTri(triFrom(r.policy.notifyAdminOnHandoff))
  }

  function closeEditor() {
    setEditing(null)
  }

  return {
    editing,
    proactiveTri,
    setProactiveTri,
    silenceMode,
    setSilenceMode,
    silenceMin,
    setSilenceMin,
    handoffTri,
    setHandoffTri,
    openEditor,
    closeEditor,
  }
}
```

- [ ] **Step 2: 页面改用 hook**

`app/admin/groups/page.tsx`：

- 删掉 L139–145 的表单状态声明（`proactiveTri`/`silenceMode`/`silenceMin`/`handoffTri`）与 L156–169 的 `openEditor` 定义。
- 删掉 L136 的 `const [editing, setEditing] = useState<Row | null>(null)`（editing 现在从 hook 来）。
- 函数体开头加：

```ts
const form = useGroupPolicyForm()
```

- 页面对 `editing`/`proactiveTri`/`setProactiveTri`/`silenceMode`/`setSilenceMode`/`silenceMin`/`setSilenceMin`/`handoffTri`/`setHandoffTri`/`openEditor`/`setEditing(null)` 的引用，改成从 `form` 取。具体替换：
  - `setEditing(null)` → `form.closeEditor()`（共两处：`onOpenChange` 与 `savePolicy` 成功后）
  - `setEditing(r)` 只在 `openEditor` 里出现过，已随 openEditor 进 hook，页面删除
  - `openEditor(r)`（表格 RowActions 的 onSelect）→ 本 Task 暂时先保留，等 Task 3 抽 group-table 时改为 `onEdit` 回调；本 Task 内页面里 openEditor 已不存在，若编译报「openEditor 未定义」，把 `onSelect: () => openEditor(r)` 临时改为 `onSelect: () => form.openEditor(r, globals)`（Task 3 会再改成 `onEdit(r)`）

- 其余引用（`proactiveTri`/`silenceMode`/`silenceMin`/`handoffTri` 在 Sheet JSX 里的 `value`/`onValueChange`）改为 `form.proactiveTri` 等。

> **本 Task 结束时页面仍能编译、能跑。** Sheet JSX 里对表单状态的引用改成 `form.xxx` 后，`setProactiveTri` 等 setter 也从 `form` 取。

- [ ] **Step 3: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；975 用例全过。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(admin): groups 页的 Sheet 表单状态收进 use-group-policy-form

editing 与三个 Tri 状态本是一体(openEditor 一次设置全部),
收进 hook 后页面只留 fetch 动作。globals 作为参数传入 openEditor。"
```

## Task 3: 抽 group-table.tsx + policy-sheet.tsx

**Files:**
- Create: `components/admin/groups/group-table.tsx`、`components/admin/groups/policy-sheet.tsx`
- Modify: `app/admin/groups/page.tsx`

- [ ] **Step 1: 抽 `group-table.tsx`**

把 L326–475 的 `DataState` 内部整段 `<TableShell>…</TableShell>` 搬进 `group-table.tsx`，做成受控组件。**JSX 原样搬，只做三处改动：** `toggle(r, v)` → `onToggle(r, v)`、`openEditor(r)` → `onEdit(r)`、`clearPolicy(r)` → `onClearPolicy(r)`。

```tsx
import { Users, Settings2, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableShell } from "@/components/admin/table-shell"
import { RowActions } from "@/components/admin/row-actions"
import { RelativeTime } from "@/components/relative-time"
import { channelLabel } from "@/lib/core/chat/channel-labels"
import { formatDuration } from "@/lib/core/format-duration"
import { rowLabel } from "./policy-payload"
import type { Row } from "./types"

interface GroupTableProps {
  rows: Row[]
  name: (id: number) => string
  busyKey: string | null
  onToggle: (row: Row, enable: boolean) => void
  onClearPolicy: (row: Row) => void
  onEdit: (row: Row) => void
}

export function GroupTable({
  rows,
  name,
  busyKey,
  onToggle,
  onClearPolicy,
  onEdit,
}: GroupTableProps) {
  return (
    <TableShell minWidth="min-w-[880px]">
      {/* 原 L327–473 的 TableHeader + TableBody 原样搬入,
          仅 toggle→onToggle、openEditor→onEdit、clearPolicy→onClearPolicy */}
    </TableShell>
  )
}
```

**注意表格 JSX 里 `rowLabel(r, name)` 保持原样**（`rowLabel` 已从 `./policy-payload` import）。`useGroupNames()` 的 `name` 由页面传入，表格不自己调 hook。

- [ ] **Step 2: 抽 `policy-sheet.tsx`**

把 L477–619 的 `<Sheet>…</Sheet>` 搬进 `policy-sheet.tsx`，做成受控组件。**JSX 原样搬**，表单状态与 `editing` 从 `form` prop 取，动作走回调：

```tsx
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { channelLabel } from "@/lib/core/chat/channel-labels"
import { formatDuration } from "@/lib/core/format-duration"
import { rowLabel } from "./policy-payload"
import type { Row, Globals } from "./types"
import type { useGroupPolicyForm } from "./use-group-policy-form"

interface PolicySheetProps {
  form: ReturnType<typeof useGroupPolicyForm>
  globals?: Globals
  name: (id: number) => string
  savingPolicy: boolean
  onSave: () => void
  onClear: (row: Row) => void
}

export function PolicySheet({
  form,
  globals,
  name,
  savingPolicy,
  onSave,
  onClear,
}: PolicySheetProps) {
  const { editing, proactiveTri, setProactiveTri, silenceMode, setSilenceMode,
    silenceMin, setSilenceMin, handoffTri, setHandoffTri, closeEditor } = form
  return (
    <Sheet
      open={editing !== null}
      onOpenChange={(o) => !o && closeEditor()}
    >
      {/* 原 L481–618 的 SheetContent 原样搬入,
          仅: setEditing(null)→closeEditor、setProactiveTri 等 setter 已解构、
          savePolicy→onSave、clearPolicy(editing)→onClear(editing) */}
    </Sheet>
  )
}
```

**注意三个 `<Select>` 的 `items={…}` 必须原样保留**（`admin-visual-contracts.test.ts` 有条用例守 Select 的 items map，见 Task 4）。

- [ ] **Step 3: 页面改为 import 这两个区块**

`app/admin/groups/page.tsx` 删掉 L326–475 与 L477–619 两段 JSX，改成：

```tsx
<DataState
  loading={loading}
  error={error}
  empty={rows.length === 0}
  onRetry={refresh}
  emptyIcon={Users}
  emptyTitle="暂无会话活动"
  emptyDescription="生效会话有消息后会出现在这里。也可先在配置页勾选生效会话。"
  skeleton={<Skeleton className="h-40 w-full" />}
>
  <GroupTable
    rows={rows}
    name={name}
    busyKey={busyKey}
    onToggle={toggle}
    onClearPolicy={clearPolicy}
    onEdit={(r) => form.openEditor(r, globals)}
  />
</DataState>

<PolicySheet
  form={form}
  globals={globals}
  name={name}
  savingPolicy={savingPolicy}
  onSave={savePolicy}
  onClear={clearPolicy}
/>
```

删掉页面里现在不再直接引用的 import：`Badge`/`Switch`/`Select*`/`Sheet*`/`Field*`/`Table*`/`TableShell`/`RowActions`/`RelativeTime`/`Settings2`/`RotateCcw`/`Input`/`Spinner`（**逐个确认**：`Users` 仍在页面（DataState 的 emptyIcon），`Skeleton` 仍在，`Badge` 在表格里用所以页面不再需要，其余照此核对）。`rowLabel`/`channelLabel`/`formatDuration` 是否还被页面直接用（savePolicy/toggle 的 toast 文案里用 `channelLabel` 与 `rowLabel`），保留仍在用的。

- [ ] **Step 4: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run tests/architecture/layering.test.ts
pnpm vitest run
```

Expected: typecheck 无输出；layering 护栏 9 绿（`components/` 仍只依赖 core）；**但 `tests/ui/admin-system-contracts.test.ts` 的用例 1、2 会红**（`<TableShell`/`<RowActions` 已搬进 group-table.tsx，页面不再含）—— 这是预期，Task 4 修。**用例 3 仍绿**：`policyWritePayload` 作为 import 语句 + `savePolicy` 里的调用仍在页面里，`enabledChats`/`groupPolicies`/`clearPolicy` 也在（toggle/savePolicy/clearPolicy 留在页面）。

**并自查**新组件 import 没越出 `components/*` 与 `lib/core/*`：

```bash
grep -n "^import" components/admin/groups/*.tsx components/admin/groups/*.ts
```

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor(admin): 拆出 groups 页的表格与策略 Sheet

GroupTable 与 PolicySheet 做成受控组件,状态仍在页面;
表单状态经 use-group-policy-form 传入 Sheet。代码原样搬移,
只改回调与 import。"
```

## Task 4: 修契约测试

**Files:**
- Modify: `tests/ui/admin-system-contracts.test.ts`、`tests/ui/admin-visual-contracts.test.ts`

> **⚠️ 会打破两条契约测试（Task 3 抽组件后必红）。** 断言的对象是「这套语义仍在」，不是「必须写在某个文件里」。修法是把新组件文件加进读取列表，**不要**为了让测试过而把 JSX 留在页面里，**也不要**删掉断言。

- [ ] **Step 1: 修 `admin-system-contracts.test.ts`**

用例 1、2 把新文件 `group-table.tsx` 加进读取列表：

用例 1（L7–17，断言共享 TableShell）：

```ts
it("renders the enabled-chat and plugin tables on the shared table shell", async () => {
  const [groupsPage, groupsTable, plugins] = await Promise.all([
    read("app/admin/groups/page.tsx"),
    read("components/admin/groups/group-table.tsx"),
    read("app/admin/plugins/page.tsx"),
  ])
  const groups = groupsPage + "\n" + groupsTable

  expect(groups).toContain("<TableShell")
  expect(groups).toContain("@/components/admin/table-shell")
  expect(plugins).toContain("<TableShell")
  expect(plugins).toContain("@/components/admin/table-shell")
})
```

用例 2（L19–29，断言共享 RowActions）：

```ts
it("collects secondary row actions into the shared row menu", async () => {
  const [groupsPage, groupsTable, plugins] = await Promise.all([
    read("app/admin/groups/page.tsx"),
    read("components/admin/groups/group-table.tsx"),
    read("app/admin/plugins/page.tsx"),
  ])
  const groups = groupsPage + "\n" + groupsTable

  expect(groups).toContain("<RowActions")
  expect(groups).toContain("@/components/admin/row-actions")
  expect(plugins).toContain("<RowActions")
  expect(plugins).toContain("@/components/admin/row-actions")
})
```

**用例 3（L31–38）不动。** 它断言的 `policyWritePayload`（页面 import + `savePolicy` 调用）、`enabledChats`（toggle）、`groupPolicies`（savePolicy）、`clearPolicy` 四条字符串，拆分后**都仍在页面里**，保持绿。

- [ ] **Step 2: 修 `admin-visual-contracts.test.ts`**

第 3 个用例（L38–52，守 Select 的 items map）的 `files` 列表要加 `policy-sheet.tsx`，否则拆进 Sheet 的三个 Select 脱离护栏：

```ts
const files = [
  ...pageFiles,
  "components/admin/config/admin-settings.tsx",
  "components/admin/groups/policy-sheet.tsx",
]
```

（第 1、2 个用例只扫 `pageFiles` 断言 `.not.toMatch`，groups 页变小后仍不含违规类，不会红；拆出的组件若违规用 `space-x-` 或非语义色，本阶段组件里没有，无需改动。）

- [ ] **Step 3: 验证（静态）**

```bash
pnpm typecheck
pnpm vitest run
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: typecheck 无输出；975 用例全过；layering 护栏 9 绿。

- [ ] **Step 4: 确认页面行数**

```bash
wc -l app/admin/groups/page.tsx
```

Expected: 约 200 行（设计文档的估计）。**若仍在 300 行以上，说明还有东西没搬出去** —— 回报里说明是哪些、为什么留着。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "test(ui): groups 页拆分后契约测试改读新组件文件

TableShell/RowActions 断言对象是「表格用共享组件」,拆进 group-table.tsx
后测试改同时读页面与表格;Select 的 items 护栏加读 policy-sheet.tsx。"
```

## Task 5: 真机验证（本阶段特有）

**为什么必须做：** `docs/development.md` 明写「涉及页面时应真机验证」，且这是第二个被拆的后台页，Sheet 拆分可能改变表单状态绑定。

- [ ] **Step 0: 若 worktree 里 Turbopack 因符号链接 node_modules 报错**

删符号链接、本地装真实依赖（真机验证需要 Turbopack 能解析 node_modules）：

```bash
unlink node_modules
CI=true pnpm install
```

- [ ] **Step 1: 按仓库的隔离配方起一个实例**

配方见 `docs/development.md` 的「环境与验证」一节：临时数据库、独立 Claude 配置目录、清空 QQ/TG 连接参数、关闭知识库预热与主动回复。对应环境变量（并补 `KB_PREFETCH_ENABLED=false` 关知识库预热）：

```bash
mkdir -p /tmp/verify-5c
DB_PATH=/tmp/verify-5c/agent.db \
CLAUDE_CONFIG_DIR=/tmp/verify-5c/claude-config \
ONEBOT_WS_URL= \
TELEGRAM_ENABLED_CHATS= \
TELEGRAM_BOT_TOKEN= \
ADMIN_GROUP_ID= \
KB_PREFETCH_ENABLED=false \
NEXT_DIST_DIR=.next-verify \
pnpm dev
```

**自己核对**这几个变量确实是这套配置要用的（读 `lib/core/config/env.ts` 的 `seedFromEnv`）；若还有控制「知识库预热」「主动回复」的开关**不在 env 里而在 AppConfig**，起服务后先从后台把那两项关掉。**这一步的目的是「不让任何真实客服应答发生」——宁可多关，不要漏。**

- [ ] **Step 2: 造数据 + 用浏览器打开 `/admin/groups`**

groups 页读 `/api/groups/activity`，空库无群。需先造数据才能看到表格与 Sheet。数据在 SQLite（`/tmp/verify-5c/agent.db`），但 groups 活动数据来自 `group_messages` 聚合，手工造成本高 —— **优先走「后台配置页勾选生效会话」路径**：起服务后浏览器打开 `/admin/config`，在「生效会话」里加一个 QQ 群（如 `123456`），再回到 `/admin/groups` 看该群是否出现在表格里。

（若 config 页无法造出含策略的行，退而求其次：直接向 `group_messages` 表插一条 `qq:123456` 的消息，具体列见 `lib/core/db/migrations/schema.ts` 的 `group_messages` 定义。**优先第一种，简单且真实。**）

- [ ] **Step 3: 逐项核对与拆分前一致**

- 页面正常渲染，指标行（全局主动补位/静默/转人工/独立策略）与表格都在
- 表格列出群，`channelLabel` 徽标、群名、生效 Switch、主动补位/静默/转人工三列的「覆盖」标记正常
- 点某行「编辑策略」→ Sheet 打开，三个下拉（主动补位/静默阈值/转人工通知）选中态与 `openEditor` 逻辑一致
- Sheet 里把静默阈值改成「自定义」，输入分钟数，点保存 → 有 loading、有 toast、Sheet 关闭
- 「清除覆盖」（行内或 Sheet 内）→ 有 toast、行回到跟随全局
- 生效 Switch 开关 → 有 toast（含「用法提示」那条），列表刷新
- 轮询没有把打开的 Sheet 或表单状态冲掉

**若无法起服务或无法开浏览器，如实报告，不要跳过这项就说完成。**

- [ ] **Step 4: 记录结果**

把实际观察到的现象写进回报（**截图更好**）。**任何与拆分前不一致的现象都要报出来**，哪怕很小。

- [ ] **Step 5: 清理**

```bash
rm -rf /tmp/verify-5c
```

（`.next-verify` 已 gitignore，可留。）

## Task 6: 收口

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

- [ ] **Step 2: 清理 worktree**

主检出里（worktree 外）执行：

```bash
cd /Users/ziyou/projects/prayer
git worktree remove .claude/worktrees/stage5c
```

（合回 main 之后再做，见下。）

- [ ] **Step 3: 工作区干净**

```bash
git status --short
```

## 给 5d–5e 的注意事项

1. **本阶段确立的手法**（受控区块组件 + 同目录 hook + 类型/纯函数单独文件）后面两个页面照做。
2. **`components/` 只可依赖 `core`** —— 拆组件前先确认该页面 import 没越过这条线（groups 没越，sessions/kb 要各自确认）。
3. **sessions 页是四者里最硬的**：设计文档说它有**八个** ref（`activeKeyRef`、`activeUpdatedAtRef`、`sessionsRef`、`mountedRef`、`filterRef`、`transcriptGenRef`、`lastHandledUrlKeyRef`、`writingUrlKeyRef`）跨 `openSession` ↔ effect ↔ poller 共享，且 URL 同步与三个 effect、`refresh` 是一体的竞态治理，**必须整体进同一个 hook，拆两半即坏**。
4. **kb 页有「渲染期调整 state」与 ⌘/Ctrl+S 的 eslint-disable effect**，外提时原样搬、不得顺手改成 effect。
5. **契约测试**：sessions/kb 也可能有读页面源码的用例（见 `tests/ui/admin-*-contracts.test.ts`），拆前先 grep `read("app/admin/<页>/page.tsx")` 找出会红的用例，一并写进对应 plan 的「修契约测试」Task。
