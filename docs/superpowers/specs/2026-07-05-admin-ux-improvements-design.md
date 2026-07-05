# 管理后台 UX 改进设计

日期:2026-07-05
分支基线:main
范围:仅 Web 管理后台(`app/admin/**`、`components/**`、`app/api/overview`)。不动 Agent 运行时、不发消息、不改后端可变状态。

## 背景

后台代码质量已高(shadcn、空状态、toast、skeleton、每 3s 轮询)。但从**运维真实使用视角**看,核心动线有断点。本设计按痛点排序,保持现有视觉风格(全站 monospace + 灰阶主题;语义色仅复用主题已有的 `destructive`),零新依赖。

真实用户 = 盯 QQ 群客服 bot 的运维/客服主管。本次决策:转人工响应**只做「知道 + 定位」纯前端**,不发消息、不改工单/人工后端状态、不加接管 API。

## 痛点排序

1. **漏掉转人工(最痛)** — 客户触发转人工后,运维不在概览页就完全无感知;工单数埋在正文、无角标、无提醒。
2. **知道了也难处理** — 工单→会话动线断:key 是裸 `12345:67890` 认不出人/群、transcript 只读、群名不解析。
3. **"bot 正不正常"要点进概览** — 全局无状态指示。
4. **满屏绝对时间戳** — `2026/7/5 14:03:22` 不如「3 分钟前」。

## 关键事实(已核对)

- **session key 格式** = `` `${groupId}:${userId}` ``(见 `lib/agent/gateway.ts:39`)。群名解析:`key.split(":")` → `[0]`=groupId(映射群名)、`[1]`=userId(QQ)。
- `repo.openTickets()` 已存在(返回 open 工单)。`repo.listSessions()` 返回含 `humanMode`/`humanSince`/`lastQuestion`。
- `/api/onebot/groups` 返回 `{ groupId, groupName }[]`,bot 断连时失败 → 回退裸 id(现有模式)。
- 群名解析在 reflection/groups 页已有先例(`names` map + `name(gid)` 回退),复用同模式。
- `components/ui/sidebar.tsx` 已导出 `SidebarMenuBadge`、`SidebarFooter`。
- next-themes 已装;`ThemeProvider` 内已有 `d` 热键切换,仅缺可见按钮。

## 架构

### 共享实时信号:`LiveProvider`(客户端 Context)

新增 `components/live-provider.tsx`,挂在 `app/admin/layout.tsx` 内(SidebarProvider 之内)。

- 每 3s 轮询 `/api/status` + `/api/overview`,派发 `{ status, overview, lastUpdated }`。
- `useLive()` hook 供 header、侧栏消费。
- 轮询失败静默(沿用现有模式),保留上次值。
- **不替换** 各页现有的本地轮询(最小爆炸半径);仅为全局 header/侧栏提供数据。overview 页可后续选择改用 context,本次不强制。

选型理由:相比引入 SWR/react-query(加依赖、与手写 fetch 风格不一致)或每个消费组件各自轮询(请求翻倍、状态不同步),单一 Context 轮询零依赖、与现有风格一致、请求量不增(overview 页本就在轮询这两个端点)。

### `/api/overview` 扩展

在现有返回上追加两字段:

```ts
ok({
  enabledGroups: cfg.enabledGroups.length,
  reflectionCount: repo.reflectionEntries().length,
  openTickets: repo.openTickets().length,          // 新增
  humanSessions: repo.listSessions().filter(s => s.humanMode).length,  // 新增
})
```

无需新 repo 方法(`openTickets`/`listSessions` 均已存在)。

## 组件设计

### 新建通用组件

- **`components/relative-time.tsx`** — `<RelativeTime ts={number} />`
  - 渲染「x 分钟前 / x 小时前 / 刚刚 / N 天前」,`title` 属性挂 `toLocaleString()` 绝对时间(hover 可见)。
  - 内部 `setInterval` 30s 触发重渲染,保持相对文案新鲜。
  - `suppressHydrationWarning`(服务端/客户端 now 不一致)。
  - 替换 tickets、groups、reflection、overview(bootedAt)全部 `toLocaleString()` 直接展示处。

- **`components/polling-indicator.tsx`** — `<PollingIndicator lastUpdated={number} />`
  - 脉冲小点 +「实时 · Xs 前」文案,放各轮询页标题旁或 header。

- **`components/theme-toggle.tsx`** — sun/moon 图标按钮,`next-themes` `setTheme` 切换,复用已有 `d` 热键逻辑。放 header 右侧。

### 全局层改动

- **`app/admin/layout.tsx`**
  - 包一层 `LiveProvider`。
  - header 左侧加**运行状态点**:实心圆点,color 由 `status.state` 决定 — 运行=`bg-primary`、错误=`bg-destructive`、其他=`bg-muted-foreground`;旁边文案「运行中/错误/已停止」。断连时点变空心/灰。
  - header 右侧:`<PollingIndicator>` + `<ThemeToggle>`。

- **`components/app-sidebar.tsx`**
  - 工单项:`overview.openTickets` 加 `SidebarMenuBadge`(>0 才渲染)。
  - 会话项:`overview.humanSessions` 加 `SidebarMenuBadge`(人工数,>0 才渲染,`destructive` 语气)。

- **浏览器 tab 标题** — `LiveProvider` 内 effect:`openTickets > 0` 时 `document.title = "(N) 客服 Agent"`,否则 `"客服 Agent"`。离开页面也能瞥见。

### 页面改动

- **overview(`app/admin/page.tsx`)**
  - 顶部加**待处理提醒卡**:`openTickets > 0` 或 `humanSessions > 0` 时渲染,`border-destructive/50`,显数量 + 「查看工单」「查看人工会话」跳转按钮。无待处理则不渲染。
  - `bootedAt`、错误时间用 `<RelativeTime>`。
  - 重启按钮加**二次确认 Dialog**(复用现有 `components/ui/dialog.tsx`,不引 alert-dialog)。

- **工单(`app/admin/tickets/page.tsx`)**
  - 拉 `/api/onebot/groups` 解析群名(复用 reflection 页 `names` map 模式)。
  - 表格:会话列显「群名 · QQ」而非裸 key;创建时间用 `<RelativeTime>`。
  - 每行「查看会话」按钮 → `/admin/sessions?key=<encodeURIComponent(sessionKey)>`。
  - 裸 `<p>暂无工单</p>` → `<Empty>`。

- **会话(`app/admin/sessions/page.tsx`)**
  - 读 URL `?key=` query,自动选中并打开对应会话、滚动/高亮。
  - 会话 key 解析:列表项显「群名 · QQ」,`key.split(":")` → groupId 映射群名 + userId。裸 id 回退。
  - 顶部加**「仅人工」筛选开关** + **搜索框**(按 key/群名/lastQuestion 过滤)。
  - 人工会话置顶或高亮(现已有 destructive badge,增排序:humanMode 优先)。
  - 会话列表**自动轮询**(3s,复用 refresh 逻辑),但**不打断**已打开 transcript(仅在选中会话有更新时刷新 transcript,沿用现有 `refresh()` 中的条件)。
  - 空状态沿用现有 `<Empty>`。

- **日志(`app/admin/logs/page.tsx`)**
  - 级别筛选:info/warn/error 三个 toggle(shadcn Badge 或 Button `variant=outline` 切换),默认全开。
  - 搜索框:按 `msg` 子串过滤。
  - **暂停自动滚动** checkbox(暂停时不 auto-scroll to bottom;当前无 auto-scroll,先加 auto-scroll + 暂停控制)。
  - **复制**按钮(当前可见日志 → clipboard)。
  - 裸 `<p>暂无日志</p>` → `<Empty>`。

- **反思(`app/admin/reflection/page.tsx`)** / **生效群(`app/admin/groups/page.tsx`)**
  - 时间戳(`fmtTs`)→ `<RelativeTime>`。
  - 裸 `<p>暂无…</p>` → `<Empty>`。

- **config(`app/admin/config/page.tsx`)**
  - 生效群 Badge 的 `✕` 文本字符 → lucide `X` icon 小按钮(可点删)。

## 数据流

```
/api/status ─┐
             ├─► LiveProvider (3s poll) ─► useLive() ─┬─► header 状态点 + PollingIndicator
/api/overview┘                                        ├─► 侧栏 SidebarMenuBadge (工单/人工数)
                                                      └─► document.title 前缀

页面本地轮询(不变):各页自己的 /api/tickets、/api/sessions、/api/logs 等
群名解析(复用模式):/api/onebot/groups → names map → name(gid) 回退裸 id
动线跳转:工单行「查看会话」→ /admin/sessions?key=… → 自动打开高亮
```

## 错误处理

- 所有轮询失败静默,保留上次值(沿用现有 catch 空块模式)。
- `/api/onebot/groups` 失败(bot 断连)→ 群名回退裸 id(现有行为)。
- `LiveProvider` 首帧无数据 → header 状态点显灰/加载态,不阻塞渲染。

## 测试

- 现有测试为后端(126 tests)。本次纯前端展示层改动,无新增后端逻辑(仅 overview API 加两个已有 repo 方法的调用)。
- overview API 扩展:补一条断言新字段存在的测试(若已有 overview API 测试则扩展,否则新建轻量测试)。
- 前端交互无单测基建,依赖手动冒烟:启动 dev,验证状态点/角标/tab 标题/工单跳会话/仅人工筛选/日志筛选。

## 交付分批

- **批 1 — 转人工动线(痛点 1+2,核心)**:overview API 扩展、LiveProvider、header 状态点、侧栏角标、tab 标题、overview 提醒卡、工单页群名+跳转、会话页 `?key=` 自动打开 + 群名 + 仅人工筛选 + 搜索 + 自动轮询。
- **批 2 — 支撑改进(痛点 3+4)**:ThemeToggle、PollingIndicator、RelativeTime 全站替换、统一 Empty、日志页升级、config `✕`→icon、重启二次确认。

## 明确不做

不动字体/配色体系、不发任何消息、不改工单/人工后端状态、不加接管/回复/关单、不重排页面布局、不加图表库、不引新前端依赖。
