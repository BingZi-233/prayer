# 阶段 2 收尾：反思默认待审 + 删除一次性拆分逻辑

日期：2026-10-26
状态：已经两路独立审查（事实 / 范围）修订，待用户确认

## 背景

- 10-25 效果差调查确认的路线里，阶段 2 包含「反思默认待审」：当前反思落库即 `approved`，
  错误知识直接进检索。10-26 的存量拆分与三批矛盾清理都是在为这一点补课。
- 一次性拆分已全部完成（33 组 + 组23/25，legacy 标记已清空），拆分脚本与库代码不再需要。

## 一、反思默认待审

### 这是对 74491df 的有意反转

74491df（`fix(admin): 反思默认入库`）当初废除待审，原因是待审没人审、知识库停止增长。
这次反转的前提：错误知识进检索的代价（10-26 清理了几十条错误条目）高于停止增长的代价。
为避免重蹈覆辙，本方案必须带上积压可见性与提醒（见下文 5、6），不靠「有人会记得去看」。

### 现状（已核实）

- `ReflectionRepository.insertReflectionMeta`（reflection.ts:146）`INSERT OR REPLACE` 固定写
  `approved`，poller.ts:414 是唯一生产调用点；且它在 `insertKbEntry` 事务**之外**补写。
- `KB_SEARCH_SQL`（kb-sql.ts）只排除 `rejected/promoted`，无 meta 视为 approved。
  消费者：`searchKb`（poller 去重 poller.ts:404、反思上下文 poller.ts:264、kb-prefetch、
  ranking 路由）与 cs 插件子进程（plugins/cs/scripts/cs-mcp.ts:63,83，strip-only 加载，
  kb-sql.ts 必须保持零 import）。
- 迁移 `UPDATE ... SET status='approved' WHERE status='pending'`（schema.ts:335）属
  `applyV1Patches`，只在 user_version<2 时经 `migrateToVersion2` 执行，不会冲掉新 pending。
- `isAutoPromoteCandidate` 只收 approved；但手动升格三处（`promoteReflection`
  reflection.ts:226、`promoteEntry` promoter.ts:231、`applyPromote` apply-promote.ts:137）
  只拦 rejected/promoted，pending 可经 `PATCH /api/reflection {action:"promote"}` 直接升格。
- 管理端 entry-row.tsx:67 已有「待审」徽标；无按状态筛选；overview 的 `reflectionCount`
  按全部 human-reflection 计数。
- compaction 的 `replaceReflectionEntries` 写死 approved；生产代码已无调用（compact 已删），
  仅测试用它造数据。

### 方案

1. **原子落库**：新增 `insertReflectionEntry(doc, content, source, embedding, meta)`，
   chunk + vec + meta（status=`pending`）同一事务；poller 改用它，删掉事务外补写。
   消除「chunk 已可检索、meta 未写」的窗口（cs 子进程是另一进程，窗口内会检索到未审条目）。
2. **检索排除 pending**：`KB_SEARCH_SQL` 改为排除 `pending/rejected/promoted`。
3. **去重与反思上下文要看到 pending**：kb-sql.ts 导出 `kbSearchSql({ includePending })`，
   `KB_SEARCH_SQL` = `kbSearchSql({ includePending: false })`，保持单一事实源、零 import；
   `searchKb(query, k, { includePending })`，poller 去重（:404）与反思上下文（:264）传 true。
   不复制第二份 SQL（kb-sql.ts 头注释记录过插件内联副本漏过滤的事故）。
4. **手动升格拒绝 pending**：三处升格入口对 pending 返回「请先审核入库」，与 UI
   （只在 approved 显示升格按钮）一致；不做「升格即隐式 approve」，审核动作保持单一。
5. **积压可见**：
   - repo 新增 `countReflectionsByStatus()`；overview 显示「待审 N」，反思页头部同样显示；
   - `reflectionEntrySummaries` 加 `status` 过滤参数（SQL 层过滤，避免被 MAX_SUMMARY_ROWS
     截断看不到老待审），反思页加状态筛选。
6. **提醒**：poller 管理员通知改为「待审 1 条（当前积压 N 条）」；不另做定时提醒。
7. **审核后流程不变**：approve 走现有 `setReflectionStatus`（清账本、进检索、可自动升格）。
8. **不变的部分**：存量 approved 不动；compaction 已删，`replaceReflectionEntries` 写 approved
   不涉及新反思；system prompt 不变，prompt cache 无影响；评审/升格调用量随 pending 减少而下降。

### 取舍

- 无人审核时知识库停止增长——有意为之（宁缺毋错），靠第 5、6 点让积压可见。
- 不做「超时自动通过」「评审先跑 pending」：前者等于默认入库，后者让 LLM 评审代替人工审核，
  正是本次要纠正的问题。

### 回滚

回到默认入库：先在管理端批量处理积压（或一条 SQL：
`UPDATE reflection_meta SET status='approved' WHERE status='pending'`，按需改为 rejected），
再回滚代码并 `pnpm pm:restart`。不先处理就回滚，积压会在旧代码下直接进检索。

### 测试

- 新增：pending 不被 `searchKb` 默认命中；`includePending` 能命中；cs 插件 kb_search 不命中
  pending；kb-prefetch 不命中 pending；原子落库失败时不留孤儿 chunk；手动升格拒 pending；
  approve 后可检索并成为自动升格候选；`countReflectionsByStatus` 与 status 过滤。
- 需同步改的既有测试（依赖「默认 approved」）：tests/plugins/cs/cs-mcp.test.ts:35、
  tests/lib/core/db/repo.reflection.test.ts:29、tests/lib/reflection-route.test.ts:424、
  tests/lib/core/db/transactions.test.ts:22；以实际失败为准逐个处理。
- 注释同步：reflection.ts:69,146、knowledge.ts:168-171、app/api/reflection/route.ts:111。

## 二、删除一次性拆分逻辑

删除：
- `scripts/split-legacy-reflections.ts`、`lib/knowledge/reflection/legacy-split.ts`
- `tests/scripts/split-legacy-reflections.test.ts`、`tests/lib/knowledge/reflection/legacy-split.test.ts`
- `package.json` 的 `kb:split-legacy-reflections`
- 文档：docs/development.md:114-132 拆分脚本段、docs/database-operations.md:135-139 拆分步骤
  （历史评估文档 docs/project-completeness-assessment-2026-09-13.md 不动）

保留 / 迁移：
- `LEGACY_SPLIT_CUTOFF` 挪到 `source-context.ts`，source-context.test.ts 的 import 同步。
- `replaceReflectionEntries` 保留：生产无调用，但是通用的「快照内整体替换」并被 4 个测试文件
  用来造数据，删除收益小、改动面大。注释改为不再提拆分。
- `usage.ts:21` / `app/api/usage/route.ts` 的 `legacy-split` 站点保留展示历史（usage_daily 有行），
  注释改为「历史站点，仅展示」；`query-options.ts:38` 注释同步。
- `reflect_compactions` 表保留（retention.ts 仍引用），注明不再写入。无 schema 变更。
- `scripts/db-maintenance.ts:27` 注释去掉对拆分脚本的引用。
- 护栏测试：已核对无按路径引用被删文件的断言（layering.test.ts:311 只引用 kb-sql）。

## 部署与顺序

- 两个 PR：先 `refactor/remove-legacy-split`（纯删除，低风险），`feat/reflection-pending` 基于其
  rebase（两者都碰 source-context.ts 与 ReflectionRepository）。
- 每个 PR 本地 `pnpm check` 全绿；`NEXT_DIST_DIR=.next-verify pnpm build` 验证后
  `pnpm pm:restart`。PR 一上线后观察一轮反思：新条目为 pending、不被检索、管理端可见积压与可审。
