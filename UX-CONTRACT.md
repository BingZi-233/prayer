# Prayer UX Contract

## Product context

- Audience: 多渠道 AI 客服的运营管理员。
- Primary jobs: 观察运行风险、处理人工会话、维护知识与配置、核查有限范围的管理变更轨迹。
- Target market(s): 未由独立市场研究文档定义；以 `README.md` 的中文社区客服定位为当前证据。
- Active locales: `zh-CN`，界面中文由现有组件直接维护。
- Language/content register and native-review policy: 简洁、明确、可执行的中文；没有对外法律或监管文案。
- Timezone/calendar policy: 时间按操作者浏览器本地时区显示，`RelativeTime` 的 title 与可访问名称显示本地绝对时间。
- Accessibility target: WCAG 2.2 AA。

## Business-context sources

| Domain / scope          | Authoritative source                                | Source type                            | Reviewed date |
| ----------------------- | --------------------------------------------------- | -------------------------------------- | ------------- |
| 产品闭环与后台职责      | `README.md`                                         | 产品说明                               | 2026-09-16    |
| 管理 API 授权实现       | `proxy.ts`                                          | 实现证据，非人员权限政策               | 2026-09-16    |
| 审计数据边界            | `lib/core/admin-audit.ts`、`app/api/audit/route.ts` | 已验证 API/数据契约                    | 2026-09-16    |
| 删除/保留               | `lib/core/retention.ts`                             | 已验证实现；尚缺产品级数据生命周期政策 | 2026-09-16    |
| Billing / payment       | 不适用：当前产品无账单流程                          | —                                      | 2026-09-16    |
| Legal / regulatory copy | 未提供独立政策；不可据此做合规承诺                  | 决策缺口                               | 2026-09-16    |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`。
- Token ownership model: existing runtime canonical。
- Runtime design-system/token source: `app/globals.css` 的语义 CSS 变量和 Tailwind `@theme inline`。
- Mapping/export/adapters: `app/globals.css` → 共享 UI 组件 → 管理页；不生成第二套 token。
- Token drift gate: `npx -p @google/design.md designmd lint DESIGN.md`、共享组件检查和浏览器视觉验证。
- Supported themes: light / dark。
- Design-context owner/review policy: 后续管理端功能必须复用共享组件并更新本文件的行为决策，而不是建立屏幕级替代实现。

## Canonical UI Map

| Capability      | Canonical owner            | Source of truth                  | Allowed variants                         | Verification         |
| --------------- | -------------------------- | -------------------------------- | ---------------------------------------- | -------------------- |
| Table Selection | 当前无选择型表格           | 不适用                           | 不得暗加批量选择                         | 新需求时单独定义     |
| Select/Listbox  | `components/ui/select.tsx` | 共享组件                         | authored                                 | 打开态、键盘、窄屏   |
| Date            | 当前后台无日期输入         | 不适用                           | 新需求时明确 native/authored             | locale + keyboard    |
| Form            | 现有 Field / schema 模式   | 共享组件与 API schema            | create / edit；自定义校验用 `noValidate` | 验证与失败路径       |
| Scrollbar       | 应用内容区与 `TableShell`  | `app/globals.css` / `TableShell` | 仅几何例外                               | 窄屏与滚动           |
| Toast           | `sonner` + 根 `Toaster`    | `app/layout.tsx`                 | success / error / info                   | live-region / 浏览器 |
| CRUD            | API + 各领域页面           | API 契约与共享 dialog/button     | return / stay-inline                     | 全流程测试           |

## Component behavior

| Component  | Default       | Hover        | Focus        | Active   | Disabled           | Busy                          | Error                  |
| ---------- | ------------- | ------------ | ------------ | -------- | ------------------ | ----------------------------- | ---------------------- |
| Button     | 共享 `Button` | 语义变体背景 | visible ring | 轻微下压 | 不可点击、低透明度 | 稳定尺寸 + Spinner            | 行内或 toast 恢复      |
| Table/list | `TableShell`  | 行保持可读   | 原生可达     | 不适用   | 不适用             | 首次 Skeleton、刷新保留旧数据 | `DataState` + 重试     |
| Notice     | `Notice`      | 不适用       | 不适用       | 不适用   | 不适用             | 不适用                        | 仅持续风险使用 warning |

## Dataset navigation

- Admin tables: API 未提供分页/cursor 时只展示其明确的有限窗口，不宣称全量。
- Exploratory lists: 当前无此契约。
- URL state: 只有 API 明确支持时才将筛选、排序和页码写入 URL。
- Page size: 由 API 限制；审计页当前最多显示最近 100 条和最多 100 条未结束记录。
- Empty/no-results/error/loading treatment: 统一使用 `DataState`，首屏 Skeleton、错误可重试、空态说明数据何时出现。
- Back/scroll restoration: 由浏览器与 Next 路由保留；新页面不引入自定义滚动容器之外的状态。

## Flow ledger

| Operation         | Trigger                | Pending                         | Success destination | Success feedback | Failure recovery                                       | Focus outcome      | Source ref                      |
| ----------------- | ---------------------- | ------------------------------- | ------------------- | ---------------- | ------------------------------------------------------ | ------------------ | ------------------------------- |
| Read audit window | 进入审计页 / 30 秒刷新 | 首屏 Skeleton；后台刷新保留数据 | 当前页              | 最新状态直接显示 | `DataState` 的重试；未结束事件需核对仍在执行与异常路径 | 重试按钮或当前表格 | `app/api/audit/route.ts`        |
| Admin mutation    | 各已有管理页           | 按原页面的忙碌状态              | 原页面或既有列表    | API 终结结果     | 失败不伪称成功；检查审计页的 started/partial           | 维持原页面契约     | `lib/core/admin-audit-route.ts` |

## Navigation and responsive behavior

- Route document title policy: 根 metadata 提供服务器默认标题；客户端 `LiveProvider` 应保留品牌与当前后台路由的上下文，不在标题中放敏感信息。
- Route error / 403 page behavior: 现有共享管理员令牌只提供认证，尚无个人角色/RBAC；不得把页面可见性当作授权。
- Sidebar/drawer/bottom-sheet transformation: 复用 `AppSidebar` 的桌面侧栏与移动 Sheet。
- Responsive table strategy: `TableShell` 水平滚动，保留完整列；不转换为会丢失审计字段的卡片。
- Truncation/full-value access: UUID 等技术值用单行截断前必须保留完整 title/复制路径；当前审计页可通过横向表格展示完整值。

## Overlays and feedback

- Dialog primitive: `components/ui/dialog.tsx`。
- Destructive confirmation levels: 与现有写操作 API 和 `AlertDialog`/`Dialog` 模式保持一致；只读审计页无写操作。
- Toast placement/duration/deduplication: 根 `Toaster`/sonner 的既有行为。
- Alert/banner scope and persistence: `Notice` 仅用于影响当前页的持续风险，如未结束审计事件或保留旧数据时的读取失败。
- Tooltip delay/dismissal: 共享 TooltipProvider。

## Async and resilience

- Mutation default: 管理变更悲观确认；不为非幂等或外部副作用自动重试。
- Idempotency and duplicate-submit policy: 由既有 API 和按钮 busy 状态负责；审计只反映服务端所返回的 HTTP 结果。
- Offline/read-stale/write behavior: `usePolling` 在隐藏页暂停、失败退避，后台刷新保留最后成功数据；审计页用 `Notice` 和重试保留该失败上下文，写失败不进入队列。
- Retry/backoff/timeout behavior: `usePolling` 复用在飞请求并退避；`DataState` 提供明确重试。
- Version conflict and multi-tab behavior: 未提供通用版本协议；高风险编辑需要领域 API 单独定义。
- Session expiry/re-authentication: 由既有共享管理员令牌认证处理；尚无个人身份恢复流程。
- Stale-request cancellation/invalidation and pending-state ownership: `usePolling` 的 URL 过期保护和 in-flight 闸门为只读页唯一实现。

## Permission and clipboard

- Permission UI strategy: 当前无 RBAC；审计页面只依赖服务端管理认证，不能声称按人员或角色隔离。
- Clipboard copy policy: 新页面不新增复制控件；若未来加入，只复制服务端 request UUID，不在 toast 中回显敏感值。

## Migration status

- Canonical primitives and owners: `PageShell`、`PageHeader`、`DataState`、`TableShell`、`Notice`、`Button`、`Badge`、`usePolling`。
- Current risk-prioritized slices: 先将管理变更审计从 API 接入到只读后台页面；不借此重做其他后台页面。

## Verification

- Required static commands: formatter、typecheck、lint、Vitest、设计 lint、严格 UI 静态审计。
- Browser/device/locale/theme matrix: 成功、首次加载、错误、空态、未结束提示、窄屏横向表格、键盘、light/dark、reduced motion。
- Canonical sibling flow used for comparison: `app/admin/ranking/page.tsx`（只读轮询表格）和 `components/app-sidebar.tsx`（系统导航）。
- Failure-path evidence: `DataState` 与 API 审计测试。
