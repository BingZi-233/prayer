# 数据访问层

## 职责与依赖

`Repo` 是现有调用方的兼容入口，只装配领域仓储和转发方法，不包含 SQL。
旧代码可继续调用 `repo.getSessionId(key)`，新代码可以使用 `repo.sessions` 等
领域入口，并用 `Pick<领域仓储, 方法名>` 声明真正需要的能力。

| 入口              | 源文件                       | 职责                           |
| ----------------- | ---------------------------- | ------------------------------ |
| `repo.sessions`   | `repositories/sessions.ts`   | 会话状态、续接指针、空闲期限   |
| `repo.messages`   | `repositories/messages.ts`   | 消息缓冲、时间窗查询、入站去重 |
| `repo.knowledge`  | `repositories/knowledge.ts`  | 分块、向量、检索与物理删除     |
| `repo.reflection` | `repositories/reflection.ts` | 反思来源、状态、整理记录与游标 |
| `repo.proactive`  | `repositories/proactive.ts`  | 主动回复记录、质量标记与游标   |
| `repo.topics`     | `repositories/topics.ts`     | 主题、问题归属、排行与游标     |
| `repo.statistics` | `repositories/statistics.ts` | 处理结果、模型用量与工具统计   |
| `repo.tickets`    | `repositories/tickets.ts`    | 工单创建、关闭与查询           |
| `repo.config`     | `repositories/config.ts`     | 配置键值读写                   |

以上路径相对于 `lib/db/`。各仓储只依赖 `SqliteContext` 及必要的其他领域能力，
不反向依赖 `Repo`、Next.js 路由或 Agent。反思模块需要知识分块写入能力，
反思、主题和主动回复模块通过配置仓储保存既有游标键。

## 连接与事务

一个 `Repo` 创建一个 `SqliteContext`，所有领域共享同一 SQLite 连接和预编译
语句缓存。仓储不打开、关闭连接，也不执行数据库迁移；连接仍由原有启动入口、
`sharedDb` 或测试管理。不同连接之间不能共享预编译语句，也不能组成同一事务。

需要一起成功的操作使用外层事务：

```ts
repo.transaction(() => {
  repo.sessions.setHumanMode(sessionKey, true)
  repo.tickets.createTicket(sessionKey, summary)
})
```

规则：

- 回调必须同步。模型调用、embedding、文件 IO 等异步准备在进入事务前完成。
  驱动会拒绝返回 Promise 的回调，但不能取消已经启动的异步操作。
- 抛错会回滚。领域内部事务嵌套在外层事务时使用 SQLite 保存点，内层成功并不
  意味着独立提交；之后外层失败时，内层写入也会撤销。
- 捕获内层异常后，外层仍可继续。如果业务要求整批失败，必须让异常继续抛出。
- SQLite 事务只覆盖数据库。反思升格流程中的文件写入仍需独立的补偿策略，
  不能因为数据库事务成功就宣称文件与数据库具备共同事务。

已有原子操作包括：分块与向量写入、分块三表删除、文档与向量删除、反思整理
替换及整理记录、批量工具统计、全量续接指针与会话纪元重置。跨领域业务批次
继续由调用方确定外层事务，例如知识库重新摄入、升格和主题归类。

## 数据类型与转换

- `rows.ts` 定义复用的 SQLite 查询投影，保留 `created_at` 等数据库列名。
- `models.ts` 定义业务返回类型，例如 `ReflectionEntry`、`SessionSummary` 和
  `Ticket`，避免在多个方法中重复声明相同对象。
- `row-mappers.ts` 与 `reflection-mappers.ts` 维护重复使用的列名和状态转换。
  原有 `parseReflectionSource` 仍由 `repo.ts` 导出，兼容旧导入路径。
- 查询使用 `sql.prepare<Row>(sql)` 标明投影；泛型只约束 TypeScript 类型，
  不代表运行时已验证数据。列名和字段类型必须与 SQL 同步维护。
- `.get()` 默认允许无记录；仅对 SQL 保证返回一行的查询使用非空断言，
  例如不分组的 `COUNT(*)` 和成功执行的 `INSERT ... RETURNING`。

历史约定仍保留：数据库层的通道使用字符串；chatId 不转成数字；未知反思状态
按 `approved` 展示；整理摘要不携带整批正文；不存在的记录保留原有 null 或
undefined 返回方式。不要在纯结构重构中顺便改变这些兼容行为。

## 修改与验证

新增查询先确定所属领域，再定义必要的行类型和业务返回类型。需要为旧调用方
提供平面入口时，在 `Repo` 添加简单转发，参数使用 `Parameters<领域方法>`，
返回类型直接推导，避免再维护一份签名或 SQL。

测试使用内存数据库，并由测试持有及关闭连接。故障注入可通过临时 SQLite
触发器或错误向量维度制造真实写入失败，不应仅替换仓储方法来模拟回滚。
`tests/lib/db/transactions.test.ts` 覆盖跨领域事务、嵌套保存点以及各批量操作
的中途失败，比较原始行和向量，确认没有残留部分更新。

运行 `pnpm check` 和隔离生产构建。涉及 SQL 或结构升级时，还要执行现有数据库
迁移测试；当前拆分没有修改 `lib/db/index.ts` 的表结构和版本升级流程。
