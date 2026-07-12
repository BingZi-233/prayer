# 问题排行榜（Question Ranking）设计

## 目标

统计用户在 QQ 群里高频问什么，把同义问题归并、按热度排名，并旁标知识库是否已覆盖，
帮助运营针对性地补充文档、提升覆盖率。需配套 Web 后台界面。

## 需求决策（已与用户确认）

| 决策项     | 选择                     | 说明                                                             |
| ---------- | ------------------------ | ---------------------------------------------------------------- |
| 统计口径   | 全部用户提问             | 取 `group_messages` 中的用户消息，非仅文档盲区                   |
| 同义归并   | LLM 主题提炼             | 仿反思循环，定期让 LLM 把问题归入主题并命名                      |
| 时间维度   | 可选时间窗（7/30/全部）  | 需逐条时间戳明细，运行时按窗口聚合                               |
| 页面功能   | 榜单 + KB 命中提示       | 每个主题旁标知识库是否已覆盖；只读，无标记动作                   |
| 首次回填   | 全量回填                 | 历史 `group_messages` 全部处理，靠分批多轮消化摊平成本          |

## 架构总览

新增一个后台轮询器 `topic-poller`（结构仿 `lib/agent/reflection-poller.ts`），在
`instrumentation.ts` 启动的单进程内周期运行：

```
group_messages (用户提问, cursor 增量)
        │  取 role≠客服、非空、cursor 之后
        ▼
   topic-poller  ──►  LLM 归主题（现有主题列表 + 本批问题）
        │                    每条 → {已有 topicId | 新主题标题 | noise 丢弃}
        ▼
question_topics / question_occurrences（落库，推进 cursor）
        ▲
GET /api/ranking?window=… ──►  /admin/ranking 页面（按窗口聚合 + KB 命中）
```

全程复用现有单 Node 进程、事件总线与 config-store 启动模式；不引入新服务。

## 数据模型

新增两张表（`lib/db/index.ts` migrate 里 `CREATE TABLE IF NOT EXISTS`）：

```sql
-- LLM 命名的问题主题目录，全局（跨群同义问题归为一条，契合补文档目标）
CREATE TABLE IF NOT EXISTS question_topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

-- 每条用户提问归属一个主题，保留原始到达时间戳 → 支持任意时间窗聚合
CREATE TABLE IF NOT EXISTS question_occurrences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL,
  group_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  text       TEXT NOT NULL,
  msg_ts     INTEGER NOT NULL,  -- 原始 group_messages.created_at
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_qo_topic ON question_occurrences(topic_id);
CREATE INDEX IF NOT EXISTS idx_qo_ts ON question_occurrences(msg_ts);
```

- **为什么要明细表**：可选时间窗必须逐条时间戳，运行时 `WHERE msg_ts >= ?` 聚合，
  不能只存主题聚合 count（否则无法切窗）。
- **cursor**：最后处理的 `group_messages.id`，存 `config` 表（key 如 `topic_poller_cursor`）。
- 复用现有 `group_messages`，不改其 schema。

## Poller：`lib/agent/topic-poller.ts`

结构对齐 `reflection-poller.ts`（`registerXxxPoller(deps) → 定时器 → unregister`）。

**Deps（可配置，均带默认值）**

- `repo`、`adminGroupId`、`enabledGroups`
- `scanMs`（默认 30 分，长周期压成本）
- `windowMax`（每轮最多处理多少条新提问，默认如 50）
- `maxPerScan` / 批大小护栏
- `queryFn`（LLM 调用，测试可注入 mock）、`now`

**每轮流程**

1. 读 cursor，从 `group_messages` 取 `id > cursor`、`sender_role NOT IN (owner, admin)`（即用户）、
   `text` 非空、属生效群的记录，最多 `windowMax` 条。
2. 空则直接返回（cursor 不动）。
3. 取现有 `question_topics` 的 `{id, title}` 列表。
4. 组 LLM 请求：系统提示说明任务；用户消息给「现有主题清单 + 本批带序号的问题」。
   LLM 输出结构化结果，每条问题 → 三选一：
   - `topicId`：归入已有主题
   - `newTitle`：需要新建的主题标题（同批多条可共用一个新标题）
   - `noise`：寒暄/闲聊/无意义 → 丢弃不入榜
5. 事务内：新建缺失主题、插 occurrences（带 `msg_ts`）、把 cursor 推进到本批最大 `group_messages.id`。
6. 复用 `usage-stats` 记账：新增 `UsageSite = "topic"`。

**全量回填**：首次 cursor=0，历史全部纳入；靠 `windowMax` 分批、多轮 scan 逐步消化，
避免单轮 token 尖峰。榜单随消化进度逐步完整。

## KB 命中提示

仿反思 dup 检查（`repo` 向量近邻 + L2 距离阈值）：

- 每个主题取一条代表问题（最高频或最近一条）→ `embed` → `kb_vec` 近邻，取最小 L2 距离。
- 距离 < 阈值 → 「已覆盖」；否则 → 「疑似盲区」。
- 在 `/api/ranking` 端按需计算（可对当前窗口 top-N 主题算，控制 embedding 次数）。
- 阈值复用/参考反思的 `dupMaxDistance`（约 0.45），可 config 化。

## API：`GET /api/ranking`

- Query：`window = 7d | 30d | all`（默认 7d）。
- 逻辑：按 `msg_ts` 落在窗口内聚合 `question_occurrences`，`GROUP BY topic_id` 计数，
  join `question_topics` 取标题，按 count 降序；对 top-N 主题算 KB 命中。
- 返回：
  ```ts
  {
    window: "7d",
    totals: { topics: number, questions: number, gaps: number },
    topics: Array<{
      id: number
      title: string
      count: number          // 窗口内提问数
      kbCovered: boolean
      kbDistance: number | null
      lastTs: number         // 窗口内最近提问时间
      samples: string[]      // 代表问题样例（若干条）
    }>
  }
  ```
- 只读；无 PATCH/POST（用户选「榜单+KB命中提示」，不含标记已处理）。

## 后台页面：`app/admin/ranking/page.tsx`

沿用现有后台设计语言（PageShell / PageHeader / MetricBadgeRow / SectionCard / Table /
DataState / usePolling），与反思、主动补位页一致。

- **PageHeader**：标题「问题排行榜」，描述「用户高频提问归并排名，旁标知识库覆盖，辅助补文档」。
- **时间窗切换**：7天 / 30天 / 全部（Tabs 或 Select），切换即换 `?window=` 拉数。
- **MetricBadgeRow**：主题数 · 窗口内提问总数 · 疑似盲区数。
- **主表**：排名 · 主题 · 窗口内提问数 · KB 命中 badge（已覆盖/疑似盲区）· 最近提问时间。
  行展开显示代表问题样例列表。
- **导航入口**：加入后台侧栏/导航（沿现有 admin layout 约定）。

## 测试

- `tests/lib/agent/topic-poller.test.ts`（`queryFn` 注入 mock，仿 `reflection-poller.test.ts`）：
  - cursor 从 0 起全量回填、逐轮推进
  - 归入已有主题
  - 新建主题
  - noise 丢弃不入榜
  - `windowMax` 分批上限
  - 空窗口 cursor 不动
- `tests/lib/db/repo.test.ts` 补新方法：写 topic / occurrence、按窗口聚合、cursor 读写。
- API 聚合口径（窗口边界）验证。

## 成本护栏

- 长 `scanMs`（默认 30 分）+ `windowMax` 限每轮批量。
- 只处理 cursor 增量，不重复扫。
- LLM 早丢 noise。
- 全量回填靠分批多轮摊平，无单轮尖峰。

## 不做（YAGNI）

- 不做主题「标记已处理/写文档」动作（本期只读）。
- 不做趋势折线图（先出排名，趋势后续可加）。
- 不做向量预聚类（用户明确选纯 LLM 归并）。
- 不改 `group_messages` schema、不动 agent 主链路。
