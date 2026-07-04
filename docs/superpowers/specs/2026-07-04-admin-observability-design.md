# 后台运行状态可观测性补全 — 设计

日期:2026-07-04
分支:main

## 背景与目标

管理后台现有 5 页(运行状态/配置/知识库/会话/运行日志),但大量运行时状态未暴露:

| 状态源 | 存在位置 | 当前是否可见 |
|---|---|---|
| 转人工队列 `handoffQueue` | `RuntimeStatus`(=openTickets 数) | ❌ getStatus 已算,status 页未显示 |
| 反思游标(每群处理进度) | config 表 `reflect_cursor:{gid}` | ❌ 无 |
| `human-reflection` 沉淀知识 | kb_chunks(doc=`human-reflection`) | ❌ kb 页只列文件系统 |
| human_mode 会话 + last_question | sessions 表 | ❌ listSessions 只返回 humanMode |
| group_messages 缓冲 | group_messages 表 | ❌ 无 |
| 工单 tickets | tickets 表 | ⚠️ 仅 openTickets,无专页 |
| 生效群运行态 | config enabledGroups | ❌ 无 |

目标:让后台页面完整反映运行状态。本轮交付 5 项(A–E)。

## 范围(已与用户确认)

- **A. status 页补齐** — 转人工/工单、生效群数、沉淀总数
- **B. 反思专页** `/admin/reflection`(新)
- **C. 会话页转人工态** — human_mode/挂起时长/last_question
- **D. 工单专页** `/admin/tickets`(新)
- **E. 生效群活动页** `/admin/groups`(新)

**页面分工**(用户拍板):B 与 E per-group 表重叠 → 两页分工,共享 repo 方法。E 侧重"群整体活跃 + 生效态总览",B 侧重"反思节奏 + 滞后 + 沉淀条目"。

## 架构

沿用现有模式:`"use client"` 页 + 3s `setInterval` 轮询 + `fetch('/api/...')` + `ok/fail` 信封 + shadcn Card/Badge/Table。运行时状态走 `getRuntime()`,DB 汇总走 `sharedDb(cfg.dbPath)` + `Repo`(与 `/api/kb/ingest`、`/api/kb/vec` 同款获取链)。

群名解析:`/api/onebot/groups` 已归一化 `{groupId, groupName}`;bot 断连时该接口 503,前端回退显示裸 `groupId`。

### 新增 Repo 方法(`lib/db/repo.ts`,各带 vitest 单测)

```ts
// C: sessions 扩展 —— 复用现有 listSessions,增补两字段(列已存在)
listSessions(): { key; sessionId; humanMode; humanSince: number|null; lastQuestion: string|null; updatedAt }[]

// D: 全量工单(含 closed),created_at 降序
listTickets(): { id; sessionKey; summary; status; createdAt }[]

// B/E: 每群反思游标 —— config WHERE key LIKE 'reflect_cursor:%'
reflectCursors(): { groupId: number; cursor: number }[]

// B/E: 每群消息统计 —— GROUP BY group_id
groupMessageStats(): { groupId: number; count: number; lastTs: number }[]

// B: 沉淀知识条目 —— kb_chunks doc='human-reflection',解析 source 'human-reflection:{gid}:{ts}'
reflectionEntries(): { id: number; content: string; groupId: number|null; ts: number|null }[]
```

`reflectionEntries` 的 groupId/ts 从 `source` 字段正则解析,格式非预期时回退 null(不抛错)。

### 新增/扩展 API 路由

| 路由 | 方法 | 返回 |
|---|---|---|
| `/api/sessions` | GET(扩展) | 增 `humanSince`、`lastQuestion` 字段 |
| `/api/overview` | GET(新) | `{ enabledGroups: number, reflectionCount: number }` — status 页汇总卡 |
| `/api/reflection` | GET(新) | `{ config: {scanMs,lookbackMs,settleMs,windowMax}, groups: [{groupId,cursor,lagMs,bufferCount,sedimentedCount}], entries: [{id,content,groupId,ts}] }` |
| `/api/tickets` | GET(新) | `listTickets()` 结果 |
| `/api/groups/activity` | GET(新) | `[{groupId, enabled, messageCount, lastTs, cursor, sedimentedCount}]`(仅生效群 + 有活动群) |

`lagMs = max(0, (now - settleMs) - cursor)`,反映该群反思落后已沉降上界多少。

status 页的"转人工/工单数"直接用现有 `/api/status` 的 `handoffQueue`,无需新请求;"生效群数""沉淀总数"取自 `/api/overview`。

### 页面

- **`app/admin/page.tsx`(改)**:stat 卡增 转人工/工单(handoffQueue)、生效群数、沉淀总数;并发拉 `/api/status` + `/api/overview`。
- **`app/admin/sessions/page.tsx`(改)**:列表项加 human_mode 徽标、挂起时长(now−humanSince)、last_question 摘要。
- **`app/admin/reflection/page.tsx`(新)**:节奏卡 + 每群反思进度表 + 沉淀知识列表。群名走 `/api/onebot/groups` 映射。
- **`app/admin/tickets/page.tsx`(新)**:open/closed 全量表,status 徽标,点会话 key 跳 `/admin/sessions`。
- **`app/admin/groups/page.tsx`(新)**:每生效群 群名/消息量/最近活动/反思进度/沉淀数/生效态。
- **`components/app-sidebar.tsx`(改)**:nav 增 反思、工单、生效群 三项(lucide 图标:`Brain`/`Ticket`/`Users`)。

## 错误处理

- 所有新路由用 try/catch + `fail()` 500,与 `/api/kb/vec`、`/api/kb/ingest` 一致。
- 前端轮询失败静默(现有惯例)。
- 群名接口 503(bot 断连)→ 前端回退裸 groupId,不阻断页面。

## 测试

- 每个新 repo 方法在 `tests/lib/db/repo.test.ts` 加单测(`:memory:` DB,跟随现有风格)。
- 重点:`reflectionEntries` 的 source 解析(正常/畸形回退)、`reflectCursors` 的 key 过滤、`groupMessageStats` 分组计数、`listTickets` 全量含 closed、`listSessions` 新字段。
- 不为纯展示页写组件测(项目现无前端组件测,不引入新框架)。
- 冒烟:dev server + 浏览器过一遍 5 页渲染。

## 非目标(YAGNI)

- 不做工单增删改(仅只读展示,创建走 Agent 链路)。
- 不做反思手动触发按钮(定时器已覆盖;如需另立需求)。
- 不做群消息全文浏览(只统计量,全文属隐私,反思页已够用)。
- 不引入前端组件测框架。
