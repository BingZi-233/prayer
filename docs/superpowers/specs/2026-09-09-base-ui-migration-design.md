# Prayer 管理后台 Base UI 与 check-cx-admin 风格迁移设计

## 背景

`prayer` 当前是 Next.js 16.3.4、React 19、Tailwind CSS v4 和 shadcn/ui 的
管理后台，组件基线为 `radix-mira`。同级目录已克隆公开参考项目
`/Users/ziyou/projects/check-cx-admin`，其当前 `main` 基线为
`b2f34a3d82cae4f3492a43d3d52e3529982c93bf`，组件基线为 `base-mira`，并使用
`@base-ui/react`。

本设计把“UI 风格一致”解释为组件行为与视觉基线都向参考项目靠拢，但不把
参考项目的 Supabase 业务、数据模型或鉴权代码并入 `prayer`。

## 目标

1. 将 `prayer` 的 Radix shadcn 封装完整迁移到 Base UI，最终让
   `components.json` 使用 `base-mira`，并移除最后一个 Radix 运行时依赖。
2. 让管理后台在字体、颜色、圆角、卡片、侧栏、顶栏、表格和登录页等方面
   采用 `check-cx-admin` 的视觉语言。
3. 保持现有路由、API、鉴权边界、实时轮询、表单保存流程和数据展示语义不变。
4. 保持桌面端、移动端（至少 390px 和 320px）无横向溢出，并保留现有的
   列表/详情切换和滚动容器行为。
5. 为每个迁移组件留下独立的迁移报告和可复核的验证证据。

## 非目标

- 不复制 `check-cx-admin` 的 Supabase 客户端、数据库查询、OAuth 或路由。
- 不改变 `prayer` 的 API 响应、数据库 schema、Agent 生命周期或业务文案。
- 不迁移非 Radix 依赖：`cmdk`、Sonner、`react-markdown`、滚动消息组件的
  业务逻辑等保持现状。
- 不把参考仓库的代码当作有明确许可证的可直接再发布代码；参考仓库没有
  根级 LICENSE，视觉规范与公开 API 形状采用重建和逐项迁移方式。

## 现状与边界

### 运行时与页面

- 管理壳层位于 `app/admin/layout.tsx`，由 `SidebarProvider`、
  `AppSidebar`、sticky 顶栏和滚动内容区组成。
- `LiveProvider` 提供状态、概览和动态品牌；人工队列角标依赖其数据。
- `/admin/config` 的五分类 Tabs 嵌入多个设置表单，字段与保存流程不能因
  组件迁移而改变。
- `/admin/sessions`、`/admin/kb`、`/admin/groups` 等页面包含 Dialog、Sheet、
  Popover、Select 和复杂的受控状态。

### Radix 封装清单

需要迁移的 16 个封装：

`alert-dialog`、`badge`、`bubble`、`button`、`checkbox`、`dialog`、`label`、
`popover`、`scroll-area`、`select`、`separator`、`sheet`、`sidebar`、`switch`、
`tabs`、`tooltip`。

其中 `button`、`badge`、`bubble`、`sidebar` 自己使用 `Slot`/`asChild`；
Dialog 系列、Select、Tabs 和 Sidebar 还会影响多个页面消费者。

## 迁移策略

采用 shadcn CLI 的 `base-mira` golden pair 作为每个标准封装的目标形状，
逐组件重放 `prayer` 的定制差异，不使用一次性 `--all --overwrite`。迁移期间
Radix 与 Base UI 并存，只有最后一个 Radix 封装及其消费者完成后才移除
`radix-ui` 并切换 `components.json`。

### 阶段 0：基线与分支

在 `feat/ui-base-migration` 分支上记录干净工作树、Node/pnpm 版本和以下基线：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `NEXT_DIST_DIR=.next-verify pnpm build`

若基线存在 OneBot heartbeat 或环境权限类失败，单独记录为既有失败，不把它们
归因于迁移。

### 阶段 1：依赖与叶子封装

用 pnpm 安装 `@base-ui/react`，保留 `radix-ui`。按低耦合到高耦合顺序迁移：

1. `button`、`badge`、`bubble`；
2. `label`（改为原生 `label`/保留现有导出形状）、`separator`、`checkbox`、
   `switch`；
3. `card` 只调整到 `base-mira` 的视觉类，不涉及 Radix 行为。

`button` 使用真正的 `@base-ui/react/button`，不再用手写 Slot；非按钮的多态
   封装使用 `useRender` + `mergeProps`，并为含 `data-*` 的对象字面量保留类型
   转换，避免 TypeScript excess-property 错误。

### 阶段 2：覆盖层与定位封装

按依赖顺序迁移 `dialog`、`sheet`、`alert-dialog`、`popover`、`tooltip`。

- Radix `Overlay`/`Content` 改为 Base `Backdrop`/`Popup`；需要定位的组件
  使用 `Portal > Positioner > Popup`。
- `side`、`align`、`sideOffset`、`alignOffset` 必须从 wrapper props 显式
  解构并转发到 `Positioner`，不能落到 Popup DOM 上。
- 所有 `data-[state=open|closed]`、动画和 transform-origin 类改为 Base UI
  的 `data-open`、`data-closed`、`data-starting-style`、`data-ending-style`
  和对应 CSS 变量。
- 逐一验证 Escape、outside click、Portal、焦点回收和移动端 Sheet 行为。

### 阶段 3：Select、Tabs、ScrollArea、Sidebar

- `select`：`Viewport`→`List`、滚动按钮→滚动箭头，`position` 改为
  `alignItemWithTrigger`，并检查 `string | null` 的受控值回调。
- `tabs`：`Trigger`→`Tab`、`Content`→`Panel`；保留参考基线的手动激活
  语义并在报告中记录与 Radix 的差异。
- `scroll-area`：迁移 `Scrollbar`/`Thumb` 命名，保持消息和虚拟列表滚动高度。
- `sidebar`：以 `base-mira` 版本为骨架重放现有动态品牌、人工队列 badge、
  中文分组和移动 Sheet 逻辑；重点检查 `render`、ref/class 合并和 tooltip。

### 阶段 4：消费者与视觉壳层

逐文件扫描 app/components 中的调用点：

- `<X asChild><Y /></X>` 改为 `<X render={<Y />} >...</X>`；
- 按 Base UI 语义修正 Select、TooltipProvider、Separator、Popover/Tooltip
  定位参数；
- 检查受控回调签名，不改变业务状态更新逻辑；
- 保留 `message-scroller` 的现有 `render` 接口，避免与迁移混为一谈。

完成行为迁移后再应用参考视觉：

- `app/globals.css`：Inter + 系统中文无衬线正文、Geist Mono 仅用于代码/密钥，
  `base-mira` 的琥珀色 OKLCH 主色、light/dark/sidebar/chart token、圆角和
  reduced-motion 规则；
- `app/layout.tsx`：注册 `Inter` 与 `Geist_Mono`，取消全站默认等宽字体；
- `app/admin/layout.tsx`：参考项目的 inset Sidebar、sticky 14 高度顶栏、
  内容间距和背景层次，同时保留 Prayer 的状态头部；
- `components/app-sidebar.tsx`：采用参考项目的品牌区、激活态和图标密度，
  但保留 Prayer 的四组导航、动态品牌名和人工队列角标；
- `components/admin/*` 与登录页：统一 PageHeader、Card、Stat、表格和空态
  的密度，不删除任何业务动作。

## 组件与提交边界

每个标准 wrapper 完成后单独提交一次，提交前执行该组件相关消费者的
`pnpm typecheck`。页面壳层和主题作为独立提交，方便回滚视觉改动而不回退行为
迁移。`.migration/` 下每个组件一个报告，最终另有 `project.md` 汇总剩余
Radix 数量、依赖变更、消费者扫描和最终验证结果。

## 行为差异与风险控制

以下差异必须在报告中明确记录，不能静默“修正”：

- Tabs 默认激活方式；
- Tooltip 延迟和不可悬停内容选项；
- Dialog/AlertDialog 初始焦点与最终焦点 API；
- Select 回调的 `null` 值和键盘 typeahead；
- Popover/Sheet 的 Positioner 定位与焦点回收；
- Sidebar 折叠、移动端 Sheet、TooltipTrigger 的 `render` 合并；
- Checkbox 的 indeterminate 表达方式。

鉴权 cookie、`ADMIN_TOKEN`、API 路由和服务端/客户端边界不属于视觉迁移范围，
任何异常都应停止并单独诊断。

## 验证方案

### 自动验证

- 每个 wrapper 迁移后运行 `pnpm typecheck`；
- 每批覆盖层/表单组件运行 `pnpm lint` 和相关 Vitest；
- 最终运行 `pnpm check`；
- 使用 `NEXT_DIST_DIR=.next-verify pnpm build` 做生产构建；
- `rg -n "radix-ui|@radix-ui" components app lib`，确认只剩报告中明确的
  非迁移内容（目标为 0 个 Radix wrapper）。

### 手工与浏览器验证

- `/login`、`/admin`、`/admin/config`、`/admin/sessions`、`/admin/kb`、
  `/admin/groups` 在浅色/深色主题下检查字体、对比度、卡片边界和滚动；
- Dialog、AlertDialog、Sheet、Popover、Tooltip：键盘打开、Escape 关闭、
  outside click、焦点回到触发器；
- Select/Tabs：键盘导航、typeahead、受控值切换和垂直 Tabs；
- Sidebar：桌面展开/折叠、移动端打开/关闭、动态角标和品牌名；
- 390px 与 320px viewport 检查截图及 `document.documentElement.scrollWidth ===
  window.innerWidth`，重点关注顶栏、导航、表格和底部工具调用区域。

## 完成标准

迁移完成需同时满足：

1. 所有 16 个 Radix wrapper 和相关消费者已迁移，`components.json` 为
   `base-mira`，`radix-ui` 已从依赖和源码中移除；
2. 现有业务路由、API 交互、实时状态、表单保存和鉴权行为保持通过；
3. 自动验证结果与基线差异有明确说明，生产构建成功；
4. 关键页面在浅色/深色及 390/320px 下无已知横向溢出或不可操作控件；
5. `.migration/` 报告完整，列明行为差异和未迁移的第三方组件。
