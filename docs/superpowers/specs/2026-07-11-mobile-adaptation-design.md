# 移动端适配设计

日期:2026-07-11
分支基线:main
方案:B(抽共享原语 `MasterDetail` + 逐页 Tailwind 断点补丁)
目标深度:可用即可(消除横向滚动、面板重叠、点不到的控件;不追求像素级精致)
覆盖范围:全部 13 个 admin 页 + login 页

## 背景

当前 UI 基于 Next.js 16 + Tailwind v4 + shadcn/radix。诊断后确认外壳与共享组件已具备响应式能力,移动端主要缺口集中在少数页面结构:

已合格(不改):
- 外壳 `app/admin/layout.tsx`:`SidebarProvider` + `SidebarTrigger`,移动端侧栏自动降级为 Sheet 抽屉;header 用 `sm:` 断点。
- `components/admin/page-header.tsx`:`flex-col sm:flex-row`。
- admin 首页运行概况 KPI:`flex-wrap`。
- admin 首页用量表格 `app/admin/page.tsx`:`min-w-[32rem]` + 外层 `overflow-auto` + 首列 sticky + `hidden sm:table-cell`/`hidden md:table-cell` 渐进列。
- `app/admin/plugins/page.tsx` 网格:`sm:grid-cols-2 lg:grid-cols-4`(移动端 1 列)。

唯一结构缺口:
- master-detail 双栏页(`sessions`、`kb`)用 `lg:grid-cols-[340px_1fr]` / `md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]`。断点以下两栏纵向堆叠且同时渲染,挤在 `h-svh overflow-hidden` 外壳内,小屏每栏都过矮,且无单栏切换与返回。

## 组件:`components/admin/master-detail.tsx`

封装"手机单栏切换 / 桌面双栏",sessions + kb 共用,单处实现避免复制切换逻辑。

接口:

```tsx
export function MasterDetail(props: {
  selected: boolean;          // 真值 = 显示详情栏(手机);桌面恒双栏
  onBack: () => void;         // 手机详情返回列表
  list: React.ReactNode;      // 列表面板(通常一个 SectionCard)
  detail: React.ReactNode;    // 详情面板(通常一个 SectionCard)
  listWidth?: string;         // 桌面左栏宽,默认 "340px"
  backLabel?: string;         // 返回条文案,默认 "返回"
  breakpoint?: "md" | "lg";   // 桌面双栏起始断点,默认 "lg"
  className?: string;
}): React.ReactElement;
```

行为:
- 用现有 `hooks/use-mobile.ts` 的 `useIsMobile()`(768px 断点)判定手机态。
- 桌面(非手机):渲染 `grid min-h-0 flex-1 gap-4 {breakpoint}:grid-cols-[{listWidth}_1fr]`,同时显示 list + detail。等价现有布局,行为不变。
- 手机:
  - `!selected` → 仅渲染 list,占满宽高。
  - `selected` → 渲染 detail,顶部注入 sticky 返回条(`‹ {backLabel}`),点击区高度 ≥44px,调用 `onBack`。
- SSR 一致性:`useIsMobile()` 首帧返回 `false`(hydration 前),桌面双栏为安全默认,不闪烁错误单栏。

契约:
- 做什么:根据视口与选中态,在双栏与单栏切换间取舍。
- 怎么用:传 list/detail 两个面板 + selected/onBack。
- 依赖什么:`useIsMobile`、`cn`。无数据获取,纯展示容器。

## 逐页改动

| 页 | 改动 |
|---|---|
| `app/admin/sessions/page.tsx` | 现有 `lg:grid-cols-[340px_1fr]` 区(约 496 行)替换为 `<MasterDetail selected={!!active} onBack={() => setActive(null)} listWidth="340px" backLabel="返回会话列表" list={会话列表 SectionCard} detail={会话记录 SectionCard} />`。骨架屏 `SessionsSkeleton`(约 108 行,`lg:grid-cols-[320px_1fr]`)保持桌面双栏、移动单栏占满即可,可不套组件(纯骨架)。 |
| `app/admin/kb/page.tsx` | 现有 `md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]` 区(约 599 行)套 `<MasterDetail breakpoint="md" listWidth="280px" backLabel="返回文件列表" selected={当前选中文件真值} onBack={清空选中} list={文件树} detail={编辑区} />`。选中态取该页已有的"当前打开文件"状态。 |
| 其余 11 admin 页 + login | 375px 视口逐页驱动验证;仅对发现的横向溢出 / 窄点击区补 Tailwind 断点补丁。预期改动极少——共享组件已响应式。 |

不改:admin 首页表格、`PageHeader`、KPI flex-wrap、plugins 网格(见背景,已合格)。

## 错误处理 / 边界

- 手机详情返回:`onBack` 由各页把选中态置空;返回列表后保留滚动/筛选状态(现有 state 不清)。
- kb 选中态若为多字段(路径 + 内容),`selected` 传路径真值即可,`onBack` 清路径。
- 无选中时手机不渲染 detail 子树,避免空详情占位与多余请求。

## 测试 / 验证

Playwright 逐页驱动两视口:**375×667(iPhone SE)** 与 **768×1024**。

- 每页断言无横向滚动:`document.documentElement.scrollWidth <= clientWidth + 1`。
- sessions:375px 下点列表项 → 进详情 → 点返回 → 回列表,链路通;桌面 768px+ 双栏并存。
- kb:同上,文件树 → 编辑区 → 返回。
- 抽查:主操作按钮点击区、侧栏抽屉、弹窗/对话框不溢出视口。

无自动化测试覆盖这些页面组件(codegraph 标注 no covering tests);验证以 Playwright 手动驱动为准,不新增单测。

## 范围外

- 不做像素级移动端重排、字号/间距分级体系、表格转卡片。
- 不改后端 / API。
- 不做无关重构。
