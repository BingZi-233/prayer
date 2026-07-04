# 群多选下拉（带群名）设计

日期：2026-07-05
分支：feat/onebot-agent

## 背景与目的

config 页当前「管理群号」「生效群」都手填群号。改为从 NapCat 拉取群列表、按**群名**展示的下拉：管理群单选、生效群可搜多选。降低误填、提升可用性。

## 需求（已澄清）

| 项 | 决策 |
|---|---|
| 群列表数据源 | 复用运行中的 WS client（`getRuntime()`），调 OneBot `get_group_list` |
| bot 未连接 / 拉取失败 | 禁用下拉 + 提示「请先启动并连接 bot」，不提供手填降级 |
| 组件 | shadcn：管理群 Select 单选；生效群 Command+Popover 可搜多选（Badge 展示已选） |

## 架构

数据链：`config 页` → `GET /api/onebot/groups` → `getRuntime().getGroups()` → `OneBotClient.getGroupList()` → WS `call("get_group_list")`（echo 关联，8s 超时降级 undefined）。

## 变更清单

### 1. lib/onebot/client.ts
- 加公开方法 `getGroupList(): Promise<unknown[] | undefined>`，内部 `return this.call("get_group_list", {})`（`call` 已存在，echo 关联，未连接/超时 resolve undefined）。
- 返回原始 data（`call` resolve 的 `evt.data`）；归一化留给 API 层。

### 2. lib/runtime.ts
- `RuntimeClient` 接口加**可选**方法：`getGroupList?(): Promise<unknown[] | undefined>;`（可选 → 既有测试 stub 不破）。
- `RuntimeManager` 加 `async getGroups(): Promise<unknown[] | undefined> { return this.client?.getGroupList?.(); }`（无 client / 未实现 → undefined）。

### 3. app/api/onebot/groups/route.ts（新建）
- `GET`：`const raw = await getRuntime().getGroups();`
- `raw` 为 undefined 或非数组 → `NextResponse.json(fail("bot 未连接或无法获取群列表"), { status: 503 })`。
- 否则归一化：`raw.map((g) => ({ groupId: Number(g.group_id), groupName: String(g.group_name ?? g.group_id) }))`，过滤 `groupId` 非有限值 → `NextResponse.json(ok(list))`。
- 复用 `getRuntime`（`@/lib/runtime`）、`ok`/`fail`（`@/lib/api`）。

### 4. shadcn 组件安装
- 经 shadcn skill 装：`select`、`command`、`popover`、`checkbox`（`badge` 已有）。
- 装后确认对应 radix 依赖（`@radix-ui/react-select`、`@radix-ui/react-popover`、`@radix-ui/react-checkbox`、`cmdk`）进 package.json。

### 5. app/admin/config/page.tsx
- 挂载时 `fetch("/api/onebot/groups")` → `groups: {groupId,groupName}[] | null`（失败 null）+ `groupsLoading` 状态。
- **管理群号** `<Field>`：
  - `groups` 有值 → shadcn `Select`，选项为群列表（label=`群名 (groupId)`），value=groupId 字符串；`onValueChange` → `upd("adminGroupId", v)`（走既有 NUM_KEYS 转 number）。
  - `groups` 为 null → 禁用 + 提示。
- **生效群** `<Field>`：
  - `groups` 有值 → Command+Popover 多选：Popover 触发按钮显示已选数/Badge；面板内 Command 可搜，每项 Checkbox 勾选；勾选 toggle `cfg.enabledGroups`（保持 number[]，去重）。已选 group_id 不在列表 → 仍显示裸 id 的 Badge（可取消）。
  - `groups` 为 null → 禁用 + 提示。
- **未连接提示**：`groups` 为 null 时，两字段下方显示 muted 文本「请先在上方填写连接并启动 bot，连接后可从群列表选择。」（不引入新 Alert 组件，用现有文本样式）。
- 移除原 `adminGroupId` 的 `<Input>` 与生效群的 `<Textarea>`（及 Task 7 的 `groupsText`/`commitGroups` 文本解析逻辑，改由勾选维护 number[]）。
- `save()` payload 不变（`{ ...cfg }` 已含 `adminGroupId`/`enabledGroups`）。

## 边界与不变量

- `get_group_list` 仅在 WS 连接时有响应；8s 超时 → undefined → API 503 → UI 禁用。
- cfg 存储语义不变：`adminGroupId: number`、`enabledGroups: number[]`（空=全关）。
- 保存的群号即使 bot 已退群、不在最新列表，也不丢失（裸 id 回退展示）。
- 管理群与生效群均需 bot 连上才可选（符合未连接=禁用决策）。

## 测试

| 文件 | 用例 |
|---|---|
| tests/lib/onebot/client.test.ts | `getGroupList` 发 `get_group_list` 并按 echo 解析 data；未连接 → undefined（可复用现有 WSServer/echo 测试骨架） |
| tests/lib/runtime.test.ts | `getGroups` 委托 client.getGroupList；无 client（未 start）→ undefined；client 无该方法 → undefined |
| 前端 | 无自动化 UI 测试（同仓库惯例）；靠 `pnpm build` + 手工冒烟 |

## 非目标（YAGNI）

- 群列表缓存 / 定时刷新（每次进页面现拉即可）。
- 临时独立 WS 连接拉列表（依赖 bot 已连）。
- 手填降级（已决定禁用+提示）。
- 群成员数等额外信息展示。
