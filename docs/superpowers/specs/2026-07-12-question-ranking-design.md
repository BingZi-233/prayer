# 问题排行榜（Question Ranking）设计

## 目标

统计用户在 QQ 群里高频问什么，把同义问题归并、按热度排名，并旁标知识库是否已覆盖，
帮助运营针对性地补充文档、提升覆盖率。需配套 Web 后台界面。

## 需求决策（已与用户确认）

| 决策项     | 选择                     | 说明                                                           |
| ---------- | ------------------------ | -------------------------------------------------------------- |
| 统计口径   | 全部用户提问             | 取 `group_messages` 中的用户消息（非仅文档盲区）              |
| 同义归并   | LLM 主题提炼             | 仿反思循环，定期让 LLM 把问题归入主题并命名                    |
| 时间维度   | 可选时间窗（7/30/全部）  | 需逐条时间戳明细，运行时按窗口聚合                             |
| 页面功能   | 榜单 + KB 命中提示       | 每个主题旁标知识库是否已覆盖；只读，无标记动作                 |
| 首次回填   | 全量回填                 | 上线时把**现存** `group_messages` 全部纳入（受留存限制，见下） |

## 关键约束：`group_messages` 只留约 2 小时（审查发现，方案核心）

`reflection-poller` 每轮调用 `repo.pruneGroupMessages(now - lookbackMs - settleMs)`
（默认 `lookbackMs=2h` + `settleMs=10min`），`group_messages` 物理上只保留 **约 2 小时**。

由此推出两条硬约束：

1. **时间窗聚合的数据源是持久的 `question_occurrences`，不是 `group_messages`。**
   7/30 天窗口靠 topic-poller 持续把提问搬进 occurrences 后逐步积累而成，
   `group_messages` 只是短暂的原料缓冲。上线首日窗口内数据从零起步、随运行变全。
2. **“全量回填”只能回填现存约 2 小时**，更早的历史已被反思 prune 删除、无法追溯。
   spec 不再声称能拿到全部历史；首次 cursor=0 实际只捞到留存窗口内的消息。
3. **必须防止“消息在 topic-poller 处理前被 prune 掉”导致静默丢数据。** 解决方案：
   把 `pruneGroupMessages` 的删除下界改为 **同时越过反思游标与 topic 游标** 的消息才删
   （见下「与反思 prune 的协调」）。这样 topic-poller 即使慢也不丢数据。

## 架构总览

新增后台轮询器 `topic-poller`（结构仿 `lib/agent/reflection-poller.ts`），在
`instrumentation.ts` 启动的单进程内周期运行：

```
group_messages（用户提问，每群独立时间游标增量，仅短暂缓冲 ~2h）
        │  复用 repo.groupMemberMessagesBetween(groupId, after, until)
        │  = (sender_role IS NULL OR NOT IN ('owner','admin'))，含 NULL role 普通成员
        ▼
   topic-poller  ──►  LLM 归主题（现有活跃主题列表 + 本批带序号问题）
        │                    每条 → {已有 topicId | 新主题标题 | noise 丢弃}
        ▼
question_occurrences（持久明细，永久积累）+ question_topics（主题目录）
        ▲                                              推进每群游标
GET /api/ranking?window=… ──►  /admin/ranking（按 msg_ts 窗口聚合 + KB 命中）
```

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

- **明细表是可选时间窗的前提**：运行时 `WHERE msg_ts >= ?` 聚合，不能只存主题聚合 count。
- **游标**：每群独立时间游标 `topic_cursor:<groupId>`，复用 `config` 表，
  照抄 `groupReflectCursor` / `setGroupReflectCursor`（`repo.ts:323`）。每群独立 →
  单群 LLM 失败只该群不推进、下轮重试，不牵连其他群。
- 复用现有 `group_messages`，不改其 schema。

## Poller：`lib/agent/topic-poller.ts`

结构对齐 `reflection-poller.ts`（`registerXxxPoller(deps) → setInterval + 防重入 → teardown`，
`runScan` 供测试直驱，`queryFn`/`now`/`embed` 注入 mock）。

**Deps（均带默认值）**：`repo`、`adminGroupId`、`enabledGroups`、
`scanMs`（默认 5 分，短周期确保远早于 2h prune 消化完）、
`settleMs`（默认 1 分，只处理已静置的消息，避免半句）、
`windowMax`（每群每轮最多处理条数，默认 50）、
`topicPromptMax`（喂 LLM 的现有主题上限，默认 40，见 B1）、
`queryFn`、`embed`、`now`。

**每轮流程（每个生效群独立）**

1. 防重入 `running` 守卫（仿 compactor `tick`）。
2. 读该群 `topic_cursor`，用 `repo.groupMemberMessagesBetween(groupId, cursor, now-settleMs)`
   取用户提问，`ORDER BY created_at ASC`，最多 `windowMax` 条。
3. 空窗口（无用户提问）：**仍把 `topic_cursor` 推进到 `now-settleMs`**（该区间已确认无待处理提问），
   然后本轮结束。这一步至关重要 —— 否则从未产生提问的沉默群 `topic_cursor` 恒为 0，
   会把下面「prune 下界取全群游标最小值」永久卡在 0、令反思 prune 失效、`group_messages` 无界增长。
   仿反思侧 `hasAdminMessageBetween` 无命中即推进游标的做法。
4. 取现有主题，按近窗口活跃度排序取 top `topicPromptMax` 条 `{id, title}` 入 prompt（B1）。
5. LLM 请求，**强制 `outputFormat: { type:"json_schema" }`**（仿 compactor，杜绝自由文本/截断），
   `thinking: disabled`、`canUseTool → deny`、`maxTurns: 2`。
   输入：现有主题清单 + 本批「带序号」问题。输出每项**必须回带输入序号 `i`**，
   加分类：`{ i, topicId?: number, newTitle?: string, noise?: true }`。
6. **校验（A3，仿 `validateCompactedDetailed`）**：
   - 结构优先取 `structuredOutput`，无则 `extractJsonArray` 文本兜底；解析失败 → 本轮跳过、emit error、游标不动。
   - 逐项按 `i` 对回原问题；`i` 越界/重复/缺失的项丢弃。
   - `topicId` 必须 ∈ 本轮传入的现有主题 id 集合，否则视为 `newTitle` 缺失 → 丢弃该项（不挂错/幻觉 id）。
   - 同批多条可共用一个 `newTitle`；`newTitle` 与现有标题 `textNearlySame` 时归并到现有主题（防近义重复）。
7. 事务内：新建缺失主题、插 occurrences（带 `msg_ts=原 created_at`）、
   把 `topic_cursor` 推进到**本批实际取到的最大 `created_at`**（不是 now，避免跳过未取满的尾部）。
8. 复用 `usage-stats`：新增 `UsageSite = "topic"`（`lib/usage-stats.ts:7` 联合类型补一项，
   `usage_daily.site` 为 TEXT 无需迁移）。
9. 旁路：任何异常 `bus.emit("error.occurred")`，不阻断主链路。

**全量回填**：首次每群 cursor=0，纳入现存缓冲（约 2h）；靠短 scanMs + 每群 windowMax
分批多轮消化。榜单随运行逐步完整（受 §关键约束，无法追溯更早历史）。

## 与反思 prune 的协调（防丢数据，A1）

改 `pruneGroupMessages`，删除下界取「反思与 topic 两侧都已处理过」的更小者：

- 现状：`DELETE FROM group_messages WHERE created_at < beforeTs`（beforeTs = 反思 now-2h10m）。
- 改为：`DELETE ... WHERE created_at < MIN(beforeTs, 全部生效群 topic_cursor 的最小值)`。
  即只删两个消费者都越过的消息。topic-poller 落后再多也不会删到它没处理的消息。
- 由 reflection-poller 调用处传入 `min(反思阈值, repo.minTopicCursor(enabledGroups))`，
  或在 repo 内部读取；具体接口在实现计划里定。**这是对反思循环的改动，已纳入方案。**
- **防 prune 卡死（复审副作用修复）**：沉默群空窗口时游标会被推进到 `now-settleMs`（见 Poller 步骤 3），
  故 `minTopicCursor` 不会被恒为 0 的群卡住；`minTopicCursor` 只统计生效群，且天然 ≤ 反思阈值不早的地板由
  `MIN(反思阈值, …)` 保证。回归测试须覆盖「一个从无提问的生效群不阻断 prune」。

## KB 命中提示

**复用** `isDuplicateOfHits` + `lexicalRelated`（`reflection-poller.ts:123`），不裸用 L2 阈值
（带文本护栏防 embedding 漂移误判）：

- 每主题取代表问题（窗口内最高频或最近一条）→ `embed` → `repo.searchKb(vec, k)` 近邻。
- `isDuplicateOfHits(代表问题, hits, dupMaxDistance=0.45)` → duplicate 即「已覆盖」，否则「疑似盲区」。
- 仅对当前窗口 top-N 主题算（控制 embedding 次数）。
- 注意：`searchKb` 已排除 `rejected/promoted` 的反思条目。已升格为正式文档的知识以 `doc` 形式
  仍在 `kb_chunks` 中，可被命中，故不会把已成文的主题误报为盲区（实现时以 `searchKb` 结果为准验证）。

## API：`GET /api/ranking`

- Query：`window = 7d | 30d | all`（默认 7d）。
- 逻辑：按 `msg_ts` 落窗口内聚合 `question_occurrences`，`GROUP BY topic_id` 计数，
  join `question_topics` 取标题，按 count 降序；对 top-N 主题算 KB 命中。
- **聚合覆盖全部历史 occurrence，不按当前 `enabledGroups` 二次过滤**（B4：入库时已过滤，
  历史归属属当时的群，展示保留），页面标注群维度可后置。
- 返回：
  ```ts
  {
    window: "7d",
    totals: { topics: number, questions: number, gaps: number },
    topics: Array<{
      id: number; title: string; count: number
      kbCovered: boolean; kbDistance: number | null
      lastTs: number; samples: string[]
    }>
  }
  ```
- 只读；无 PATCH/POST（用户选「榜单+KB命中提示」，不含标记已处理）。用 `@/lib/api` 的 `ok/fail` 包装。

## 后台页面：`app/admin/ranking/page.tsx`

沿用现有后台设计语言（PageShell / PageHeader / MetricBadgeRow / SectionCard / Table /
DataState / usePolling），与 `app/admin/reflection/page.tsx` 同款。

- **PageHeader**：标题「问题排行榜」，描述「用户高频提问归并排名，旁标知识库覆盖，辅助补文档」。
- **时间窗切换**：7天 / 30天 / 全部，切换即换 `?window=` 拉数。
- **MetricBadgeRow**：主题数 · 窗口内提问总数 · 疑似盲区数。
- **主表**：排名 · 主题 · 窗口内提问数 · KB 命中 badge（已覆盖/疑似盲区）· 最近提问时间；
  行展开显示代表问题样例。
- **导航入口**：加入后台侧栏/导航（沿现有 admin layout 约定）。

## 测试

- `tests/lib/agent/topic-poller.test.ts`（`queryFn`/`embed` 注入 mock，仿 `reflection-poller.test.ts`）：
  - 首次 cursor=0 回填、每群游标逐轮推进到实际最大 ts、空窗口游标不动
  - 归入已有主题 / 新建主题 / 同批共用 newTitle / newTitle 与现有近义归并
  - **noise 丢弃不入榜**
  - **NULL role 普通成员消息被纳入**（A2 回归，经 `groupMemberMessagesBetween`）
  - **LLM 畸形输出/缺 i/幻觉 topicId 的兜底**（A3：跳过或丢该项，不挂错 topic、游标策略正确）
  - `windowMax` 分批上限
- `tests/lib/db/repo.test.ts` 补：写 topic/occurrence、按窗口聚合计数、`topic_cursor` 读写、
  **`pruneGroupMessages` 改动后不删未越过 topic 游标的消息**（A1 回归）、`minTopicCursor`。
- API `window` 边界（`msg_ts` 开闭区间）与 KB 命中计算的验证。

## 成本护栏

- 短 `scanMs`（5 分）确保消化早于 prune，但每群 `windowMax` 限每轮批量。
- 只处理每群游标增量，不重复扫。
- LLM 强制 JSON Schema + 早丢 noise；主题清单入 prompt 设 `topicPromptMax` 上限（B1）。

## 不做（YAGNI）/ 已知债

- 不做主题「标记已处理/写文档」动作（本期只读）。
- 不做趋势折线图（先出排名，趋势后续可加）。
- 不做向量预聚类（用户明确选纯 LLM 归并）。
- **主题合并/去重的存量整理**：本期靠入库时 `textNearlySame` 归并 + prompt 带现有主题缓解，
  长期主题目录可能仍有近义膨胀；预留后置的主题 compactor（记为已知债，B1）。
- 不改 `group_messages` schema；对反思循环的唯一改动是 `pruneGroupMessages` 下界协调（§防丢数据）。
