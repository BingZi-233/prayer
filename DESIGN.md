---
version: alpha
name: Prayer
description: "面向多渠道 AI 客服运营团队的中文控制台：以克制、高密度的服务台界面帮助人处理会话、知识与运行风险。"
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.67 0.16 58)"
  destructive: "oklch(0.577 0.245 27.325)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
  sidebar: "oklch(0.985 0 0)"
typography:
  sans:
    fontFamily: "Inter, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, ui-sans-serif, system-ui, sans-serif"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
rounded:
  DEFAULT: "0.625rem"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
spacing:
  page: "1rem"
  page-desktop: "1.5rem"
  content-gap: "1rem"
  card: "1rem"
  card-compact: "0.75rem"
components:
  button: {}
  card: {}
  table: {}
  sidebar: {}
  notice: {}
---

# Prayer Design System

## Overview

### Creative North Star

Prayer 的后台应像一张被妥善编目的值班台：白色工作面、低饱和边界、少量琥珀色主操作和清晰的风险标记。信息密度服务于排障与交接，而不是制造仪表盘式的炫目感。

### Product context and register

- **Audience and primary job:** QQ、Telegram 等社区场景的客服运营与管理员，处理会话、知识、人工接待和运行异常。
- **Target market(s) and evidence:** 默认面向中文团队；产品定位和运营闭环以 `README.md` 为依据，不将 `zh-CN` 推断为特定国家市场。
- **Locale(s) and language policy:** 当前界面为 `zh-CN`；面向操作者的文案使用简洁、可执行的中文，不承诺未实现的多语言切换。
- **Usage scene:** 桌面优先的日常运营、故障排查和交接；窄屏仍必须保留导航与表格的横向访问路径。
- **Register:** 产品后台。熟悉、可扫描和可恢复优先于品牌化装饰。
- **Memorable signature:** 风险总是先以一条清晰的状态带出现，再回到紧凑、可追溯的数据表；不让告警淹没正常工作面。
- **Restraint:** 页面主体使用共享卡片、表格、提示条和侧栏，单个审计/状态页不引入新的视觉语言、渐变或动画。
- **Anti-references:** 不做暗色“安全终端”、营销落地页式大数字英雄区，也不把日志伪装成社交时间线；这些都会降低高密度运维阅读效率。
- **Token ownership/runtime mapping:** `app/globals.css` 的 `:root`、`.dark` 与 `@theme inline` 是运行时 token 的唯一所有者（Model B）。本文件镜像已接受的值和意图；改 token 时先改 CSS，再同步本文件，并以 `npx -p @google/design.md designmd lint DESIGN.md` 和已渲染页面检查漂移。

## Colors

浅色背景 `colors.background` 与近黑正文 `colors.foreground` 承担默认阅读层级；`colors.border` 与 `colors.muted` 只划分结构，不制造额外色带。琥珀 `colors.primary` 仅用于安全的主操作、当前导航和关键正向状态；红色 `colors.destructive` 只用于失败、危险或需立即处理的信号。暗色主题由 `app/globals.css` 的同名语义变量重新映射，不能在页面内写死颜色。

## Typography

正文使用 `typography.sans`：Inter 处理拉丁字母，后续系统字体覆盖中文。标题以紧凑的半粗体建立层级，操作和表格保持小号可扫描文本；数值、HTTP 状态和关联 UUID 使用 `typography.mono` 或 `tabular-nums`，但不把客户内容伪装成代码。中文不使用全大写或斜体作为语义。

## Layout

后台由固定侧栏、粘性顶部栏和一个应用内容滚动区组成。`PageShell` 的默认内容节奏为 `spacing.content-gap`，小屏使用 `spacing.page`、中等及以上使用 `spacing.page-desktop`。长表格仅在 `TableShell` 内滚动并给出横向访问空间；禁止为了表格向共享页面壳添加 viewport 高度或 `overflow-hidden`。

## Elevation & Depth

层级主要来自边框、极轻的 ring 和卡片背景，而非投影堆叠。卡片可使用共享的微弱阴影/ring；侧栏、顶部栏和粘性表头用背景与边界保持位置感。告警用 `Notice` 的低饱和语义面，不使用整页着色。

## Shapes

标准控制与卡片遵循 `rounded.md`/`rounded.lg` 的轻微圆角；徽章可为圆角胶囊。边界使用细线，图标容器保持方圆角，不引入大圆角或厚描边作为装饰。

## Components

### Foundational visual states

复用 `DataState` 管理首次加载、错误、空态与内容，首次加载可以使用与最终区域同尺寸的 `Skeleton`。后台刷新保留旧数据；错误提供明确的重试入口。所有动画遵循全局 reduced-motion 规则。

### Buttons and actions

复用共享 `Button`：安全主操作使用默认琥珀强调，次要操作用 outline/secondary，危险操作用 destructive 并与安全操作分开。按钮必须保持忙碌前后的几何稳定，图标辅助文字而不替代文字。

### Navigation and data display

复用 `AppSidebar`、`PageHeader`、`TableShell`、`Badge` 和 `RelativeTime`。表格面向有限、可扫描的运营窗口；窄屏通过表格壳横向滚动，不静默隐藏列。状态必须同时有文字和语义色；相对时间以本地绝对时间 title 补充。

### Forms and overlays

表单、对话框、toast 与提示条均使用现有共享组件。高风险或不可逆写操作使用应用内确认对话框；只读状态页不增加无必要的筛选、复制或弹窗控件。

### Iconography

使用 Lucide 的线性图标，常规尺寸约 14–16px。导航和按钮图标始终伴随可见文字或可访问名称；图标不单独承担审计状态含义。

### Motion

过渡只支持反馈和定位：共享组件的短过渡即可。页面不增加连续动画；用户启用 reduced motion 时由全局样式近乎即时完成。

### Content and data visualization

中文文案以动作和结果为中心，例如“未结束记录”“部分完成”“重试”。审计记录只展示安全的开始/结束时间、动作、路由、HTTP 结果、授权模型和服务端关联 ID；不得将共享令牌模型表述为真实操作人，也不得展示请求体、客户标识、原始错误或内容。

## Do's and Don'ts

- **Do:** 用共享提示条优先暴露仍需人工处理的风险，再用表格提供有限范围的证据。
- **Do:** 将状态、时间和数据来源的边界写清楚，避免用视觉暗示不存在的确定性。
- **Don't:** 为一个后台页面引入屏幕级高度约束、独立色板或替代性的 table/loading 组件。
- **Don't:** 把共享管理员令牌、关联 UUID 或技术错误呈现为人员身份、客户数据或合规证明。
