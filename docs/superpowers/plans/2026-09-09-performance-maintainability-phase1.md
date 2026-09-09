# 性能与可维护性第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持现有客服语义和 HTTP 兼容字段的前提下，降低管理后台读路径开销并统一 API 数据装配。

**Architecture:** 以应用级数据上下文复用配置仓储和业务仓储；以一个结构迁移补齐热点索引并为主题样例提供批量查询；排行榜使用固定并发度完成知识库评估；会话页面复用统一轮询保护。各任务通过现有 `Repo`、`AppConfig` 和响应 DTO 边界协作，不引入新的基础设施。

**Tech Stack:** Next.js 16.3 App Router、React 19、TypeScript 5.9、better-sqlite3、SQLite、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-09-performance-maintainability-phase1-design.md`

## Global Constraints

- 保持客服业务语义、现有 API 响应字段和配置存储路径兼容。
- 配置仓储使用 `process.env.DB_PATH`（缺省 `./data/agent.db`）；业务仓储使用已解析 `cfg.dbPath`。
- SQLite 迁移版本必须连续、可重复执行；迁移内容和 `user_version` 必须在同一事务中提交。
- 排行榜窗口口径、知识库判定阈值、样例排序和空样例回退行为不变。
- 客户端轮询不得在同一 URL 上产生重叠请求；隐藏标签页不发请求，失败使用既有退避语义。
- 测试放在 `tests/`，代码注释使用简体中文；不得提交 `data/`、`.env`、日志或构建产物。
- 每个任务先写一个会失败的行为测试，再写最小实现；任务完成前运行覆盖该任务的测试。

---

### Task 1: 统一应用数据上下文与跨请求 Repo 复用

**Files:**
- Create: `lib/app-context.ts`
- Modify: `lib/db/shared.ts`
- Modify: `app/api/**/*.ts`（所有使用 `sharedDb` + `Repo` + `getConfig` 装配的路由）
- Modify: `tests/lib/app-context.test.ts`
- Modify: `tests/lib/config/route.test.ts`
- Modify: `tests/lib/plugins/route.test.ts`

**Interfaces:**
- Produces `AppContext`：`{ configRepo: Repo; cfg: AppConfig; repo: Repo }`。
- Produces `getAppContext(env?: Record<string, string | undefined>): AppContext`。
- Produces `sharedRepo(path: string): Repo`；同一路径在进程内返回同一 `Repo` 实例。

- [ ] **Step 1: 写上下文行为测试**

在 `tests/lib/app-context.test.ts` 使用临时 SQLite 路径和显式 env，断言：

```ts
const first = getAppContext({ DB_PATH: dbPath })
const second = getAppContext({ DB_PATH: dbPath })
expect(first.cfg.dbPath).toBe(dbPath)
expect(first.configRepo).toBe(second.configRepo)
expect(first.repo).toBe(second.repo)
```

同时写入一个不同 `dbPath` 的配置，断言 `configRepo` 与 `repo` 分别指向正确数据库。

- [ ] **Step 2: 运行测试确认先失败**

运行：`pnpm vitest run tests/lib/app-context.test.ts`

预期：因 `lib/app-context.ts` 和 `sharedRepo` 尚不存在而失败。

- [ ] **Step 3: 实现共享 Repo 和上下文**

在 `lib/db/shared.ts` 增加进程级 `Map<string, Repo>`，复用现有 `sharedDb(path)`；在 `lib/app-context.ts` 实现：

```ts
export interface AppContext {
  configRepo: Repo
  cfg: AppConfig
  repo: Repo
}

export function getAppContext(
  env: Record<string, string | undefined> = process.env
): AppContext {
  const configRepo = sharedRepo(env.DB_PATH ?? "./data/agent.db")
  const cfg = getConfig(configRepo, env)
  return { configRepo, cfg, repo: sharedRepo(cfg.dbPath) }
}
```

不得把配置写入 `cfg.dbPath` 以外的错误仓储；保留 `getConfig` 的 env 参数和迁移行为。

- [ ] **Step 4: 迁移 API 路由调用方**

将重复装配改为一次上下文读取。例如业务 GET 使用：

```ts
const { cfg, repo } = getAppContext()
```

配置 GET/PUT 使用 `configRepo` 写入，业务读写使用 `repo`；同一处理函数不得分别调用 `getAppContext()` 两次。保留各路由现有错误状态码和 payload。

- [ ] **Step 5: 更新边界测试并运行**

更新 route mock 以提供 `sharedRepo` 或 mock `lib/app-context`，然后运行：

```bash
pnpm vitest run tests/lib/app-context.test.ts tests/lib/config/route.test.ts tests/lib/plugins/route.test.ts
```

预期：所有测试通过，配置密钥掩码和插件重配置行为不变。

- [ ] **Step 6: 提交**

```bash
git add lib/app-context.ts lib/db/shared.ts app/api tests/lib/app-context.test.ts tests/lib/config/route.test.ts tests/lib/plugins/route.test.ts
git commit -m "refactor(api): unify database application context"
```

### Task 2: 热点索引与主题样例批量查询

**Files:**
- Modify: `lib/db/migrations/schema.ts`
- Modify: `lib/db/migrations/registry.ts`
- Modify: `lib/db/migrations/index.ts`
- Modify: `lib/db/repositories/topics.ts`
- Modify: `lib/db/repo.ts`
- Create or modify: `tests/lib/db/topics.test.ts`
- Modify: `tests/lib/db/migrations.test.ts`

**Interfaces:**
- Produces schema version `8` with four idempotent read indexes.
- Produces `TopicsRepository.topicSamplesBatch(topicIds: number[], limit: number, sinceTs?: number): Map<number, string[]>` and the matching `Repo.topicSamplesBatch` forwarding method.

- [ ] **Step 1: 写索引和批量查询测试**

测试应插入至少两个主题和重复样例，断言批量结果按每个主题最近 `msg_ts` 去重、最多返回 `limit` 条，并保持主题 id 分组。迁移测试断言版本数组变为 `[2, 3, 4, 5, 6, 7, 8]`，且以下索引存在：

```text
idx_qt_updated_at
idx_sessions_human_since
idx_tickets_status_created
idx_qo_topic_msg_ts
```

- [ ] **Step 2: 运行测试确认先失败**

运行：`pnpm vitest run tests/lib/db/topics.test.ts tests/lib/db/migrations.test.ts`

预期：版本和批量方法断言失败。

- [ ] **Step 3: 添加 v8 迁移**

新增 `ensureHotReadIndexes`，执行以下幂等 SQL：

```sql
CREATE INDEX IF NOT EXISTS idx_qt_updated_at ON question_topics(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_human_since ON sessions(human_mode, human_since);
CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qo_topic_msg_ts ON question_occurrences(topic_id, msg_ts DESC);
```

将迁移追加到 registry 末尾，并从 migrations index 导出必要的结构函数。

- [ ] **Step 4: 实现批量样例查询**

使用 SQLite 窗口函数一次查询所有传入主题；`topicIds` 为空时直接返回空 Map，`limit <= 0` 时每个主题返回空数组。查询必须过滤 `msg_ts >= sinceTs`、按 `text` 去重、按最近时间降序，并在 JS 中按主题 id 组装 Map。

- [ ] **Step 5: 验证查询计划和完整 DB 测试**

运行：

```bash
pnpm vitest run tests/lib/db/topics.test.ts tests/lib/db/migrations.test.ts tests/lib/db/repo.test.ts
```

另用只读 SQLite 连接执行目标查询的 `EXPLAIN QUERY PLAN`，确认主题排序、人工会话筛选和开放工单排序使用新增索引。

- [ ] **Step 6: 提交**

```bash
git add lib/db/migrations lib/db/repositories/topics.ts lib/db/repo.ts tests/lib/db/topics.test.ts tests/lib/db/migrations.test.ts
git commit -m "perf(db): add hot read indexes and batch topic samples"
```

### Task 3: 降低排行榜 SQL 与 embedding 成本

**Files:**
- Create: `lib/concurrency.ts`
- Modify: `app/api/ranking/route.ts`
- Create: `tests/lib/concurrency.test.ts`
- Create: `tests/lib/ranking-route.test.ts`

**Interfaces:**
- Produces `mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`，结果顺序与输入一致；`limit <= 0` 抛出 `RangeError`。
- `/api/ranking` 保持 `window`、`totals`、`topics`、`kbCovered`、`kbDistance` 和 `samples` 字段兼容。

- [ ] **Step 1: 写并发辅助和路由边界测试**

并发测试记录最大同时执行数，断言不超过 4 且结果顺序稳定；路由测试使用真实批量样例接口的契约替身，断言样例查询只调用一次、前 30 个主题才调用 embedding、空样例回退到标题。

- [ ] **Step 2: 运行测试确认先失败**

运行：`pnpm vitest run tests/lib/concurrency.test.ts tests/lib/ranking-route.test.ts`

预期：并发函数不存在，路由的批量调用断言失败。

- [ ] **Step 3: 实现有界并发**

实现固定 worker 数为 4 的并发映射；任何 worker 抛错都让整体 Promise 拒绝，不吞掉 embedding 错误。不要引入第三方并发依赖。

- [ ] **Step 4: 改造排行榜**

先从 `rankingByWindow` 得到现有排序，再一次调用 `topicSamplesBatch`；将前 `TOP_KB` 个主题的 probe 交给 `mapWithConcurrency`，其余主题保持 `kbCovered = null`。保持 `gaps`、`questions` 和距离判定逻辑不变。

- [ ] **Step 5: 运行路由与全量测试**

运行：

```bash
pnpm vitest run tests/lib/concurrency.test.ts tests/lib/ranking-route.test.ts tests/lib/db/topics.test.ts
```

检查失败响应仍为 500，空数据仍返回 `topics: []`，并记录改造前后的查询调用次数。

- [ ] **Step 6: 提交**

```bash
git add lib/concurrency.ts app/api/ranking/route.ts tests/lib/concurrency.test.ts tests/lib/ranking-route.test.ts
git commit -m "perf(ranking): batch samples and bound embedding concurrency"
```

### Task 4: 会话轮询与 LiveProvider 重渲染控制

**Files:**
- Modify: `app/admin/sessions/page.tsx`
- Modify: `components/live-provider.tsx`
- Create: `components/admin/session-polling.ts`
- Create: `tests/lib/session-polling.test.ts`

**Interfaces:**
- Produces `createSessionPoller(load: () => Promise<void>, options?: { intervalMs?: number; isHidden?: () => boolean; setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>; clearTimer?: (timer: ReturnType<typeof setTimeout>) => void }): { start(): void; poll(): Promise<void>; stop(): void }` 的纯逻辑封装，同一时刻最多一个列表请求。
- 页面深链、筛选、当前会话 transcript 代数保护和现有 `/api/sessions` payload 不变。

- [ ] **Step 1: 写慢请求行为测试**

使用可控 Promise 的 `load` 替身，启动两次 `poll()`，断言第二次复用第一在途 Promise；调用 `stop()` 后延迟响应不得安排下一次计时器。测试通过注入 `setTimer`/`clearTimer` 记录排程次数，不依赖真实睡眠。

- [ ] **Step 2: 运行测试确认先失败**

运行：`pnpm vitest run tests/lib/session-polling.test.ts`

预期：封装不存在而失败。

- [ ] **Step 3: 实现纯轮询协调器**

将 in-flight 闸门、取消标志和递归 `setTimeout` 放在独立模块；列表请求结束后才计算下一次 tick，隐藏页面跳过请求，保留现有失败静默策略。

- [ ] **Step 4: 接入会话页面**

移除 `setInterval(tick, POLL_MS)`，用协调器驱动已有列表/当前 transcript 更新；保留 `transcriptGenRef` 和 `activeKeyRef` 的过期响应检查。

- [ ] **Step 5: 稳定 LiveProvider context value**

使用 `useMemo` 仅在 `status`、`overview`、`lastUpdated` 或 `refresh` 变化时重建 context value；不得改变刷新时序和错误静默行为。

- [ ] **Step 6: 运行客户端逻辑测试与质量门禁**

运行：

```bash
pnpm vitest run tests/lib/session-polling.test.ts
pnpm check
NEXT_DIST_DIR=.next-verify pnpm build
```

- [ ] **Step 7: 提交**

```bash
git add app/admin/sessions/page.tsx components/live-provider.tsx components/admin/session-polling.ts tests/lib/session-polling.test.ts
git commit -m "perf(admin): prevent overlapping session polls"
```

### 最终验收

- [ ] 逐项回读本计划和设计文档，确认非目标范围没有被偷偷扩大
- [ ] 运行 `git status --short`，确认没有 `data/`、`.env`、日志或构建产物
- [ ] 运行 `git diff --check`
- [ ] 运行 `pnpm check`
- [ ] 运行 `NEXT_DIST_DIR=.next-verify pnpm build`
- [ ] 运行 `pnpm db:check`
- [ ] 保存 `EXPLAIN QUERY PLAN`、排行榜查询次数和浏览器 Network/Profiler 对比记录
