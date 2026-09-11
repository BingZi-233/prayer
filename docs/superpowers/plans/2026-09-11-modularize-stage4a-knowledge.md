# 模块化分层重构 · 阶段 4a（knowledge 层）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把知识库与反思链路的 8 个文件迁入 `lib/knowledge/`——`tools/kb`、`kb-path`、`agent/kb-prefetch`、`agent/reflection-{poller,compactor,promoter}`、`reflect-promote`、`reflect-stats`。搬完 `lib/tools/` 整个消失。

**Architecture:** 纯搬迁 + 三次改名，约 20 行 import 改写。与前面几阶段同法：先 `git mv`，再让 `pnpm typecheck` 驱动修正。

**为什么拆出这一半：** 阶段 4 还要把其余 `lib/agent/*`（13 个文件）与 `assemble`/`transcript` 搬进 `lib/conversation/`——那是 **4b**。知识侧与会话侧是两条独立的链，分开做便于评审。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（「目标结构」`knowledge/` 段与「迁移阶段」表第 4 行）

> **已知限制（最终审查记录，4b 需留意）：** 本阶段删掉的「父目录规则与自身层别不同」用例，是
> `PREFIX_RULES` 注释里宣称的「顺序敏感：具体文件规则必须排在目录通配之前」这条**查找语义的唯一
> 断言**。删掉后，该语义在树内已无任何用例覆盖 —— 当前也没有这种情形（所以无实际风险），但
> **4b 若引入一个「位于某目录规则之下、层级却不同」的具体规则**（例如把 `introspect.ts` 归去
> `model/` 而它仍留在 `lib/agent/` 下），误分类会**静默漏过**。届时需要补一条能真红的断言。
>
> **留给阶段 4b 的一个待定问题（本次不动）：** 质量审查指出 `lib/agent/introspect.ts`
> （`probeCapabilities`，唯一消费者 `app/api/capabilities/route.ts`，不参与会话流）
> **语义上更像 model 层** —— 它的兄弟 `tool-policy`/`sdk-env`/`plugins/manager` 都在 `model/`。
> spec 把它归 `conversation/` 可辩护但略偏。4b 搬它时再定：跟 `conversation/` 走，还是改归 `model/`。

## Global Constraints

- **零行为改动。** 除下列两类外内容一字不动：**（一）import 语句；（二）注释里指向本次搬迁路径的引用**。注释以外的任何内容都不许动。本阶段**不切分任何文件**。
- **不写兼容 shim。** 旧路径一律不保留 re-export。
- **分支**：`refactor/stage4a-knowledge`，从 `main` 切出。不直接提交 main，**不 push**。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**；也**不要**对本就不合 prettier 的存量文件跑 `prettier --write`（会顺带重排无关行）。
- 包管理器用 `pnpm`。

## 搬迁清单

| 从 | 到 |
| --- | --- |
| `lib/tools/kb.ts` | `lib/knowledge/kb.ts` |
| `lib/kb-path.ts` | `lib/knowledge/kb-path.ts` |
| `lib/agent/kb-prefetch.ts` | `lib/knowledge/kb-prefetch.ts` |
| `lib/agent/reflection-poller.ts` | `lib/knowledge/reflection/poller.ts` |
| `lib/agent/reflection-compactor.ts` | `lib/knowledge/reflection/compactor.ts` |
| `lib/agent/reflection-promoter.ts` | `lib/knowledge/reflection/promoter.ts` |
| `lib/reflect-promote.ts` | `lib/knowledge/reflection/promote.ts` |
| `lib/reflect-stats.ts` | `lib/knowledge/reflection/stats.ts` |

**搬完后：** `lib/tools/` **整个消失**（`kb.ts` 是它最后一个文件）；`lib/agent/` 少 4 个、剩 16 个（4b 处理）。

**明确不搬**：`lib/agent/` 其余文件、`lib/assemble.ts`、`lib/transcript.ts`、`lib/runtime.ts`。

## 影响面与深度变化（**本阶段最易错的地方**）

被引用的路径与次数：`reflect-promote` 4、`kb-path` 3、`agent/reflection-{promoter,poller,compactor}` 各 3、`reflect-stats` 2、`tools/kb` 1、`agent/kb-prefetch` 1 —— 合计约 **20 行 import**。

**深度变化分三类，务必按类核对**（现有代码全部用相对 import）：

| 文件 | 新位置相对旧位置 | 它引用的 `../core/…`、`../model/…` |
| --- | --- | --- |
| `tools/kb.ts` → `knowledge/kb.ts` | **同深度**（都在 `lib/` 下一层） | **不变** |
| `agent/kb-prefetch.ts` → `knowledge/kb-prefetch.ts` | **同深度** | **不变** |
| `agent/reflection-{poller,compactor,promoter}.ts` → `knowledge/reflection/*.ts` | **深一层**（多了 `reflection/`） | `../core/` → `../../core/`；`../model/` → `../../model/` |
| `reflect-promote.ts` / `reflect-stats.ts` → `knowledge/reflection/*.ts` | 原在 `lib/` **根**，现深两层 | `./core/` → `../../core/` |
| `kb-path.ts` → `knowledge/kb-path.ts` | 深一层，但它**只引 `node:path`** | 无变化 |
| `reflection-promoter.ts` 对 `../reflect-promote` 的引用 | 两者都进 `reflection/` | 变成同级 `./promote` |

**`typecheck` 覆盖不到的引用类型**（设计文档已列全）：`vi.mock` 字符串目标、运行时拼接路径、测试里的路径断言、配置文件别名、注释路径、仓库入口文件的相对导入。

## Task 1: 搬迁八个文件

**Files:**
- Move: 上表 8 个文件
- Modify: 引用它们的文件（约 20 处 import）

- [ ] **Step 1: 新建分支并确认起点干净**

```bash
git checkout main
git status --short          # 必须无输出
git checkout -b refactor/stage4a-knowledge
```

- [ ] **Step 2: 搬迁（含三次改名）**

```bash
mkdir -p lib/knowledge/reflection
git mv lib/tools/kb.ts lib/knowledge/kb.ts
git mv lib/kb-path.ts lib/knowledge/kb-path.ts
git mv lib/agent/kb-prefetch.ts lib/knowledge/kb-prefetch.ts
git mv lib/agent/reflection-poller.ts lib/knowledge/reflection/poller.ts
git mv lib/agent/reflection-compactor.ts lib/knowledge/reflection/compactor.ts
git mv lib/agent/reflection-promoter.ts lib/knowledge/reflection/promoter.ts
git mv lib/reflect-promote.ts lib/knowledge/reflection/promote.ts
git mv lib/reflect-stats.ts lib/knowledge/reflection/stats.ts
rmdir lib/tools
```

（`rmdir` 只在空目录时成功 —— 报非空说明漏搬了。）

- [ ] **Step 3: 让 typecheck 驱动修复 import**

```bash
pnpm typecheck 2>&1 | head -50
```

按上面「深度变化」那张表分类处理。**循环修正直到 `pnpm typecheck` 输出为空。**

**特别留意 `reflection-promoter.ts`**：它对 `../reflect-promote` 的引用要变成 `./promote`（两者都进了 `reflection/`）。

- [ ] **Step 4: 手工检查 typecheck 抓不到的引用**

```bash
grep -rnE "(tools/kb|kb-path|kb-prefetch|agent/reflection-(poller|compactor|promoter)|reflect-promote|reflect-stats)" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' --include='*.js' \
  app lib components tests plugins scripts instrumentation.ts proxy.ts next.config.ts ecosystem.config.cjs components.json \
  | grep -v "lib/knowledge/"
```

Expected: 无输出。

**特别检查 `vi.mock` 与字符串路径**（typecheck 不看）：

```bash
grep -rn 'vi.mock("@/lib/\(tools/kb\|kb-path\|agent/kb-prefetch\|agent/reflection\|reflect-\)' --include='*.ts' tests
grep -rnE "join\(root, \"lib/(tools|agent|reflect)" --include='*.ts' plugins scripts
```

Expected: 两条都无输出。逐个修正发现的问题。

同时查注释里的路径引用：

```bash
grep -rnE "^\s*(//|\*|/\*)" --include='*.ts' lib app | grep -E "tools/kb|kb-path|kb-prefetch|reflection-|reflect-"
```

- [ ] **Step 5: 确认目录结构**

```bash
ls lib/knowledge/ lib/knowledge/reflection/
ls lib/tools/ 2>&1
ls lib/agent/ | wc -l
ls lib/*.ts
```

Expected：`lib/knowledge/` 含 `kb.ts kb-path.ts kb-prefetch.ts reflection/`；`lib/knowledge/reflection/` 含 `poller.ts compactor.ts promoter.ts promote.ts stats.ts`；`lib/tools/` 报 `No such file or directory`；`lib/agent/` 为 **16**；`lib/*.ts` 少掉 `kb-path.ts`、`reflect-promote.ts`、`reflect-stats.ts`，剩 `assemble.ts runtime.ts transcript.ts`（3 个）。

- [ ] **Step 6: 同步镜像测试目录**

`docs/development.md` 要求测试镜像源码目录。要搬的：

```bash
mkdir -p tests/lib/knowledge/reflection
git mv tests/lib/tools/tools.test.ts tests/lib/knowledge/kb.test.ts
git mv tests/lib/kb-path.test.ts tests/lib/knowledge/kb-path.test.ts
git mv tests/lib/agent/kb-prefetch.test.ts tests/lib/knowledge/kb-prefetch.test.ts
git mv tests/lib/agent/reflection-poller.test.ts tests/lib/knowledge/reflection/poller.test.ts
git mv tests/lib/agent/reflection-compactor.test.ts tests/lib/knowledge/reflection/compactor.test.ts
git mv tests/lib/agent/reflection-promoter.test.ts tests/lib/knowledge/reflection/promoter.test.ts
git mv tests/lib/reflect-promote.test.ts tests/lib/knowledge/reflection/promote.test.ts
rmdir tests/lib/tools
```

注意：`tests/lib/tools/tools.test.ts` 测的是 `lib/tools/kb.ts`，**改名**成 `kb.test.ts` 与镜像一致。`tests/lib/reflect-stats.test.ts` **不存在**（无需处理）。`tests/lib/tools/` 搬空后删除（上面的 `rmdir` 只在空目录时成功 —— 报非空说明漏搬了）。

⚠️ **但 `tests/lib/plugins/` 下的 `route.test.ts`、`id-route.test.ts` 与 `tests/lib/agent/` 下其余测试不在此列，留在原地** —— 别整目录搬。

- [ ] **Step 7: 跑测试与类型检查**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；vitest **96 文件 / 972 用例**全过。

**`tests/architecture/layering.test.ts` 预计会红**（映射表还指着旧路径，且 `lib/knowledge/` 尚无规则）—— 那是 **Task 2 的范围，本任务不要改它**。记下哪几个用例红了即可。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "refactor(knowledge): 知识库与反思链路迁入 lib/knowledge

kb 工具、kb-path、kb-prefetch、reflection 三件套与 promote/stats 原散在
lib/tools/、lib/ 根与 lib/agent/ 三处。它们是同一条链(检索→反思→升格),
归到独立的 knowledge 层。lib/tools/ 目录随之消失。零行为改动,约 20 行
import 改写,测试目录同步镜像。"
```

## Task 2: 同步护栏与文档

**Files:**
- Modify: `tests/architecture/layering.test.ts`
- Modify: `docs/development.md`、`CLAUDE.md`
- Rename: `lib/knowledge/reflection/promote.ts` → `apply-promote.ts`

> **护栏改动清单（共 6 处，一处都不能漏）** —— 质量审查逐条开出来的。下面各 Step 分别对应：
>
> | # | 改动 | 对应 Step |
> | --- | --- | --- |
> | 1 | 新增 `["lib/knowledge/", "knowledge"]` 目录规则 | Step 1 |
> | 2 | 删 8 条已死的精确规则 | Step 2 |
> | 3 | 8 条旧路径 + 目录 `lib/tools/` 登记进 `RETIRED_PREFIXES` | Step 3 |
> | 4 | 删「父目录规则与自身层别不同」里那 4 条 knowledge 项 | Step 4 |
> | 5 | 分类钉子 `lib/tools/kb.ts` → `lib/knowledge/kb.ts` | Step 5 |
> | 6 | `CURRENT_STAGE` `"3b"` → `"4a"`、`STAGE_ORDER` 拆 4a/4b | Step 6 |
>
> **一个副作用（正常）**：现在 `layerOf("lib/knowledge/*")` 返回 `null`，`collectViolations` 会早退 ——
> 也就是说**在此之前，护栏对 knowledge 层是全盲的**。加上规则后扫描才首次覆盖这一层。
> 已人工核对 8 个 knowledge 文件均无 `knowledge → conversation` 逆向边，但**加完规则后务必跑一次
> 测试确认**（若有逆向边，这一刻会暴露出来）。

- [ ] **Step 1: 新增 `lib/knowledge/` 的目录规则**

```ts
  // knowledge
  ["lib/knowledge/", "knowledge"],
```

**漏了它，搬过去的 8 个文件会全部「未归层」。**

- [ ] **Step 2: 删掉已死的精确规则**

先在文件里找到确切写法再删（8 条：`lib/tools/kb.ts`、`lib/kb-path.ts`、`lib/agent/kb-prefetch.ts`、`lib/agent/reflection-{poller,compactor,promoter}.ts`、`lib/reflect-promote.ts`、`lib/reflect-stats.ts`）。

`["lib/agent/", "conversation"]` **保留**（还有 16 个文件）。

- [ ] **Step 3: 登记退役前缀**

**目录与精确文件都要登记，不做区分**（阶段 2a 证伪过一次）。追加：
- 目录 `lib/tools/`（**它整个消失了**）
- 8 条精确路径（上一步删的那些）

**现有 29 项 + 9 项 = 38 项。** 请自己数一遍并在回报里给出实际条数。

- [ ] **Step 4: 删掉「父目录规则与自身层别不同」钉子里那 4 条 knowledge 项**

该钉子现在枚举 4 条（`lib/agent/kb-prefetch.ts` 与 3 个 `lib/agent/reflection-*.ts`），**这 4 个文件本阶段全部搬走了**，新位置由 `["lib/knowledge/", "knowledge"]` 这条**同层目录规则**覆盖，不再是「父目录规则与自身层别不同」。

**因此该钉子的枚举会变成空数组。** 处理方式：**把这个用例整体删掉**（枚举为空时它没有判别力），或保留结构但清空数组 —— **推荐删掉**，并在提交信息里说明原因。

- [ ] **Step 5: 更新分类钉子用例**

逐条核对那 7 条分类断言是否引用了已搬走的路径。已知 `lib/tools/kb.ts` 那条要改：

```ts
    expect(layerOf("lib/knowledge/kb.ts")).toBe("knowledge")
```

其余 6 条（`lib/core/config/chats.ts`、`lib/core/chat/types.ts`、`lib/channels/qq/members-fetch.ts`、`lib/model/embed.ts`、`lib/agent/agent.ts`、`lib/runtime.ts`）本阶段**不受影响**，但请逐条确认。

- [ ] **Step 6: 更新 `CURRENT_STAGE` 与 `STAGE_ORDER`**

阶段 4 拆成 4a/4b：

```ts
const CURRENT_STAGE = "4a"
const STAGE_ORDER = ["0", "1", "2a", "2b", "3a", "3b", "4a", "4b", "5", "6"]
```

`TOLERATED` 已是空数组，无需改动。

- [ ] **Step 7: 跑测试并做反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 全绿。

反向验证（**真做，走真实磁盘文件**）：临时建 `lib/tools/kb.ts`（内容随意），跑测试，应看到「已退役前缀没有任何文件命中」**失败**；然后**完整删掉**该文件与空的 `lib/tools/` 目录，复跑恢复全绿，确认 `git status` 干净。

- [ ] **Step 8: 更新文档**

- `docs/development.md` 的「待改写条目」表：若某行任务完成则删；若只完成一半则改窄。**本阶段过后该表应只剩阶段 4b 与 5 相关项。**
- 「模块边界」里若提到 `lib/tools/`、`kb-path`、`reflect-*` 的旧路径，一并改到 `lib/knowledge/…`。
- `CLAUDE.md` 的「仓库结构」：`lib/` 括号里的 `tools/` KB 检索 应改为 `knowledge/` 知识库与反思；**并确认顶层 `plugins/` 未被误碰**。

复核：

```bash
grep -n "lib/tools\|reflect-promote\|reflect-stats\|kb-prefetch\|reflection-poller\|reflection-compactor\|reflection-promoter" docs/development.md CLAUDE.md
```

Expected: 无输出。

- [ ] **Step 9: 把 `promote.ts` 改名成 `apply-promote.ts`**

质量审查指出:`reflection/` 下同时有 `promote.ts`(83 行,`applyPromote` 写盘工具)与 `promoter.ts`(318 行,编排),**名字只差一个字母 `r`** —— 比旧名 `reflect-promote` / `reflection-promoter` 更易混,而且 `promote.ts` 是这一层里唯一不带 `-er` 的非调度文件。

改名:

```bash
git mv lib/knowledge/reflection/promote.ts lib/knowledge/reflection/apply-promote.ts
```

同步改引用(至少 `reflection/promoter.ts` 的 `./promote` → `./apply-promote`;用 `pnpm typecheck` 找出全部)。

**并同步改设计文档的目标结构树**(`docs/superpowers/specs/2026-09-10-modularize-layering-design.md` 里 `reflection/` 那行的 `promote.ts` → `apply-promote.ts`),否则 spec 与实际又不一致。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "refactor(arch): 同步护栏映射表与文档的 knowledge 路径

新增 lib/knowledge/ 目录规则;8 条旧精确规则与 lib/tools/ 目录移入
RETIRED_PREFIXES;那条「父目录规则与自身层别不同」的钉子 4 条 knowledge
项已随搬迁脱离该场景,枚举清空故整体删除。STAGE_ORDER 把 4 拆成 4a/4b。"
```

## Task 3: 全量验证

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出；eslint 0 error（1 条既有 warning）；vitest **96 文件 / 972 用例**全过（本阶段不增删测试；若 Task 2 删掉了那个钉子用例，则用例数 **-1 = 971**，属预期）。

- [ ] **Step 2: 目录结构**

```bash
ls lib/knowledge/ lib/knowledge/reflection/
ls lib/tools/ 2>&1
ls lib/agent/ | wc -l
ls lib/*.ts
```

Expected: 同 Task 1 Step 5。

- [ ] **Step 3: 零行为改动取证**

```bash
git diff -M main..HEAD --numstat -- lib/ app/ components/ plugins/ scripts/ components.json instrumentation.ts proxy.ts
git diff -M main..HEAD | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
```

Expected: 生产侧「既非 import 也非注释」的改动行数为 **0**。**逐行核对，不要只靠脚本**（上一阶段验证者发现自动过滤口径过宽会误吞）。

- [ ] **Step 4: 旧路径残留**

```bash
grep -rnE "(tools/kb|kb-path|kb-prefetch|agent/reflection-(poller|compactor|promoter)|reflect-promote|reflect-stats)" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' app lib components tests plugins scripts instrumentation.ts proxy.ts next.config.ts ecosystem.config.cjs components.json \
  | grep -v "lib/knowledge/"
```

Expected: 唯一命中应是护栏里的**退役登记**（设计内），如实列出。

- [ ] **Step 5: 护栏状态与反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "CURRENT_STAGE\|STAGE_ORDER" tests/architecture/layering.test.ts
sed -n '/^const RETIRED_PREFIXES/,/^]/p' tests/architecture/layering.test.ts | grep -c '"lib/'
```

反向验证：临时建 `lib/tools/kb.ts` → 应让「已退役前缀没有任何文件命中」失败 → **完整删掉** → 复跑全绿 → `git status` 干净。

- [ ] **Step 6: 工作区**

```bash
git status --short
```

Expected: 无输出。

本任务不产生新提交。若 Step 1–6 全部符合 Expected，阶段 4a 即可收口。
