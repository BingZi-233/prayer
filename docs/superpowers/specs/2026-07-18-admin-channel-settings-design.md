# 管理后台全面多通道（配置 + 生效会话 + 管理面）设计

日期：2026-07-18  
分支建议：`feat/admin-channel-settings`  
状态：已确认（方案 A）

## 1. 背景与目标

后端已完成 Channel 插件化与 Telegram 接入：`enabledChats` / `adminSurface` 为 `ChatRef`，`ChannelRegistry` 分发 `action.send`，gateway / handoff / 反思通知等多处已按 `adminSurface.channel` 发送。

管理后台仍残留 OneBot 时代叙事：

- 配置页 Tab 为「OneBot / Telegram」，管理面选择器仅 QQ
- 「生效群」页以 `groupId: number` 为主键，toggle/策略写路径偏 QQ
- 顶栏文案「OneBot 客服 Agent」
- 策略保存仍可能写裸群号 key，与 `policyKey(channel, chatId)` 不一致

### 目标

1. **配置页**：按「通道连接 + 通用业务」组织；管理面可选 QQ 或 TG
2. **生效会话页**：统一表（`channel:chatId`），开关与策略覆盖跨通道
3. **壳层文案**：去掉单通道主叙事
4. **策略 key**：写路径统一 `policyKey`，不再写裸群号

### 非目标

- Discord 实现（仅类型预留；UI 不出现可配入口）
- TG 私聊客服、Webhook
- 新管理命令语法（仍用 `!reset` / `!resume` + sessionKey）
- 整页重做 reflection / ranking / sessions 等运营页（仅修会坏的 channel 展示/key）

## 2. 方案

**方案 A：UI 先行 + 管理面「最小后端」**

- 配置页改成通道视角；生效群页改成跨通道表格
- 后端：`adminSurface` 已是 `ChatRef`；gateway / handoff / 反思 / 用量告警已按 surface 发送
- 本次后端增量以 **补测试 + 修策略写 key / 文案** 为主；若测出隐含 QQ 假设再最小修补
- TG 管理命令：复用文本门 `!reset` / `!resume`，不另做 Bot Command

未选方案 B（两阶段半成品）与方案 C（新建通道中心页）。

## 3. 范围与能力矩阵

用户确认「全开」：

| 能力 | 要求 |
|------|------|
| 运营通知抄送 | 转人工、反思沉淀/整理/升格、日用量告警 → `adminSurface` |
| 管理命令 | 管理面会话内 `!reset` / `!resume` |
| 跨通道 handoff | 任意通道用户转人工 → 通知到所选 QQ 或 TG 管理面 |
| 生效会话统一表 | 一行一个 `channel:chatId`，策略同一套 |

### 后端现状（可复用）

| 能力 | 现状 |
|------|------|
| 管理命令 | gateway 已用 `isAdminSurface`，不绑 QQ |
| handoff 抄送 | `handoff-handler` 已发到 `adminSurface` |
| 任意通道转人工 | 有 adminSurface 即 emit，不限 QQ 来源 |
| 反思/升格通知 | 已用 `adminSurface.channel` |
| 用量告警 | runtime 已按 adminSurface 发 |
| `/api/groups/activity` | 已返回 `channel` / `chatId` / `policyKey` |

## 4. 配置页信息架构

### 4.1 Tab 重组

| 现 Tab | 新 Tab | 内容 |
|--------|--------|------|
| OneBot | **QQ 通道** | WS、token、botQQ、extraAtQQs、QQ 生效群勾选 |
| Telegram | **TG 通道** | token、生效 chat、部署清单（Privacy 等） |
| — | **管理面**（新） | `adminSurface` 选择 + 转人工超时 |
| 回复体验 / Claude SDK / 会话 / 反思 / 主动回复 / 通知 / 存储 | **保持** | 文案「管理群」→「管理面」 |

推荐顺序：

`QQ 通道` → `TG 通道` → `管理面` → `回复体验` → `会话` → `反思` → `主动回复` → `通知` → `Claude SDK` → `存储`

### 4.2 字段归属

- **通道私有**：连接凭证、该通道生效白名单、通道特有触发（如 QQ `extraAtQQs`）
- **跨通道业务**：`adminSurface`、`handoffTimeoutMin`、ACK、supportUrl、反思与主动参数等
- **不再**把「管理群号」塞在 QQ 连接区

### 4.3 管理面选择器

1. **通道** Select：`QQ` | `Telegram` | `无（关闭）`
2. **会话**
   - QQ：群列表下拉（`/api/onebot/groups` 或统一 names API）
   - TG：从 `enabledChats` 中 channel=tg 的列表选，**或**手填 chat id（字符串，可负）
3. 保存：`adminSurface: { channel, chatId } | null`（与现 `/api/config` 一致）

说明文案要点：

- 管理命令仅在该会话生效
- 通知（转人工 / 反思 / 用量）发到此会话
- 管理面 **不必** 在生效白名单内（gateway 已豁免）

校验：

- 选了通道但 chatId 空 → 保存前 toast，不提交
- TG 管理面 + token 空 → 警告「TG 未配置，通知发不出」但仍可保存

### 4.4 生效白名单在配置页

- QQ / TG 各自 Tab **仍可编辑**本通道 `enabledChats`（避免配置时来回跳页）
- 描述链到「生效会话」页做细策略
- 保存时合并 TG 草稿/批量框逻辑保留

### 4.5 壳层命名

| 位置 | 现文案 | 新文案 |
|------|--------|--------|
| `layout` 顶栏 | OneBot 客服 Agent | 客服 Agent |
| 通知 Tab | 反思通知管理群 | 反思通知管理面 |
| 侧栏 groups | 生效群 | 生效会话 |

### 4.6 组件拆分

`app/admin/config/page.tsx` 已偏大。实现时优先：

- 抽出 `Cfg` / helpers，或按 Tab 子组件

不强制一次大拆；以可读为准。

### 4.7 不做的配置项

- Discord 入口
- 模型 / ANTHROPIC_*（仍只在 `settings.json`）
- 清空 TG token 的特殊 UI（掩码 + 留空不覆盖）

## 5. 生效会话页 + API / 策略 key

### 5.1 定位

| 项 | 现况 | 目标 |
|----|------|------|
| 路由 | `/admin/groups` | **保持**（书签/外链） |
| 侧栏 / 标题 | 生效群 | **生效会话** |
| 行主键 | `groupId: number` | **`channel` + `chatId`** |
| 数据源 | `/api/groups/activity` | 同 API，前端用完整字段 |

### 5.2 表格列

- 通道 Badge（QQ / TG）
- 会话显示名 + mono `chatId`
- 生效 Switch
- 消息数 / 最近活动
- 策略摘要
- 编辑策略 / 清除覆盖

### 5.3 Toggle

```ts
const others = enabledChats.filter(
  (c) => !(c.channel === row.channel && c.chatId === row.chatId)
)
const next = enable
  ? [...others, { channel: row.channel, chatId: row.chatId }]
  : others
PUT /api/config { enabledChats: next }
```

禁止再写死 `channel === "qq"`。

### 5.4 策略覆盖

- **写**：`groupPolicies: { [policyKey(channel, chatId)]: policy | null }`
  - 例：`qq:123456`、`tg:-1001234567890`
- **读**：用服务端 `policy` / `effective` / `policyKey`
- **兼容**：`getGroupPolicy` 对 QQ 裸键回退保留；新写只用新键
- 可选：保存 QQ 策略时顺带 null 掉裸键（非必须）

### 5.5 策略编辑 Sheet

字段不变（主动补位 / 静默 / 转人工通知；三态 inherit）。  
文案「管理群」→「管理面」。  
标题：`{通道} · {显示名}`，副标题 `channel:chatId`。

### 5.6 显示名

- 短期可继续 `useGroupNames()` 对 `Number(chatId)`（TG 负 id 仍可用）
- 优先能 `nameByChat(channel, chatId)`；`groupId===0` 时回退裸 `chatId`
- **不强制** 本次重写整个 `lib/group-name.ts`

### 5.7 API 契约

`/api/groups/activity` 保持现返回形状；前端以 `channel` / `chatId` / `policyKey` 为主键，`groupId` 仅兼容字段。  
本次可不改 route 逻辑。

## 6. 后端增量

| 模块 | 动作 |
|------|------|
| gateway / handoff / 反思 / 用量 | 基本不动；测出 QQ 假设再最小修 |
| `/api/config` | 契约不动 |
| `/api/groups/activity` | 可不改 |
| config-store / migrate | 不动 |

实现期必补测试：

1. TG 管理面 `!reset` / `!resume`，回执 channel 为 `tg`
2. TG 管理面 + QQ/TG 来源 handoff 通知目标正确
3. 策略 key `tg:-100…` 读写命中（前端路径 + 既有 getGroupPolicy）

## 7. 错误与边界

| 场景 | 行为 |
|------|------|
| `adminSurface = null` | 人工关键词引导 supportUrl；不 emit handoff |
| 管理面通道未连接 | 配置可保存；send 失败走现有 error 日志 |
| 管理面不在 enabledChats | 允许 |
| Discord | UI 不出现 |
| 策略双键（裸 QQ + `qq:id`） | 读兼容；新写只用新键 |

## 8. 测试与验收

### 自动化

- gateway：TG 管理面命令 + QQ 回归
- handoff-handler：`adminSurface.channel === "tg"` 抄送正确；用户侧回原 channel
- 全量：`pnpm typecheck && pnpm lint && pnpm test`

### 手工

1. QQ 连接 + 生效群 → 状态灯 QQ 正常
2. TG token + chat → TG 灯正常
3. 管理面 QQ → TG 用户「人工」→ QQ 管理面收到通知
4. 管理面 TG → QQ 用户「人工」→ TG 管理面收到通知
5. TG 管理面 `!resume <sessionKey>` → 用户侧恢复
6. 生效会话页：开关 TG、写/清策略，刷新仍在

### 成功标准

- 后台无「OneBot 客服」主叙事；配置按通道分栏
- 管理面可选 QQ 或 TG；通知与命令跟所选通道
- 生效会话跨通道可开关、策略 key 为 `channel:chatId`
- QQ 路径行为不变；检查命令全绿

## 9. 交付顺序

单功能分支、分层提交：

1. chore/docs：本 spec 入库
2. test：TG 管理面 gateway + handoff 覆盖
3. fix(admin)：groups 页 policyKey + 跨通道 toggle
4. feat(admin)：配置页 Tab + 管理面选择器
5. fix(admin)：侧栏 / 顶栏文案
6. 全量 typecheck / lint / test

## 10. 风险

| 风险 | 缓解 |
|------|------|
| 配置页改动面大 | 保持 PUT 契约；先测后 UI |
| group-name 偏 number | 验收负 id；失败回退 chatId 字符串 |
| 误把管理面设到业务群 | 文案说明；不强制与白名单互斥 |

## 11. 相关文档

- `docs/superpowers/specs/2026-07-17-channel-plugin-telegram-design.md`（Phase 3 UI 打磨 + 管理面一期限制 → 本 spec 升级）
- `lib/channels/enabled-chats.ts`、`lib/agent/gateway.ts`、`lib/agent/handoff-handler.ts`
- `app/admin/config/page.tsx`、`app/admin/groups/page.tsx`
