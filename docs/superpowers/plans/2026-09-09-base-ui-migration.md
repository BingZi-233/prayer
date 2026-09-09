# Base UI 风格迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 将 prayer 管理后台的 Radix shadcn 封装和视觉壳层迁移到与 check-cx-admin 一致的 Base UI base-mira 基线，同时保持所有现有业务行为。

**Architecture:** 保留 prayer 的 App Router、API、LiveProvider、鉴权和业务组件，只替换 components/ui 中的 Radix 原语及其调用点。先让行为在 Base UI 上通过类型和交互验证，再迁移全局主题、页面壳层和共享管理组件；Radix 与 Base UI 在中间阶段并存，最后一次性移除 Radix 依赖。

**Tech Stack:** Next.js 16.3.4、React 19.2.8、TypeScript 5.9、Tailwind CSS v4、shadcn CLI、@base-ui/react 1.6.0、Vitest、pnpm 11.17.0。

**Spec:** docs/superpowers/specs/2026-09-09-base-ui-migration-design.md

## Global Constraints

- prayer 的路由、API 响应、数据库 schema、Agent 生命周期、鉴权 cookie 和表单保存语义保持不变。
- 迁移目标是 base-mira；标准 wrapper 以 shadcn CLI 的 base golden pair 为准，逐组件重放本地定制，不使用一次性 --all --overwrite。
- Radix 与 Base UI 允许暂时并存；只有全部消费者迁移后才删除 radix-ui 和相关传递依赖。
- cmdk、Sonner、react-markdown、现有消息滚动业务逻辑等非 Radix 依赖不迁移。
- 含 data-* 的 mergeProps 对象字面量必须显式转换为对应 React.ComponentProps 类型。
- Positioner 的 side、align、sideOffset、alignOffset 必须显式解构并转发。
- 每个组件迁移后执行类型检查并写 .migration/<component>.md；最终写 .migration/project.md。
- 完成前运行 pnpm check、NEXT_DIST_DIR=.next-verify pnpm build、源码残留扫描和 390/320px 浏览器验证。

## 文件地图

### 迁移封装

- components/ui/button.tsx：真实 Base Button 与 render 多态入口，fan-out 最大。
- components/ui/badge.tsx、components/ui/bubble.tsx：Slot 多态和消息气泡样式。
- components/ui/label.tsx、separator.tsx、checkbox.tsx、switch.tsx：叶子原语。
- components/ui/dialog.tsx、sheet.tsx、alert-dialog.tsx：Backdrop、Popup、焦点和关闭行为。
- components/ui/popover.tsx、tooltip.tsx：Positioner 定位与延迟行为。
- components/ui/select.tsx、tabs.tsx、scroll-area.tsx：受控值、键盘行为和滚动。
- components/ui/sidebar.tsx：最复杂的 Slot、移动端 Sheet、折叠和 tooltip 组合。
- components.json、package.json、pnpm-lock.yaml：样式基线和依赖切换。

### 消费者与壳层

- app/admin/page.tsx、app/admin/reflection/page.tsx、app/admin/handoff/page.tsx：显式 Dialog/Button asChild 消费者。
- app/admin/config/page.tsx、app/admin/sessions/page.tsx、app/admin/groups/page.tsx、app/admin/kb/page.tsx：受控 Overlay、Select、Tabs 消费者。
- components/admin/config/qq-settings.tsx、components/app-sidebar.tsx：Popover 和 Sidebar asChild 消费者。
- app/globals.css、app/layout.tsx、app/admin/layout.tsx：全局视觉壳层。
- components/admin/page-header.tsx、section-card.tsx、stat.tsx、app/login/page.tsx：共享视觉原语。

### 测试与报告

- tests/ui/base-ui-contracts.test.ts：可执行的源码边界合同测试。
- .migration/baseline.md、.migration/<component>.md、.migration/project.md：基线、逐组件和项目汇总证据。`.migration/` 不建立 index/README 文件。

---

### Task 1: 记录基线并建立迁移合同

**Files:**
- Create: .migration/baseline.md
- Create: tests/ui/base-ui-contracts.test.ts
- Read: package.json、components.json、app/globals.css、app/admin/layout.tsx、components/app-sidebar.tsx

**Interfaces:**
- Produces：基线命令结果、16 个 Radix wrapper 清单、消费者清单和合同测试入口。

- [x] Step 1: 写入会在迁移完成前失败的合同测试

先运行 `mkdir -p tests/ui .migration`，再创建下列文件。

~~~ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFile(path, "utf8")

describe("Base UI migration contract", () => {
  it("all migrated wrappers contain no Radix import", async () => {
    const paths = [
      "components/ui/alert-dialog.tsx",
      "components/ui/badge.tsx",
      "components/ui/bubble.tsx",
      "components/ui/button.tsx",
      "components/ui/checkbox.tsx",
      "components/ui/dialog.tsx",
      "components/ui/label.tsx",
      "components/ui/popover.tsx",
      "components/ui/scroll-area.tsx",
      "components/ui/select.tsx",
      "components/ui/separator.tsx",
      "components/ui/sheet.tsx",
      "components/ui/sidebar.tsx",
      "components/ui/switch.tsx",
      "components/ui/tabs.tsx",
      "components/ui/tooltip.tsx",
    ]
    const sources = await Promise.all(paths.map(read))
    expect(sources.join("\n")).not.toMatch(/radix-ui|@radix-ui/)
  })

  it("the project points shadcn at base-mira", async () => {
    const config = JSON.parse(await read("components.json")) as { style: string }
    expect(config.style).toBe("base-mira")
  })
})
~~~

- [x] Step 2: 运行合同测试确认 RED

运行 pnpm vitest run tests/ui/base-ui-contracts.test.ts。第一条应因 radix-ui 导入失败，第二条应因 radix-mira 失败；如果测试通过，先修正测试而不是继续迁移。

- [x] Step 3: 记录环境和基线

运行以下命令，把退出码和关键输出写入 .migration/baseline.md：

~~~bash
node --version
pnpm --version
pnpm exec shadcn info --json
pnpm typecheck
pnpm lint
pnpm test
NEXT_DIST_DIR=.next-verify pnpm build
~~~

OneBot heartbeat 或环境权限类失败标记为既有失败，不修改生产代码掩盖它们。

- [x] Step 4: 提交基线合同

~~~bash
git add tests/ui/base-ui-contracts.test.ts .migration/baseline.md
git diff --cached --check
git commit -m "test(admin): 建立 Base UI 迁移合同"
~~~

### Task 2: 安装 Base UI 并准备 golden pair 工作流

**Files:**
- Modify: package.json
- Modify: pnpm-lock.yaml

**Interfaces:**
- Consumes：Task 1 的基线。
- Produces：可与 Radix 并存的 @base-ui/react 1.6.0 和安全回放流程。

- [x] Step 1: 安装已验证版本

运行 pnpm add --save-exact @base-ui/react@1.6.0。确认 package.json 有精确版本且 radix-ui 仍在依赖中。

- [x] Step 2: 固化 golden pair 工作流

每个组件任务都先比较以下两个 registry URL，再用 apply_patch 重放本地定制：
https://ui.shadcn.com/r/styles/radix-mira/<component>.json
https://ui.shadcn.com/r/styles/base-mira/<component>.json
定制 wrapper 不直接使用 --overwrite，也不使用批量 --all；生成的目标文件必须逐文件检查 `radix-ui`、`@radix-ui` 和旧数据属性残留。

- [x] Step 3: 验证并提交

运行 pnpm typecheck，然后执行：

~~~bash
git add package.json pnpm-lock.yaml
git diff --cached --check
git commit -m "build(admin): 添加 Base UI 迁移依赖"
~~~

每个 `.migration/<component>.md` 必须使用同一结构：

~~~md
# <component>

<日期、策略、单行结论>

## Changed

<全部修改文件、原因，以及 radix-ui/@radix-ui 残留扫描结果>

## Left alone

<看似相关但明确未改的文件和原因>

## Behavior changes

<编译通过但行为不同的差异；没有则写 None>

## Verify by hand

<一分钟可复现的键盘、焦点、定位或滚动检查>
~~~

### Task 3: 迁移 Button 并建立 render 消费者模式

**Files:**
- Modify: components/ui/button.tsx
- Modify: components/ui/alert-dialog.tsx
- Modify: app/admin/page.tsx
- Modify: app/admin/reflection/page.tsx
- Modify: app/admin/handoff/page.tsx
- Modify: components/app-sidebar.tsx
- Modify: tests/ui/base-ui-contracts.test.ts
- Create: .migration/button.md

**Interfaces:**
- Consumes：@base-ui/react/button 和现有 buttonVariants。
- Produces：Button 接受 Base UI render，保留 variant、size 和图标类，链接消费者不再依赖 asChild。

- [x] Step 1: 添加失败合同并确认 RED

增加断言：button.tsx 含 @base-ui/react/button 和 ButtonPrimitive，不含 radix-ui；运行目标测试确认失败。

- [x] Step 2: 迁移 wrapper

使用真实 @base-ui/react/button primitive，保留现有 buttonVariants 类串；函数签名使用 Base UI props，render 直接传给 primitive，不再使用 Slot.Root。

- [x] Step 3: 逐个迁移消费者

将：

~~~tsx
<Button asChild variant="outline">
  <Link href="/admin/handoff">人工会话</Link>
</Button>
~~~

改为：

~~~tsx
<Button render={<Link href="/admin/handoff" />} variant="outline">
  人工会话
</Button>
~~~

Dialog/AlertDialog 内部 Close 使用 render={<Button ... />}，每改一个文件运行 pnpm typecheck。

- [x] Step 4: 验证、报告、提交

运行 pnpm typecheck 和合同测试；.migration/button.md 写 changed files、类串保留、残留扫描和 Button 链接/原生按钮手工步骤，然后提交：

~~~bash
git add components/ui/button.tsx components/ui/alert-dialog.tsx app/admin/page.tsx app/admin/reflection/page.tsx app/admin/handoff/page.tsx components/app-sidebar.tsx tests/ui/base-ui-contracts.test.ts .migration/button.md
git diff --cached --check
git commit -m "refactor(ui): 迁移 Button 到 Base UI"
~~~

### Task 4: 迁移 Badge 与 Bubble 的多态渲染

**Files:**
- Modify: components/ui/badge.tsx
- Modify: components/ui/bubble.tsx
- Modify: app/admin/sessions/page.tsx
- Modify: app/admin/page.tsx
- Create: .migration/badge.md
- Create: .migration/bubble.md

**Interfaces:**
- Consumes：Task 3 的 render 约定。
- Produces：Badge/BubbleContent 使用 useRender + mergeProps，保留 variant、align 和消息布局。

- [x] Step 1: 写两条失败合同并确认 RED

断言两个 wrapper 含 @base-ui/react/use-render 和 @base-ui/react/merge-props、不含 Slot；运行合同测试确认失败。

- [x] Step 2: 迁移 Badge

类型使用 useRender.ComponentProps<"span">；含 data-slot 的 mergeProps 对象转换为 React.ComponentProps<"span">；保留 badgeVariants。

- [x] Step 3: 迁移 BubbleContent

把 asChild 改为 render，保留 BubbleGroup、Bubble、BubbleReactions 的视觉类和消息布局。

- [x] Step 4: 扫描消费者并验证

运行 rg -n "Badge|BubbleContent|asChild" app components --glob '*.{ts,tsx}'，逐个改为 render；运行 pnpm typecheck，写两份报告并分别提交，提交信息为：
refactor(ui): 迁移 Badge 到 Base UI
refactor(ui): 迁移 Bubble 多态渲染

### Task 5: 迁移 Label、Separator、Checkbox、Switch

**Files:**
- Modify: components/ui/label.tsx
- Modify: components/ui/separator.tsx
- Modify: components/ui/checkbox.tsx
- Modify: components/ui/switch.tsx
- Modify: components/admin/config/*.tsx（仅修正原语类型暴露的 props）
- Create: .migration/label.md
- Create: .migration/separator.md
- Create: .migration/checkbox.md
- Create: .migration/switch.md

**Interfaces:**
- Consumes：Base UI 1.6.0 的 checkbox、switch、separator 类型。
- Produces：原生 Label、可调用 Separator、Base Checkbox/Switch，保留 data attributes 和尺寸类。

- [x] Step 1: 写四条失败合同并确认 RED

断言 label 不导入 Radix、separator 使用 callable primitive、Checkbox/Switch 使用 Base 子路径；运行合同测试确认失败。

- [x] Step 2: 迁移 Label

导出原生 label 包装，保留 data-slot、htmlFor、select-none、disabled 和 peer-disabled 类，不引入新的 Field 行为。

- [x] Step 3: 迁移 Separator

使用 @base-ui/react/separator callable primitive，移除 decorative 转发；检查 admin layout 的垂直分隔线仍传 orientation="vertical"。

- [x] Step 4: 迁移 Checkbox 与 Switch

使用 base golden pair 的 primitive 和 data-checked/data-unchecked 类；如遇 checked="indeterminate"，改成 indeterminate 布尔属性并写入报告；保留 size 和表单字段。

- [x] Step 5: 类型检查、报告、提交

运行 pnpm typecheck 和 pnpm lint；用键盘 Space/Enter 检查控件，再按四个组件分别提交。

### Task 6: 迁移 Dialog 与 AlertDialog

**Files:**
- Modify: components/ui/dialog.tsx
- Modify: components/ui/alert-dialog.tsx
- Modify: app/admin/page.tsx
- Modify: app/admin/reflection/page.tsx
- Modify: app/admin/kb/page.tsx
- Modify: app/admin/groups/page.tsx
- Create: .migration/dialog.md
- Create: .migration/alert-dialog.md

**Interfaces:**
- Consumes：Task 3 的 Base Button 和 Base Dialog/Alert Dialog parts。
- Produces：公开 wrapper 名称不变，内部使用 Backdrop、Popup、Close，调用方打开/关闭仍是布尔值。

- [x] Step 1: 写 Backdrop/Popup/Close 失败合同并确认 RED

断言 dialog 含 @base-ui/react/dialog、Backdrop、Popup，不含 radix Overlay/Content/asChild；运行合同测试确认失败。

- [x] Step 2: 迁移 Dialog

Overlay→Backdrop、Content→Popup；居中 Dialog 不使用 Positioner。关闭按钮写成 DialogPrimitive.Close render={<Button ... />}；保留 showCloseButton、标题、描述和现有 classes，动画改为 data-starting-style/data-ending-style。

- [x] Step 3: 迁移 AlertDialog

Overlay→Backdrop、Content→Popup、Cancel/Action→Close；多步骤确认通过 `preventDefault()` 保持中间步骤打开；保留 destructive variant 和确认语义。

- [x] Step 4: 扫描消费者

运行 rg -n "Dialog|AlertDialog|asChild|onOpenAutoFocus|onCloseAutoFocus|onInteractOutside" app components --glob '*.{ts,tsx}'；按 Base props 表处理每个命中，禁止把 Radix 事件参数直接传回去。

- [x] Step 5: 交互验证、报告、提交

运行 pnpm typecheck、pnpm lint；手工验证打开、Escape、outside click、焦点回收和移动端宽度；分别写报告并提交。

### Task 7: 迁移 Sheet、Popover、Tooltip

**Files:**
- Modify: components/ui/sheet.tsx
- Modify: components/ui/popover.tsx
- Modify: components/ui/tooltip.tsx
- Modify: components/admin/config/qq-settings.tsx
- Modify: components/admin/config/*.tsx
- Create: .migration/sheet.md
- Create: .migration/popover.md
- Create: .migration/tooltip.md

**Interfaces:**
- Consumes：Task 6 的 Backdrop/Popup 形状。
- Produces：Sheet/Popover/Tooltip 使用正确的 Portal、Positioner、Popup 结构，公开 wrapper 名称不变。

- [x] Step 1: 写 Positioner 失败合同并确认 RED

断言三个 wrapper 含 Positioner、不含 Radix Overlay/Content，并断言 TooltipProvider 使用 delay；运行 RED。

- [x] Step 2: 迁移 Sheet

Backdrop/Popup 取代 Overlay/Content，按 side 使用 starting/ending style 位移动画；保留 showCloseButton、移动端宽度和 Header/Footer。

- [x] Step 3: 迁移 Popover

显式解构并转发 side、sideOffset、align、alignOffset 到 Positioner；Popup 只接收内容和视觉类。PopoverAnchor 如无 Base 对应则保留 inert passthrough 并报告。

- [x] Step 4: 迁移 Tooltip

Provider delayDuration→delay；Content 使用 Positioner/Popup/Arrow，补齐每侧箭头类；移除没有 Base 等价物的 disableHoverableContent 并报告。

- [x] Step 5: 改写消费者、验证、提交

运行 rg -n "Popover|Tooltip|delayDuration|disableHoverableContent|asChild" app components --glob '*.{ts,tsx}'；改 qq-settings 和 Sidebar 内部 Trigger 为 render；运行 pnpm typecheck，手工检查焦点、Escape、边界定位、折叠 Sidebar 延迟；分别提交三个组件。

### Task 8: 迁移 Select

**Files:**
- Modify: components/ui/select.tsx
- Modify: app/admin/config/page.tsx
- Modify: app/admin/config/*.tsx
- Modify: app/admin/groups/page.tsx
- Modify: app/admin/kb/page.tsx
- Modify: components/admin/*.tsx
- Create: .migration/select.md

**Interfaces:**
- Consumes：Task 7 的 Positioner 约定。
- Produces：Select 使用 List、ScrollUp/DownArrow、ItemText/ItemIndicator，受控值允许 string | null。

- [x] Step 1: 写 Select 失败合同并确认 RED

断言源码含 @base-ui/react/select、SelectPrimitive.List、alignItemWithTrigger，不含 position= 或 Viewport；运行 RED。

- [x] Step 2: 迁移 Select wrapper

使用 const Select = SelectPrimitive.Root；Content 结构为 Portal > Positioner > Popup > List，显式转发 alignItemWithTrigger；ItemText 在 ItemIndicator 前，保留尺寸和空值展示。

- [x] Step 3: 修正受控调用

position="popper"→alignItemWithTrigger={false}；useState<string> 与 onValueChange={setState} 改为可接收 null 的 setter 包装；不改变业务默认值。

- [x] Step 4: 验证与提交

运行 pnpm typecheck、pnpm lint；手工 Arrow/Home/End/typeahead/Escape 和表单提交，检查 popup 宽度、滚动箭头和 null 值；写报告并提交 refactor(ui): 迁移 Select 到 Base UI。

### Task 9: 迁移 Tabs 与 ScrollArea

**Files:**
- Modify: components/ui/tabs.tsx
- Modify: components/ui/scroll-area.tsx
- Modify: app/admin/config/page.tsx
- Read: components/ui/message-scroller.tsx（确认现有 render API，不改业务）
- Create: .migration/tabs.md
- Create: .migration/scroll-area.md

**Interfaces:**
- Consumes：Task 8 的 Base 类型和 render 模式。
- Produces：Tabs 使用 Tab/Panel，ScrollArea 使用 Scrollbar/Thumb，垂直设置 Tabs 和消息滚动高度不变。

- [x] Step 1: 写失败合同并确认 RED

断言 Tabs 使用 TabsPrimitive.Tab/Panel、ScrollArea 使用 Scrollbar/Thumb；运行 RED。

- [x] Step 2: 迁移 Tabs

Trigger→Tab、Content→Panel，data-[state=active]→data-active；移除不支持的 activationMode，保留 Base 默认手动激活并在报告标记差异；显式保留 orientation。

- [x] Step 3: 迁移 ScrollArea

完成 part rename，保留 viewport size-full、滚动条宽度和消息列表 CSS；移除不支持的 type 传播。

- [x] Step 4: 验证与提交

运行 pnpm typecheck、pnpm lint；在 /admin/config 切换五类设置，在会话页滚动消息；写报告后分别提交。

### Task 10: 迁移 Sidebar

**Files:**
- Modify: components/ui/sidebar.tsx
- Modify: components/app-sidebar.tsx
- Modify: app/admin/layout.tsx
- Create: .migration/sidebar.md

**Interfaces:**
- Consumes：Base Button、Sheet、Tooltip、Separator wrapper。
- Produces：Base render/useRender Sidebar，保留动态品牌、四组导航、人工队列角标、桌面折叠和移动 Sheet。

- [x] Step 1: 写 Sidebar 失败合同并确认 RED

断言 Sidebar 不含 Slot/asChild，SidebarMenuButton 和 SidebarMenuSubButton 使用 render；运行 RED。

- [x] Step 2: 以 base-mira golden pair 为骨架重放定制

逐段迁移 Provider、Sidebar、SidebarInset、GroupLabel、GroupAction、MenuButton、MenuAction、SubButton；非按钮多态部分使用 useRender + mergeProps，按钮使用 Base Button/render。保留 isMobile、cookie、宽度常量、动态 badge 和无障碍文本。

- [x] Step 3: 迁移导航消费者

在 components/app-sidebar.tsx 将 SidebarMenuButton asChild 改为 render={<Link ... />}，保留路径激活判断、humanSessions badge 和四组中文导航；不复制参考项目的用户/Supabase footer。

- [x] Step 4: 验证与提交

运行 pnpm typecheck、pnpm lint；桌面展开/折叠、Ctrl/⌘+B、移动端打开/关闭、tooltip、动态品牌和角标逐项检查；写报告并提交 refactor(ui): 迁移 Sidebar 到 Base UI。

### Task 11: 切换 shadcn 基线并移除 Radix

**Files:**
- Modify: components.json
- Modify: package.json
- Modify: pnpm-lock.yaml
- Modify: all migrated components/ui/*.tsx
- Modify: tests/ui/base-ui-contracts.test.ts
- Create: .migration/project.md

**Interfaces:**
- Consumes：Tasks 3–10 的全部 wrapper 与消费者。
- Produces：完全使用 base-mira，radix-ui 和所有 Radix imports 清零。

- [x] Step 1: 扫描残留

运行 rg -n "radix-ui|@radix-ui|Slot|asChild|data-\[state=" components app lib --glob '*.{ts,tsx}'；任何命中先修复对应消费者或在报告中明确其不是迁移目标。

- [x] Step 2: 切换配置并删除依赖

将 components.json style 改为 base-mira，运行 pnpm remove radix-ui；确认 lockfile 不再有直接 Radix 依赖，不删除 cmdk、Sonner 或其它非迁移包。

- [x] Step 3: 运行合同、类型和 lint

运行 pnpm vitest run tests/ui/base-ui-contracts.test.ts、pnpm typecheck、pnpm lint。

- [x] Step 4: 写报告并提交

.project.md 写依赖差异、16 个 wrapper 状态、消费者扫描、行为差异和剩余数量（应为 0）；提交 refactor(ui): 完成 Radix 到 Base UI 迁移。

### Task 12: 迁移 Card、主题与全局字体

**Files:**
- Modify: app/globals.css
- Modify: app/layout.tsx
- Modify: components/ui/card.tsx
- Modify: components/admin/page-header.tsx
- Modify: components/admin/section-card.tsx
- Modify: components/admin/stat.tsx
- Modify: app/login/page.tsx
- Create: .migration/visual-theme.md

**Interfaces:**
- Consumes：Task 11 的 Base classes。
- Produces：Inter + 系统中文 sans、Geist Mono 代码字体、参考琥珀色 token、base Card 密度和一致的登录/管理视觉。

- [x] Step 1: 写视觉合同并确认 RED

在合同测试中读取 globals.css/layout.tsx，断言 --font-inter、--font-geist-mono、primary oklch(0.67 0.16 58) 和 base Card ring class；运行 RED。

- [x] Step 2: 迁移 token 和字体

以参考项目数值为基线重写 font theme、light/dark/sidebar/chart token 和 reduced-motion；保留 Prayer 状态颜色。layout 注册 Inter、Geist_Mono，移除 html 上全站 font-mono。

- [x] Step 3: 迁移 Card 与共享原语

调整 Card spacing/ring/title 类到 base-mira，保留 size 扩展；统一 PageHeader、SectionCard、Stat 的 gap、边界和数字密度，不改 props 或数据来源。

- [x] Step 4: 迁移登录页并验证

保留 ADMIN_TOKEN 登录行为，只调整 Card、按钮、字体和错误态 classes；运行 pnpm typecheck、pnpm lint，写报告并提交 style(admin): 对齐 check-cx-admin 视觉主题。

### Task 13: 迁移 Admin 壳层、导航和页面密度

**Files:**
- Modify: app/admin/layout.tsx
- Modify: components/app-sidebar.tsx
- Modify: components/admin/page-shell.tsx
- Modify: components/admin/data-state.tsx
- Modify: components/admin/master-detail.tsx
- Modify: components/admin/item-card.tsx
- Modify: components/admin/virtual-list.tsx
- Modify: app/admin/*/page.tsx（只调整视觉 class）
- Create: .migration/admin-shell.md

**Interfaces:**
- Consumes：Task 10 Sidebar 和 Task 12 主题。
- Produces：参考项目的 inset Sidebar、sticky 14 高度顶栏、内容间距、表格/空态密度，同时保留 Prayer 状态头部和业务动作。

- [x] Step 1: 写壳层合同并确认 RED

断言 admin/layout.tsx 使用 SidebarInset、sticky header 和 md:p-6；运行 RED。

- [x] Step 2: 调整 Admin layout

采用 SidebarProvider + SidebarInset 的 inset 背景/圆角层次；顶栏保留 BrandTitle、HeaderStatus、SidebarTrigger、垂直 Separator；内容区继续使用 LiveProvider 和滚动容器。

- [x] Step 3: 调整导航和共享壳层

品牌区采用参考密度，但保留动态品牌、四组中文导航和 humanSessions；统一 PageShell、MasterDetail、DataState、ItemCard 的 gap、ring/border 和移动端 min-width。

- [x] Step 4: 逐页修正视觉类

运行 rg -n "rounded-|border|p-|gap-|font-mono|data-\[state" app/admin components/admin --glob '*.{ts,tsx}'；只修改视觉类和 Base 数据属性，不改 API、事件、状态机和文案。

- [x] Step 5: 验证与提交

运行 pnpm typecheck、pnpm lint；检查 admin、sessions、handoff、kb、config、groups、plugins、reflection、ranking 的 light/dark 布局；提交 style(admin): 对齐管理壳层与页面密度。

### Task 14: 浏览器回归与最终质量门

**Files:**
- Modify: .migration/project.md
- Modify: .migration/*.md（仅补验证证据）
- Read: all admin routes and package.json

**Interfaces:**
- Consumes：Tasks 11–13 的代码和报告。
- Produces：可复核的自动/手工验证结果和最终交付状态。

- [x] Step 1: 启动 Next 开发循环

按 next-dev-loop 技能启动 pnpm exec next dev -H 0.0.0.0 -p 3100，确认实际端口后做浏览器检查；不要覆盖正在运行的 .next。

- [x] Step 2: 验证核心路由和交互

检查 login、admin、config、sessions、kb、groups：Dialog/Sheet/Popover/Tooltip 的焦点和 Escape，Select typeahead，Tabs 切换，Sidebar 折叠，动态角标和表单保存。

- [x] Step 3: 验证移动端和主题

在 390px、320px viewport 运行：

~~~js
({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })
~~~

预期 scrollWidth === innerWidth；检查顶栏按钮、导航、表格和底部工具调用区域没有裁切或不可点击内容。

- [x] Step 4: 运行最终自动质量门

~~~bash
pnpm vitest run tests/ui/base-ui-contracts.test.ts
pnpm check
NEXT_DIST_DIR=.next-verify pnpm build
git diff --check
git status --short --branch
~~~

若 pnpm check 仍有基线 OneBot heartbeat 失败，在 .migration/project.md 原样记录测试名和原因，不声称全绿。

- [x] Step 5: 完成项目报告并提交

补齐命令输出、viewport、剩余 Radix 数量和行为差异；确认 git diff --cached --check、git diff --cached --stat 后提交 test(admin): 完成 Base UI 迁移验证。
