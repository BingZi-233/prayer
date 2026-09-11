# 模块化分层重构 · 阶段 3a（model 层的搬迁部分）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「模型基座」类的既有文件搬进新建的 `lib/model/`——`sanitize-input` / `json-output` / `timeout` / `embed` / `usage-stats` / `tool-stats` / `plugins/manager` 七个。

**Architecture:** 纯搬迁 + 两次改名，约 23 行 import 改写。与阶段 2a/2b 同法：先 `git mv`，再让 `pnpm typecheck` 驱动修正。

**为什么拆出这一半：** 阶段 3 的设计里还有一半是**切分** `lib/agent/agent.ts`（715 行，抽出 `sdk-env`/`query-options`/`drain`/`system-prompt`/`tool-policy`/`prompt`）。切分需要单独设计接缝，而搬迁是纯机械的。先把散件搬出去，`agent.ts` 的切分会更干净——本计划只做搬迁那一半（**3a**），切分留给 **3b**。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（见「目标结构」`model/` 与「迁移阶段」表第 3 行）

## Global Constraints

- **零行为改动。** 除下列两类外，任何文件的内容一字不动：**（一）import 语句；（二）注释里指向本次搬迁路径的引用**（设计文档要求「搬迁时代码注释里的路径引用要一并改」——这类引用不进类型检查，漏了不会报错，只会腐烂）。**注释以外的任何内容都不许动。** 本阶段**不切分任何文件**。
- **不写兼容 shim。** 旧路径一律不保留 re-export。
- **分支**：`refactor/stage3a-model-moves`，从 `main` 切出。不直接提交 main，**不 push**。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**（仓库有 41 个存量文件不符合 prettier）。只对自己改过的文件跑 `prettier --write`。
- 包管理器用 `pnpm`。

## 搬迁清单

| 从 | 到 | 备注 |
| --- | --- | --- |
| `lib/agent/sanitize-input.ts` | `lib/model/sanitize-input.ts` | |
| `lib/agent/json-output.ts` | `lib/model/json-output.ts` | |
| `lib/agent/timeout.ts` | `lib/model/timeout.ts` | |
| `lib/tools/embed.ts` | `lib/model/embed.ts` | |
| `lib/usage-stats.ts` | `lib/model/stats/usage.ts` | **改名**（去掉 `-stats`） |
| `lib/tool-stats.ts` | `lib/model/stats/tool.ts` | **改名** |
| `lib/plugins/manager.ts` | `lib/model/plugins/manager.ts` | |

**搬完后：**
- `lib/tools/` 只剩 `kb.ts`（阶段 4 才搬它）
- `lib/plugins/` **整个消失**
- `lib/agent/` 少掉 3 个文件，剩 20 个（`agent.ts` 与其余编排文件，阶段 3b/4 处理）

**明确不搬**：`lib/agent/` 其余文件、`lib/tools/kb.ts`、`lib/kb-path.ts`、`lib/reflect-*.ts`、`lib/assemble.ts`、`lib/transcript.ts`、`lib/runtime.ts`。

## 影响面

| 被引用的路径 | 引用次数 |
| --- | --- |
| `tools/embed` | 7 |
| `usage-stats` | 5 |
| `tool-stats` | 5 |
| `plugins/manager` | 3 |
| `agent/sanitize-input` / `agent/json-output` / `agent/timeout` | 各 1 |

合计约 **23 行 import** —— 比阶段 2b 还小。

**已探明的接缝：**
- `lib/agent/sanitize-input.ts` 引用 `../core/log-context` → 搬进 `lib/model/` 后变成 `../core/log-context`（**深度不变**：`lib/agent/` 与 `lib/model/` 同在 `lib/` 下一层）。**这条要特别核对** —— 深度相同的搬迁最容易想当然。
- `lib/usage-stats.ts` 与 `lib/tool-stats.ts` 引用 `./core/db/repo` → 搬进 `lib/model/stats/` 后变成 `../../core/db/repo`（**深了一层**：多了 `stats/`）。
- `lib/tools/embed.ts` 只引第三方包；`lib/agent/json-output.ts`、`lib/agent/timeout.ts` 无 import；`lib/plugins/manager.ts` 只引 `node:` 内置。

**`typecheck` 覆盖不到的引用类型**（设计文档已列全）：`vi.mock` 字符串目标、运行时拼接路径、测试里的路径断言、配置文件别名、注释路径、仓库入口文件的相对导入。本阶段**尤其要查 `vi.mock`** —— 有 4 个测试文件 mock 过 `@/lib/tools/embed`。

## Task 1: 搬迁七个文件

**Files:**
- Move: 上表 7 个文件
- Modify: 引用它们的文件（约 23 处 import）

- [ ] **Step 1: 新建分支并确认起点干净**

```bash
git checkout main
git status --short          # 必须无输出
git checkout -b refactor/stage3a-model-moves
```

- [ ] **Step 2: 搬迁（含两次改名）**

```bash
mkdir -p lib/model/stats lib/model/plugins
git mv lib/agent/sanitize-input.ts lib/model/sanitize-input.ts
git mv lib/agent/json-output.ts lib/model/json-output.ts
git mv lib/agent/timeout.ts lib/model/timeout.ts
git mv lib/tools/embed.ts lib/model/embed.ts
git mv lib/usage-stats.ts lib/model/stats/usage.ts
git mv lib/tool-stats.ts lib/model/stats/tool.ts
git mv lib/plugins/manager.ts lib/model/plugins/manager.ts
rmdir lib/plugins
```

（`rmdir` 只在空目录时成功 —— 报非空说明漏搬了。）

- [ ] **Step 3: 让 typecheck 驱动修复 import**

```bash
pnpm typecheck 2>&1 | head -50
```

规则：
- **别名**：`@/lib/tools/embed` → `@/lib/model/embed`；`@/lib/usage-stats` → `@/lib/model/stats/usage`；`@/lib/tool-stats` → `@/lib/model/stats/tool`；`@/lib/plugins/manager` → `@/lib/model/plugins/manager`；`@/lib/agent/{sanitize-input,json-output,timeout}` → `@/lib/model/...`。
- **相对路径**：按新旧深度重算。注意两条相反的：
  - `sanitize-input`：`lib/agent/` → `lib/model/`，**深度不变**，它引的 `../core/log-context` 照旧。
  - `usage`/`tool`：`lib/` 根 → `lib/model/stats/`，**深了两层**，引的 `./core/db/repo` 要变 `../../core/db/repo`。

**循环修正直到 `pnpm typecheck` 输出为空。**

- [ ] **Step 4: 手工检查 typecheck 抓不到的引用**

```bash
grep -rnE "(tools/embed|usage-stats|tool-stats|plugins/manager|agent/(sanitize-input|json-output|timeout))" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' --include='*.js' \
  app lib components tests plugins scripts instrumentation.ts proxy.ts next.config.ts ecosystem.config.cjs components.json \
  | grep -v "lib/model/"
```

Expected: 无输出。逐个修正。

**特别检查 `vi.mock`**（它们是字符串，typecheck 不看）：

```bash
grep -rn 'vi.mock("@/lib/\(tools/embed\|usage-stats\|tool-stats\|plugins/manager\|agent/\)' --include='*.ts' tests
```

Expected: 无输出（全部已改到 `@/lib/model/...`）。

同时查注释里的路径引用：

```bash
grep -rnE "^\s*(//|\*|/\*)" --include='*.ts' lib app | grep -E "tools/embed|usage-stats|tool-stats|plugins/manager"
```

- [ ] **Step 5: 确认目录结构**

```bash
ls lib/model/ lib/model/stats/ lib/model/plugins/
ls lib/tools/ lib/plugins/ 2>&1
ls lib/agent/ | wc -l
```

Expected：`lib/model/` 含 `sanitize-input.ts json-output.ts timeout.ts embed.ts stats/ plugins/`；`lib/tools/` 只剩 `kb.ts`；`lib/plugins/` 报 `No such file or directory`；`lib/agent/` 从 23 个降到 **20 个**。

- [ ] **Step 6: 同步镜像测试目录**

`docs/development.md` 要求测试镜像源码目录。要搬的（**7 个都存在**）：

```bash
mkdir -p tests/lib/model/stats tests/lib/model/plugins
git mv tests/lib/agent/sanitize-input.test.ts tests/lib/model/sanitize-input.test.ts
git mv tests/lib/agent/json-output.test.ts tests/lib/model/json-output.test.ts
git mv tests/lib/agent/timeout.test.ts tests/lib/model/timeout.test.ts
git mv tests/lib/tools/embed.test.ts tests/lib/model/embed.test.ts
git mv tests/lib/usage-stats.test.ts tests/lib/model/stats/usage.test.ts
git mv tests/lib/tool-stats.test.ts tests/lib/model/stats/tool.test.ts
git mv tests/lib/plugins/manager.test.ts tests/lib/model/plugins/manager.test.ts
```

**注意**：`tests/lib/plugins/` 下还有 `route.test.ts` 与 `id-route.test.ts`（测的是 `app/api/plugins/*`），**留在原地**。`tests/lib/tools/` 下还有 `tools.test.ts`（测 `lib/tools/kb.ts`），也留着。别整目录搬。

测试多用 `@/` 别名，预期零 import 改动；有相对路径报错就逐个修。

- [ ] **Step 7: 跑测试与类型检查**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；vitest **92 文件 / 972 用例**全过（只搬位置、不增删测试）。

**`tests/architecture/layering.test.ts` 预计会红**（映射表还指着旧路径，且新位置 `lib/model/` 尚无规则）—— 那是 **Task 2 的范围，本任务不要改它**。记下哪几个用例红了即可。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "refactor(model): 模型基座文件迁入 lib/model

sanitize-input/json-output/timeout 原在 lib/agent/ 与编排逻辑混放,
embed 与 stats 类原在 lib/ 根与 lib/tools/,plugins/manager 原在
lib/plugins/。这些是「怎么调模型」而非「会话怎么走」,归到独立的
model 层。零行为改动,约 23 行 import 改写,测试目录同步镜像。"
```

## Task 2: 同步护栏与文档

**Files:**
- Modify: `tests/architecture/layering.test.ts`
- Modify: `docs/development.md`

- [ ] **Step 1: 在 `PREFIX_RULES` 里新增 model 的目录规则**

`lib/model/` 是**新目录**，必须有规则，否则搬过去的文件全部「未归层」：

```ts
  // model
  ["lib/model/", "model"],
```

放在现有 model 精确规则之前或之后均可（都是 `model` 层，无顺序敏感问题），但**必须在 `["lib/core/", "core"]` 等其它层规则之外独立列出**。

- [ ] **Step 2: 删掉 7 条已死的精确规则**

```ts
  ["lib/agent/sanitize-input.ts", "model"],
  ["lib/agent/json-output.ts", "model"],
  ["lib/agent/timeout.ts", "model"],
  ["lib/tools/embed.ts", "model"],
  ["lib/usage-stats.ts", "model"],
  ["lib/tool-stats.ts", "model"],
  ["lib/plugins/manager.ts", "model"],
```

（先在文件里找到确切写法再删。）`["lib/agent/", "conversation"]` **保留** —— `lib/agent/` 还有 20 个文件。

- [ ] **Step 3: 把这 7 条旧路径登记进 `RETIRED_PREFIXES`（共 28 项）**

**目录与精确文件都要登记，不做区分**（阶段 2a 证伪过一次，别重犯）。注意 `lib/plugins/` 这个**目录**也要登记（它整个消失了），`lib/tools/` **不登记**（`kb.ts` 还在）。

现有 21 项 + 本阶段 7 项精确 + 1 项目录 = **29 项**。请自己数一遍，以实际为准。

- [ ] **Step 4: 更新那条「父目录规则与自身层别不同」的钉子**

该钉子枚举了 7 个文件，其中 **3 个在本阶段搬走了**：

```ts
      ["lib/agent/sanitize-input.ts", "model"],
      ["lib/agent/json-output.ts", "model"],
      ["lib/agent/timeout.ts", "model"],
```

它们现在住在 `lib/model/` 下、由 `["lib/model/", "model"]` 这条**同层目录规则**覆盖，不再是「父目录规则与自身层别不同」，**必须从枚举里删掉**。（这正是上一阶段审查提醒的维护点。）

**保留**那 4 条 knowledge 的（`kb-prefetch`、`reflection-poller`、`reflection-compactor`、`reflection-promoter`）—— 它们仍在 `lib/agent/` 下、父目录规则仍是 `conversation`，阶段 4 才搬。

- [ ] **Step 5: 更新分类钉子用例**

`expect(layerOf("lib/tools/embed.ts")).toBe("model")` 改为：

```ts
    expect(layerOf("lib/model/embed.ts")).toBe("model")
```

**这条必须改**：`lib/tools/embed.ts` 已不存在，删掉那条精确规则后 `layerOf("lib/tools/embed.ts")` 会返回 `null`，断言会红。其余钉子逐条核对是否受影响（`lib/tools/kb.ts` 仍在 `lib/tools/`，不受影响）。

- [ ] **Step 6: 更新 `CURRENT_STAGE` 与 `STAGE_ORDER`**

阶段 3 拆成了 3a（搬迁）与 3b（切分），所以要把 `"3"` 拆成 `"3a"`、`"3b"`：

```ts
const CURRENT_STAGE = "3a"
const STAGE_ORDER = ["0", "1", "2a", "2b", "3a", "3b", "4", "5", "6"]
```

**同时把 `TOLERATED` 三条的 `removedBy` 从 `"3"` 改成 `"3b"`。**

理由：那三条边是 `lib/agent/reflection-{compactor,poller,promoter}.ts` → `lib/agent/agent.ts`（knowledge → conversation）。消除它们的是设计文档阶段 3 那一行里的「`reflection-*` 改指 `model/`」——那属于 **3b**（从 `agent.ts` 切出 model 模块），不是 3a。

改完后 `indexOf("3b") = 5 > indexOf("3a") = 4`，「没有早该消失的容忍条目」仍是空的 ✓（3b 阶段才该翻转）。

- [ ] **Step 7: 跑测试并做反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 全绿（用例数：上一阶段是 9，本阶段若未增删用例则仍是 9）。

反向验证（**必须真做**）：临时建 `lib/tools/embed.ts`（内容随意），跑测试，应看到「已退役前缀没有任何文件命中」**失败**；然后**完整删掉**该文件，复跑恢复全绿，确认 `git status` 干净。

- [ ] **Step 8: 更新 `docs/development.md` 与 `CLAUDE.md`**

**（1）`CLAUDE.md` 的「仓库结构」一节。** 它现在写着 `lib/`（核心：… 、`tools/` 嵌入+KB、`plugins/`）。本阶段 `lib/plugins/` 整个消失、`lib/tools/` 只剩 `kb.ts`，所以要改成反映 model 层：

- 把 `plugins/` 从 `lib/` 的括号里**去掉**（注意：别碰**顶层**那个 `plugins/`（`cs`/`packyapi` 本地 MCP server），它是另一个东西，仍在）
- 加上 `model/` 模型基座
- `tools/` 仍在（还有 `kb.ts`），阶段 4 才删

**（2）`docs/development.md` 的「待改写条目」表。** 标阶段 3 的那行是 `| CLAUDE.md 的「仓库结构」一节里的 tools/、plugins/ 项 | 3 |`。本阶段只消掉了一半（`plugins/`），`tools/` 要到阶段 4 —— 所以**不能整条删**，改写成只剩 `tools/`，阶段标记改为 `4`：

```markdown
| `CLAUDE.md` 的「仓库结构」一节里的 `tools/` 项（`lib/tools/` 迁往 `lib/model/` 与 `lib/knowledge/`） | 4 |
```

**（3）** 若别处提到这 7 个文件的旧路径，一并改。

复核：

```bash
grep -n "tools/embed\|usage-stats\|tool-stats\|plugins/manager\|agent/sanitize-input\|agent/json-output\|agent/timeout" docs/development.md CLAUDE.md
grep -n "lib/plugins\|lib/tools" docs/development.md CLAUDE.md
```

Expected: 第一条无输出；第二条只应命中**顶层** `plugins/`（`cs`/`packyapi`）或 `lib/tools/` 的说明，**不应**再有把 `plugins/` 当作 `lib/` 子目录的写法。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "refactor(arch): 同步护栏映射表与文档的 model 路径

新增 lib/model/ 目录规则;7 条旧精确规则移入 RETIRED_PREFIXES,
lib/plugins/ 目录一并登记;那条「父目录规则与自身层别不同」的钉子里
3 个模型文件已随搬迁脱离该场景,从枚举中移除。"
```

## Task 3: 全量验证

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出；eslint 0 error（1 条 `tests/lib/ranking-route.test.ts` 的既有 warning）；vitest **92 文件 / 972 用例**全过（本阶段不增删测试）。

- [ ] **Step 2: 目录结构**

```bash
ls lib/model/ lib/model/stats/ lib/model/plugins/
ls lib/tools/ 2>&1
ls lib/plugins/ 2>&1
ls lib/agent/ | wc -l
```

Expected: `lib/plugins/` 不存在；`lib/tools/` 只剩 `kb.ts`；`lib/agent/` 20 个。

- [ ] **Step 3: 零行为改动取证**

```bash
git diff -M main..HEAD --numstat -- lib/ app/ components/ plugins/ scripts/ components.json | awk '$1==0 && $2==0 {print "RENAME  "$3}'
git diff -M main..HEAD -- lib/ app/ components/ plugins/ scripts/ components.json | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
```

Expected: 生产侧「既非 import 也非注释」的行数为 **0**（阶段 2a/2b 用过的判据）。**逐行核对，不要只靠脚本** —— 阶段 2b 的验证者发现自动过滤口径过宽会误吞。

- [ ] **Step 4: 旧路径残留**

```bash
grep -rnE "(tools/embed|usage-stats|tool-stats|plugins/manager|agent/(sanitize-input|json-output|timeout))" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' app lib components tests plugins scripts instrumentation.ts proxy.ts next.config.ts ecosystem.config.cjs components.json \
  | grep -v "lib/model/"
```

Expected: 无输出（`tests/architecture/layering.test.ts` 里的退役登记除外，如实列出并说明）。

- [ ] **Step 5: 护栏状态与反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "CURRENT_STAGE\|STAGE_ORDER" tests/architecture/layering.test.ts
sed -n '/^const RETIRED_PREFIXES/,/^]/p' tests/architecture/layering.test.ts | grep -c '"lib/'
```

Expected: 全绿；`CURRENT_STAGE` 与 `STAGE_ORDER` 已按 Task 2 Step 6 更新；`RETIRED_PREFIXES` 条数与 Task 2 一致。

反向验证：临时建 `lib/tools/embed.ts` → 应让「已退役前缀没有任何文件命中」失败 → **完整删掉** → 复跑全绿 → `git status` 干净。

- [ ] **Step 6: 工作区**

```bash
git status --short
```

Expected: 无输出。

本任务不产生新提交。若 Step 1–6 全部符合 Expected，阶段 3a 即可收口。
