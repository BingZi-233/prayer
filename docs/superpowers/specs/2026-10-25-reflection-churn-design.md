# 反思流水线止转设计（阶段 1）

日期：2026-10-25　分支：`fix/reflection-churn`　修订：第 2 版（吸收事实、范围、方案三路审查）

## 背景与证据

统计窗口 2026-10-18 ~ 10-25（8 天，`usage_daily`，金额为 CLI 按 Opus 单价计算的
`cost_usd`，不是 MiniMax 实际账单，但量级可比）：总计 $929；`promote` $430（4898 次）、
`compact` $302（867 次）、`promote-compose` $80、`reflect` $18；真正回答用户的 `agent` 仅 $77。

已复核的根因：

1. **整理（compact）把小反思滚成巨型 FAQ 再句中硬切。** 整理提示要求「激进合并、禁止
   缩短」（`compactor.ts:106-110`），每轮把全部条目还原为逻辑 FAQ 重新交给 LLM
   （`restoreLogicalEntries`）。现状：35 条逻辑 FAQ 共 13.9 万字，平均约 4k 字、最大约
   2.1 万字，被 `splitCompactedFaq` 每 500 字硬切成 336 块（`compact-chunks.ts:30-32`），
   多数块从句子中间开始。默认 1h 周期 + 每小时扫描、每轮约 8 分钟，实际约每 2 小时一轮、
   每轮 7 批 LLM 调用；相邻两轮 36/35 条输出中 31 条逐字相同，没有「无变化跳过」。
2. **升格（promote）每小时全量重审。** 只有整轮零失败才 `setPromoteAt`
   （`promoter.ts:559`），`reflect_promote_at` 自 2026-10-19 12:37 起未再推进，24h/3h 周期
   失效。没有评审/失败记录，被拒或失败的条目下轮照审；整理每轮给全部块换新 id。每个候选
   都带整条巨型 FAQ 作为来源答案（约每批 2 条，335 块约 170 次评审调用）。
3. **「单元超长 >500」结构性必然。** 成文输入就是 500 字碎片，模板再加标题与来源行
   （`renderUnit`），提示还要求「禁止摘要式缩短」（`promote-compose.ts:258`），互相矛盾。
4. 这些碎片约占检索库 44%（336/755），每 2 小时整体删除重写；矛盾片段（如 cc-sale /
   claude-sale 规则被切成两半，chunk 332730/332731）直接进入主客服上下文。
5. 当前库里已没有未整理的 approved 反思：336 个 approved 条目全是整理块，原始问答在整理
   替换时已删除（`replaceReflectionEntries` 连带删 meta）。`reflect` 写入的原始反思每条
   一段 FAQ，入库前已对照全库做近似去重（`poller.ts:402-406`）。

止血已执行（2026-10-25 19:47，经 `PUT /api/config`）：`reflectCompactMs=0`、
`reflectPromoteMs=0`（定时循环停用；停用前已启动的那轮会自然跑完），`proactiveSilenceMs=180000`。

## 目标

- `promote` + `promote-compose` 合计 ≤ $3/天（CLI 计价口径）。`reflect`（约 $2.5~4/天）不在本阶段范围。
- 每条反思的评审结论只产生一次；可重现的失败最多 3 次，基础设施故障不计入。
- 检索库里不再有句中硬切的反思碎片。

## 非目标（后续阶段）

- 反思默认待审 / 检索降权、修正 `billing.md` 与 `groups.md` 矛盾、处置 `legacy` 条目（阶段 2）。
- 会话 resume、主动插话、预检索阈值（阶段 3~5）。
- `splitCompactedFaq` 仍是 ingest、kb-freshness、kb:audit、apply-promote 的共用分块器，保留不改。

## 设计

### A. 删除整理环节

整理的主要职责（去重）已由写入前去重覆盖；它额外承担的「同主题换说法合并」和「剔除与
基础文档矛盾的内容」不再自动进行，交给阶段 2 的待审机制。整体删除：

- 删除：`lib/knowledge/reflection/compactor.ts`、`tests/lib/knowledge/reflection/compactor.test.ts`、
  `app/api/reflection/compact/route.ts`、`app/api/reflection/compactions/[id]/route.ts`、
  `components/admin/reflection/compaction-row.tsx`。
- 注册：`lib/conversation/assemble.ts` 去掉整理循环注册与对应 deps；`lib/runtime.ts` 去掉透传。
- 配置：`reflectCompactMs`、`reflectCompactMinEntries` 从 `schema.ts`、`env.ts`、`.env.example`、
  `reflect-settings.tsx` 移除。机制：加载路径 `normalizeStoredConfig` 只按 schema 的键取值，
  旧键被忽略；下次保存时 `setConfig` 的 `parse` 剥离、不再写回。测试按「加载忽略、保存清除」写。
  config 表里的 `reflect_compact_at` 行留着不动。
- 仓储与模型类型：删 `compactAt`/`setCompactAt`、`recentCompactions`、`recentCompactionSummaries`、
  `compactionDetail` 及 `Compaction*` 的 row/model/mapper；`replaceReflectionEntries` 保留（D 复用）。
  `reflect_compactions` 表与 retention 规则保留，改作 D 的审计记录。
- 管理端：反思页去掉「立即整理」按钮与对话框、整理周期/门槛统计、「整理记录」区块；
  `use-reflection-actions.ts`、`types.ts` 同步；`GET /api/reflection` 不再返回
  `compactions`/`compactMs`/`compactMinEntries`。条目行的「已整理」徽标改为按 `legacy` 状态显示。
- 用量：`UsageSite` 的 `"compact"` 保留为历史站点（历史数据仍要显示中文名）。
- 文档：`README.md`、`docs/development.md`（反思整理与升格一节）、`docs/data-access.md`、
  `docs/database-operations.md`、`UX-CONTRACT.md` 同步；架构 SVG 里的「整理」字样一并更新。
- 护栏：`tests/architecture/layering.test.ts` 的已删除路径清单加入 `compactor.ts`；
  `tests/ui/admin-knowledge-contracts.test.ts` 等测试里引用 `/api/reflection/compact` 的字面量同步清理。

完整受影响文件清单见附录。

### B. 升格评审账本

迁移 v11（沿用 v9 的加列写法：`tableColumns` 判断后 `ALTER TABLE`，`up` 与 `repair` 同一函数，
可重复执行）给 `reflection_meta` 加三列：

| 列 | 取值 |
|---|---|
| `review_state TEXT` | `NULL` 未评审；`accepted` 评审通过待成文；`declined` 评审判不升格；`failed` 成文失败达上限；`legacy` 存量整理产物，不参与自动升格 |
| `review_attempts INTEGER NOT NULL DEFAULT 0` | 可重现失败次数 |
| `review_note TEXT` | 最近一次失败的程序侧原因（如 `单元超长(612 > 500)`），不存 LLM 自由文本 |

v11 同时把现存全部整理块（`kb_chunks.source` 解析出 `chatId='0'`）标为 `legacy`。这让部署
那一刻起旧块就退出自动升格与「立即升格」批量入口，不依赖 D 何时执行。现存每个反思块都有 meta
行（实测缺失为 0），记账用 `UPDATE`，没有行时不补行（避免给不存在的 chunk 造孤儿 meta）。

每轮自动升格（定时与「立即升格」按钮共用 `runPromote`）：

1. **成文**：先取 `accepted` 条目，最多 `maxPerRun`（默认 5）条，逐条成文落盘。
2. **评审**：再取 `review_state IS NULL AND status='approved'` 的条目。来源超过
   `MAX_REVIEW_CHARS` 的条目在分批**之前**直接记为 `failed`（note=超预算），不连累同批。
   每轮最多 `MAX_REVIEW_BATCHES_PER_RUN = 3` 批（每批 ≤20 条）。结论：`promote=false` →
   `declined`；`promote=true` → `accepted`（本轮成文名额有剩余时立即成文，否则留待下轮，不再重审）；
   模型漏返回的 id 保持 `NULL`。
3. **失败记账**，只计可重现失败：
   - 计入 `review_attempts+1`：`composePromotion` 返回的校验类 `ok:false`（解析不出、字段为空、
     路径/slug 非法、单元超长、来源核验不通过）。达到 `MAX_PROMOTE_ATTEMPTS = 3` → `failed`。
   - 不计次数、只写 note：超时、中止、网络与 I/O 抛错，embed 超时，评审批次解析失败，
     `INTERNAL_FAULT_REASONS`（目标文档不存在、路径非法等系统故障；该集合从
     `app/api/reflection/route.ts` 移到 `lib/knowledge/reflection/` 供两边共用），
     「条目不存在」「已驳回」「来源在升格期间已变化」（并发，不是条目问题）。
4. **游标**：一轮正常结束都 `setPromoteAt(now)`，`app/api/reflection/promote/route.ts` 同步改为
   同一规则；只有整轮抛出意外异常才不推进。

手动单条升格（反思页 PATCH，走 `promoteEntry`）：对任何 `review_state`（含 `legacy`、`declined`、
`failed`）都可执行，失败只写 note、不加次数；成功时 `writeKbTransaction` 同事务删除 chunk 与
meta，账本随之消失。管理员把条目「恢复入库」（`setReflectionStatus('approved')`）时清空
`review_state` 与 `review_attempts`，即「重新评审」；`legacy` 条目除外（保持 `legacy`）。

`source-context.ts` 本阶段保留：D 执行前，手动 PATCH 旧块仍需要它的兄弟块完整性校验。库里不再
有整理块之后，在阶段 2 删除。

管理端条目行显示账本状态（「待成文」「评审未通过」「升格失败 N 次：原因」「存量待处置」）。

### C. 成文预算

- `COMPOSE_OUTPUT_SCHEMA` 给 `product`/`protocol`/`task`/`volatility` 加固定 `maxLength`
  （20/24/40/30）。schema 是常量，不影响 prompt cache 前缀。
- 正文预算写进 **user prompt**（`COMPOSE_SYSTEM` 保持恒定）：
  `body 上限 = 500 − 模板固定字数 − 上述四个字段 maxLength 之和 − 来源行最坏长度`，
  最坏长度取「`QQ 群客服会话反思 #id`」与来源原文中最长可信 URL 中较长者，均由程序按本条
  chunkId 与当天日期实算，不估。
- 系统提示里「禁止摘要式缩短」改为「在给定字数内保留关键步骤、数字、错误串与边界条件」。
- `body` 内空行由程序折叠为单个换行再渲染（消除「单元含空行」）。
- 渲染后仍超长：同一轮内重试一次，user prompt 写明实际超出字数；仍失败才按 B 记一次失败。
  不做程序截断（截断可能删掉限制条件）。

### D. 一次性拆分存量整理块

新增 `scripts/split-legacy-reflections.ts`（`pnpm kb:split-legacy-reflections`），逻辑放在
`lib/knowledge/reflection/legacy-split.ts`（阶段 2 处置完 `legacy` 后连同脚本删除），测试在
`tests/lib/knowledge/reflection/legacy-split.test.ts`。

运行前提（脚本自检，任一不满足即退出）：
- 采用 `scripts/prompt-replay.ts` 的 resolve 钩子 + 动态 `import` 写法，才能在
  `node --experimental-transform-types` 下加载 `lib/**`。
- 从数据库读应用配置，按 `cfg.claudeConfigDir` 设置 `CLAUDE_CONFIG_DIR` 后再导入模型模块；
  缺失即失败，绝不回落到 `~/.claude`。
- 调用 `bindUsagePersistence`，新增 `UsageSite` `"legacy-split"`（并加到 `app/api/usage/route.ts`
  的站点顺序与中文名），花费进 `usage_daily`。
- 配置 `reflectPromoteMs` 必须为 0。

流程：

1. **选取**：`kb_chunks.doc='human-reflection'` 中 source 解析出 `chatId='0'` 的块，LEFT JOIN meta，
   按 `answer`（无 answer 时按自身 content）分组。组内有任一块不是 `approved` → 整组跳过（不让驳回
   内容借拆分复活），在报告里列出。
2. **分段**：逻辑 FAQ 按空行段落累积成约 4k 字的段组，每段组一次调用，避免 2 万字输入撞
   180s 超时和长输出质量下降。
3. **拆分**（常量系统提示，FAQ 只放 user 侧）：输出 `{ units: [{ text, sourceQuotes: string[] }] }`。
   每条 `text` ≤380 字、单一主题、可脱离上下文理解（写出产品名与分组名），只复述原文已有事实，
   价格、倍率、当前可用性、公告、临时故障等动态内容直接丢弃。`sourceQuotes` 为支撑该条的原文
   逐字摘录。
4. **程序校验**（逐条，不过则丢弃该条并记入报告）：非空、≤380 字、无空行、不含「同上」「该分组」
   「上面」等指代（正则黑名单）、每条 `sourceQuotes` 非空且都是原 FAQ 的**逐字子串**。
5. **语义核验**：每个段组再调一次核验，常量系统提示，逐条返回 `supported`；不支持的条目丢弃。
6. **去重**：对照 `searchKb` 结果，排除全部旧整理块（本次要被替换的 336 块），只与正式文档、
   非整理反思以及**本次运行中已接受的新条目**（内存累积）比较，判定复用 `isDuplicateOfHits`。
   dry-run 与 apply 用同一套逻辑，结果一致。
7. **兜底**：某个逻辑 FAQ 一条有效条目都没产出时，不保留原碎片，改用确定性重切：按段落与
   句末标点（。！？）切成 ≤380 字的块，不调模型、不新增事实，只消除句中硬切。
8. **报告**：dry-run（默认）把每个 FAQ 的结果、丢弃项及原因写到 `data/split-legacy-<ts>.md`。
9. **`--apply`**：先调 `backupDatabase`（`lib/core/db/backup.ts`）自动备份并打印备份路径；然后对每个
   逻辑 FAQ 在单事务内调用 `replaceReflectionEntries(oldIds, units, ts, before, after, "approved")`
   （`expectedStatus` 防止 dry-run 之后被人工改过的组被覆盖），新条目 meta：`group_id='0'`、
   `question=NULL`、`answer=该条 sourceQuotes 以换行拼接`（真实原文摘录，作为日后成文核验的来源）、
   `review_state='legacy'`；事务内同时写 `reflect_compactions` 审计记录。

`legacy` 条目照常进入检索（替换掉的是更差的碎片），但不参与自动升格，等阶段 2 人工处置
（矛盾内容要先在那里清理，否则可能被升格进正式文档）。

并发：两种锁都只在进程内生效，脚本与运行中的 next-server 之间靠三点兜底：`reflectPromoteMs=0`
自检、`legacy` 状态挡住自动与批量升格、`expectedStatus` 乐观校验。部署步骤要求执行期间不在
反思页做手动操作。

预算估算：拆分约 $3、核验约 $1.5（CLI 计价）。

## 测试

- 迁移：v10 库升级到 v11 的升级测试；`repair` 重复执行不重建表、不丢列；整理块被标 `legacy`、
  非整理块不受影响；旧程序（注册表到 v10）打开 v11 库抛错，锁定回滚文档的说法。
- 账本：
  - `declined` 不再评审；`accepted` 下一轮直接成文、不重审；被 `maxPerRun` 截掉的通过条目保持
    `accepted`；模型漏返回的 id 保持 `NULL`。
  - 校验类失败 3 次转 `failed`；超时、I/O、`INTERNAL_FAULT_REASONS`、条目不存在、并发变化都不加
    次数，也不产生孤儿 meta。
  - 超预算条目在分批前标 `failed`，同批其它条目照常评审；单轮评审批次上限生效。
  - 有单条失败时游标仍推进（定时与「立即升格」两条路径）；整轮异常时不推进。
  - 手动 PATCH 对 `legacy`/`declined`/`failed` 可执行且失败不加次数；成功后 meta 随 chunk 删除；
    恢复入库清空账本（`legacy` 除外）。
  - `legacy` 条目在定时与「立即升格」入口都不进入评审。
- 成文：user prompt 含实算的 body 上限，同一输入两次调用的系统提示逐字相同；空行折叠后不再报
  「单元含空行」；超长时同轮重试一次且第二次 prompt 含超出字数。
- 配置：含 `reflectCompactMs` 等旧键的存量配置能加载，保存后不再含这些键。
- 拆分（注入 `queryFn`/`embed`）：`sourceQuotes` 不是子串的条目被丢弃；含指代词、超长、空行的条目
  被丢弃；去重排除旧整理块但能识别正式文档重复与本次运行内重复；组内含 rejected 块整组跳过；
  无有效条目时走确定性重切；`reflectPromoteMs≠0` 或缺 `claudeConfigDir` 时拒绝运行；`expectedStatus`
  不符时该组不替换；花费记入 `legacy-split` 站点。加一个 spawn 冒烟测试确认脚本能在原生 Node
  下完成模块加载（参照 `tests/scripts/db-maintenance.test.ts`）。
- 接口与 UI：`GET /api/reflection` 不含整理字段、条目摘要带账本字段；已删路由返回 404。
- `pnpm check` 全绿。

## 部署与回滚

1. 合并后 `pnpm db:backup`，记下备份路径；`pnpm pm:restart`（启动时执行 v11，旧块即刻标 `legacy`）。
2. `pnpm kb:split-legacy-reflections`（dry-run），人工看报告；确认后加 `--apply`。执行期间不在反思页操作。
3. 经管理端把 `reflectPromoteMs` 设回 `86400000`。注意：`reflect_promote_at` 停在 10-19，启用后约
   45 秒就会跑首轮（此时只有新反思会被评审，`legacy` 不参与）。
4. 观察 3 天 `usage_daily`：`promote` + `promote-compose` ≤ $3/天；记录 `failed` 数量与原因作为阶段 2 输入。

回滚：迁移不支持降级，旧程序打不开 v11 库（`runner.ts:51-55`）。可选两种方式：
- **前向修复（首选）**：保留 v11 迁移登记，只回退业务代码。
- **整库回退**：停进程 → 用第 1 步的备份替换 `data/agent.db` → 部署旧代码。会丢失备份之后写入的
  消息、会话与用量。

D 的替换在 `reflect_compactions` 里留有 before 文本，但没有向量，也没有反向工具；单独撤销 D 只能
走整库回退。

## 风险

- 删除整理后，同主题不同措辞、绕过近似去重的反思会并存；它们规模小、各自成条，影响远小于
  巨型 FAQ。阶段 2 的待审机制兜底。
- 拆分模型可能漏掉正确信息：逐字摘录校验与语义核验只保证不添加，不保证不遗漏；dry-run 报告人工审阅、
  自动备份兜底。
- `legacy` 条目里的矛盾内容（如 cc-sale 第三方支持）在阶段 2 处置前仍会被检索到，但不会被自动升格。

## 附录：受影响文件清单

**删除**：`lib/knowledge/reflection/compactor.ts`、`tests/lib/knowledge/reflection/compactor.test.ts`、
`app/api/reflection/compact/route.ts`、`app/api/reflection/compactions/[id]/route.ts`、
`components/admin/reflection/compaction-row.tsx`。

**修改（源码）**：`lib/conversation/assemble.ts`、`lib/runtime.ts`、`lib/core/config/schema.ts`、
`lib/core/config/env.ts`、`lib/core/db/repositories/reflection.ts`、`lib/core/db/repo.ts`、
`lib/core/db/row-mappers.ts`、`lib/core/db/rows.ts`、`lib/core/db/models.ts`、
`lib/core/db/reflection-mappers.ts`、`lib/core/db/migrations/registry.ts`、
`lib/core/db/migrations/schema.ts`、`lib/knowledge/reflection/promoter.ts`、
`lib/knowledge/reflection/promote-compose.ts`、`lib/knowledge/reflection/maintenance-lock.ts`（注释）、
`lib/model/stats/usage.ts`、`lib/model/query-options.ts`（注释）、`lib/model/timeout.ts`（注释）、
`lib/core/db/repositories/knowledge.ts`（注释）。

**修改（路由与 UI）**：`app/api/reflection/route.ts`、`app/api/reflection/entries/[id]/route.ts`（注释）、
`app/api/reflection/promote/route.ts`、`app/api/usage/route.ts`、`app/admin/reflection/page.tsx`、
`components/admin/reflection/use-reflection-actions.ts`、`components/admin/reflection/types.ts`、
`components/admin/reflection/entry-row.tsx`、`components/admin/reflection/request-action.ts`（注释）、
`components/admin/config/reflect-settings.tsx`。

**修改（测试）**：`tests/lib/reflection-route.test.ts`、`tests/lib/knowledge/reflection/maintenance-lock.test.ts`
（改为「批量升格与单条升格串行」）、`tests/lib/knowledge/reflection/promoter.test.ts`（游标语义反转）、
`tests/lib/knowledge/reflection/promote-compose.test.ts`、`tests/lib/core/db/repo.reflection.test.ts`、
`tests/lib/core/config-store.test.ts`、`tests/lib/core/config/patch.test.ts`、`tests/lib/runtime.test.ts`、
`tests/lib/core/chat/enabled-chats.test.ts`、`tests/lib/core/api.test.ts`、
`tests/ui/admin-knowledge-contracts.test.ts`、`tests/lib/core/http-client.test.ts`、
`tests/lib/model/stats/usage.test.ts`、`tests/architecture/layering.test.ts`，以及迁移测试。

**修改（文档与配置）**：`.env.example`、`README.md`、`docs/development.md`、`docs/data-access.md`、
`docs/database-operations.md`、`UX-CONTRACT.md`、`docs/assets/prayer-*.svg`、`package.json`。

**新增**：`scripts/split-legacy-reflections.ts`、`lib/knowledge/reflection/legacy-split.ts`、
`tests/lib/knowledge/reflection/legacy-split.test.ts`、`INTERNAL_FAULT_REASONS` 的 lib 归属文件。

以上为审查时的定位，实现者须以 `pnpm check` 与全文搜索为准补齐，不以本清单为完整依据。
