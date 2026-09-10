# Admin UI Redesign Design

## Goal

将 prayer 管理端的所有页面统一为参考 `BingZi-233/check-cx-admin` 的高密度、克制、可响应式管理台体验，同时保留现有业务语义、数据请求、权限边界和交互行为。

## Baseline

- 应用为 Next.js 16.3.4 App Router、React Server Components、Tailwind CSS v4。
- UI 基础为 shadcn Base/Mira，图标为 lucide，CSS 令牌位于 `app/globals.css`。
- 管理页共享 `app/admin/layout.tsx`、`components/app-sidebar.tsx`、`PageHeader`、`PageShell`、`SectionCard`、`DataState` 和 `MasterDetail`。
- 当前页面覆盖监控、客服运营、知识和系统四个导航域；登录页位于 `/login`。

## Design Direction

采用参考项目的 inset sidebar、分组导航、顶部状态栏和中性表面层级；以暖橙色 primary 作为操作与品牌强调色，使用 semantic shadcn tokens，不在页面中散落原始颜色值。卡片与表格强调信息分组和可扫描性，空态、错误态、加载态使用统一组件。桌面端内容居中并限制最大宽度，窄屏端采用单栏、横向滚动和 master-detail 返回流。

## Scope

1. 全局壳层和登录页：导航层级、品牌区、顶部栏、主题、间距、背景、焦点和移动端折叠。
2. 监控页面：运行状态、日志。
3. 客服运营：会话、人工队列、主动回复。
4. 知识页面：知识库、反思、问题排行。
5. 系统页面：配置、生效会话、能力、插件。
6. 所有页面的 loading/error/empty 状态、暗色模式和响应式回归。

不改变 API、数据库 schema、认证策略、轮询频率、权限判定或业务文案含义；如页面现有组件违反 shadcn 组合规范，只做服务于本次 UI 的局部整理。

## Shared Contracts

- 页面使用 `PageShell` 作为根容器，使用 `PageHeader` 提供标题、说明和操作区。
- 分组内容使用 `SectionCard`；状态分支使用 `DataState` / `EmptyState` / `ErrorState`。
- 列表详情页面继续使用 `MasterDetail`，移动端详情提供可访问的返回动作。
- 图标、按钮、Badge、Separator、Skeleton、表单字段全部使用现有 shadcn 组件及 semantic tokens。
- 页面在 320px、390px、768px、1024px、1440px 视口下不得产生意外水平溢出；允许数据表在明确容器内横向滚动。

## Validation

- 每个页面组完成后运行相关 Vitest 测试与 `pnpm typecheck`。
- 全部完成后运行 `pnpm check`、`NEXT_DIST_DIR=.next-verify pnpm build` 和 `git diff --check`。
- 运行开发服务器，对所有导航页面进行真实浏览器检查；记录 320px/390px/1440px 截图与 `document.documentElement.scrollWidth === innerWidth` 结果。

