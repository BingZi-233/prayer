# 自动升格产物合规化（adding-kb-knowledge）设计

- 日期：2026-09-16
- 分支：`feat/promote-kb-compliance`
- 范围：反思自动升格 + 手动升格的产物形状、落盘层、去重合并、写入台账；并迁移已存在的 7 条历史升格文件。

## 1. 问题

`lib/knowledge/reflection/apply-promote.ts` 现在把反思原文直接当成正式文档正文写盘：

```
# 升格反思 #196007

非 GPT 模型接入 Codex 客户端参照 DeepSeek 接入方式……
```

对照 `adding-kb-knowledge` 技能，实证违规点：

1. **落错层**。技能规定当前知识默认 `docs/kb/retrieval/<domain>/`，`docs/kb/promoted/` 是升格/历史层，不是普通新增的目的地。本仓语料 2026-09-11 已整体迁到 `retrieval/`（48 个文件），只有自动升格还在往 `promoted/` 丢（7 个文件）。
2. **ISOLATED_HEADING**。`splitCompactedFaq` 按空行切段，标题后有空行，于是每个升格文件都额外产出一个只含 `# 升格反思 #<id>` 的垃圾向量。`apply-promote.ts:153-155` 的注释本身就承认"标题与正文是两段"。
3. **标题无检索语义**。技能要求产品/主题 + 任务出现在标题或首句；`升格反思 #196007` 不含任何可检索词。
4. **无 provenance**。`retrieval/**` 每个单元都带 `来源：…；核验日期：…；动态性：…`，升格产物一律没有。
5. **无台账**。技能要求每次写入在 ingest glob 外留 manifest + SHA-256（本仓惯例 `docs/kb/_meta/*.md.disabled`）；自动升格直接写活跃语料 + 向量，零记录。
6. **不查同意图**。每条反思开一个新文件，从不检查既有 canonical 文档，文件数只增不减。
7. **500 字硬切**。超长反思会被切在句子中间。

根因是缺少"成文"这一步：只有"是否升格"的判定（`PROMOTE_SYSTEM`），没有"写成什么形状、并进哪个文档"的产出。

## 2. 决策（已确认）

| 决策点             | 选择                                                     |
| ------------------ | -------------------------------------------------------- |
| 合规范围           | 格式 + 路径 + 台账 + 合并去重                            |
| 成文与归属由谁产出 | 两阶段 LLM：第一阶段判定不变，第二阶段 per-entry 成文    |
| 来源标注           | 正文/来源问答里原文出现过官方 URL 则用之，否则标会话来源 |
| 历史 7 条文件      | 与代码同一轮迁移（ingest 需单独显式授权）                |

## 3. 架构

### 3.1 单一成文入口

手动升格（`app/api/reflection/route.ts:132` 的 PATCH `action=promote`）现在绕过 promoter 直接调 `applyPromote`。改造后两条路径都必须先成文，否则手动升格仍产出违规文件。`applyPromote` 的入参从"chunkId"变为"chunkId + 已成文单元"，成为唯一写盘/写库收口。

### 3.2 新模块 `lib/knowledge/reflection/promote-compose.ts`

第二阶段，per-entry。输入：

- 反思正文 + 来源问答（经 `sanitizeForModel`）
- top-k 候选文档：doc 相对路径 + 该文档的全部 chunk 正文（`repo.kbChunksByDoc`）

候选文档来自第一阶段已经算过的 `embed(e.content)` + `searchBaseKb` 结果，复用，不重复 embed。

输出 schema（`json_schema`，`additionalProperties:false`）：

```
{ target: { mode: "merge" | "new", doc?: string, domain?: string, slug?: string },
  unit:   { title: string, body: string, sourceUrl: string | null, volatility: string } }
```

### 3.3 路径与来源由程序把关

纯函数 `resolveTarget(raw, candidateDocs, existsFn)`，不信模型输出：

- `mode:"merge"`：`doc` 必须精确命中本次传入的候选 doc 列表，否则拒绝本条。
- `mode:"new"`：`domain` 必须在白名单（`advanced/ccswitch/cli/faq/foundation/image/legal/token`，即现有 `retrieval/*` 目录），`slug` 必须匹配 `^[a-z0-9][a-z0-9-]{2,39}$`，落 `retrieval/<domain>/<slug>.md`；同名文件已存在则转为 merge 到它。
- `sourceUrl` 必须是反思正文或来源问答里原文出现过的 URL（子串校验），否则丢弃，退回会话来源标注。
- 任何校验不过或第二阶段调用失败 → 该条本轮不升格，状态留 `approved`，下轮重试；绝不退化成旧格式写盘。

`applyPromote` 内仍保留 `safeKbAbsAt` 作为第二道闸（越界/符号链接/非 `.md`）。

### 3.4 成文模板

标题紧跟首句，消除 ISOLATED_HEADING：

```
# 产品：<产品>；协议：<协议>；任务：<任务>
<结论/步骤/例外/边界>。来源：<官方 URL 或 QQ 群客服会话反思 #<id>>；核验日期：<升格日>；动态性：<volatility>
```

merge 模式只产出上面第二行那种单个空行段落，追加到目标文件末尾，形状与 `docs/kb/retrieval/token/invalid-token.md` 现有单元一致。成文后的单元必须 ≤ `DEFAULT_KB_CHUNK_MAX_CHARS`（500），超出则拒绝本条。

### 3.5 写盘与写库

`applyPromoteUnlocked` 的改动：

- merge 时先 `readKbFileBoundedNoFollow` 读旧正文，拼接为新正文；文件缺失或不可读 → 失败，不静默新建。
- 现有 temp 文件（`wx` + `0600`）+ 原子 rename + 旧内容快照 + `restoreFile` 回滚机制全部保留。
- DB 仍是单事务：`deleteKbDoc(rel)` → 对 `splitCompactedFaq(整份新正文)` 的每段 embed 后 `insertKbEntry` → `deleteKbChunk(chunkId)`。形状不变，区别只是 merge 时 body 是整份合并后的文件。
- 软上限：目标文件段数 > `MAX_MERGE_CHUNKS`（= 40）则不合并、改为新建，避免往 `legal/terms.md` 这类大文件里塞反思后，每次升格都要全量重算向量。

### 3.6 仓库层小改

`KnowledgeRepository.searchBaseKb` 的 SELECT 增加 `c.doc`，`KbHit` 增加 `doc` 字段——第二阶段需要 doc 相对路径。现有调用方读 `source` 的行为不变（纯增字段）。

## 4. 台账

### 4.1 时序

台账刻意排在活跃语料之前：正文在内存里已确定，pre/post SHA-256 都能提前算，所以"写入前必有台账"可满足。以下全部在现有 `withPromotionLock` + `withKbMutationLock` 内执行：

1. merge 模式：读旧文件 → pre SHA-256 → 写字节快照 `docs/kb/_meta/<日期>-promote-<id>-pre-edit.md.disabled`。new 模式：`original_path: null`，无快照。
2. 写 `docs/kb/_meta/<日期>-promote-<id>-manifest.md.disabled`。
3. 写活跃文件（temp + `wx` + rename）。
4. DB 单事务；失败走现有 `restoreFile` 回滚文件，并 best-effort 把 manifest 标 `result: rolled_back`。

`_meta/*.md.disabled` 不匹配 `isKbRelPath`（只认 `.md`/`.txt`），因此台账自身不会被 ingest 收进语料；也因此 `safeKbAbsAt` 不适用于台账路径——文件名全部由程序生成、无模型输入，改用固定目录 + 目录符号链接检查单独守卫。

### 4.2 字段

对齐仓内已有的 `docs/kb/_meta/2026-09-16-stream-disconnected-manifest.md.disabled`：

- intent、decision（merge/new）、target
- original_path / active_path / retired_path
- pre-edit snapshot 路径 + pre-edit SHA-256 + post-edit SHA-256
- source_status（官方 URL 或"QQ 群客服会话反思 #id"，以及 volatile 字段的处理说明）
- 结构预检：段数、各段字符长度、最长段、无 ISOLATED_HEADING
- embedding：`Xenova/bge-small-zh-v1.5`、实测维度 512、本次 embed 段数
- 授权：`db_write: in-process applyPromote`；`pnpm ingest: 不需要`（向量已在同一事务写入）

生成 manifest 正文的 `promoteManifest()` 是纯函数，不碰磁盘，单测覆盖。

## 5. 历史 7 条迁移

`docs/kb/promoted/reflection-{196007,196020,196374,196461,198245,198347,198794}.md` 目前仍是 ingest 可见的活跃语料，技能红旗"普通当前答案留在历史层"现在就成立。

步骤：

1. 逐条读原文，按意图归入既有 canonical 文档。初判：`196007`（DeepSeek/Codex 接入）→ `retrieval/advanced/deepseek-codex.md`；`198794`（Codex 加密内容 400）→ `retrieval/faq/api-errors.md`；其余 5 条读完再定。无对应意图才在合适 domain 新建。
2. 归类清单先交用户确认，再落盘。
3. 每条：pre-edit 快照 + SHA-256 → manifest → 追加合规单元（核验日期 2026-09-16）→ 旧文件 `mv` 为 `reflection-<id>.md.disabled`（字节保留退役）。
4. 迁移落盘后单独向用户申请一次 `pnpm ingest` 授权；未获授权不执行。

风险与依赖：旧 doc `promoted/reflection-*.md` 的向量必须清除、合并后的文档必须重算，否则 `checkKbFreshness` 必然 FAIL（`ORPHAN_INDEX_DOC` + `CHUNK_COUNT_MISMATCH`），且线上检索仍会命中已退役内容。因此"迁移落盘"与"授权 ingest"是同一件事的两半，不授权就停在落盘态并明确报告。

迁移完成后 `docs/kb/promoted/` 只剩 `_archive` 与 `.md.disabled`，代码不再写这个目录。

## 6. 测试

新增：

- `tests/lib/knowledge/reflection/promote-compose.test.ts`：`resolveTarget` 拒编造 doc、拒 `../` 穿越、拒非白名单 domain、拒非法 slug、拒未在原文出现的 URL；模板标题后无空行；单元 ≤ 500 字符。
- manifest 纯函数测试（字段齐备、SHA 占位正确、rolled_back 变体）。

修改：

- `tests/lib/knowledge/reflection/apply-promote.test.ts`：新入参、merge 追加、目标文件缺失即失败、段数上限转新建、台账先于正文、DB 失败回滚。
- `tests/lib/knowledge/reflection/promoter.test.ts`：两阶段 stub、成文失败则该条不升格且状态仍 `approved`。
- `tests/lib/reflection-route.test.ts`：手动 PATCH 也走成文路径。

护栏断言：产物路径必须以 `retrieval/` 开头、禁止写 `promoted/`。断言里不留旧路径当正例，避免规则失效时静默空过。

验收：`pnpm check` 全绿；历史迁移 + 授权 ingest 后 `checkKbFreshness` 报 PASS。

## 7. 文档同步

`docs/data-access.md`、`docs/development.md` 都写了升格落 `promoted/`，随代码一并更新。

## 8. 明确不做

- 不改第一阶段 `PROMOTE_SYSTEM` 的保守门槛规则（volatile 过滤等已覆盖）。
- 不引入人工授权门禁：自动升格仍直接生效（写文件 + 同事务入库），不改为暂存待审。
- 不动检索器、prompt 构造、嵌入模型与 DB schema。
- 不做语料级别的全库清理（那是 `kb-retrieval-curation` 的范围）。
