# 模块化分层重构 · 阶段 2a（core 地基）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `lib/db/`、`lib/config/` 与 11 个**设施类**根文件迁入新建的 `lib/core/`，使 `lib/` 根目录的设施文件清空。

**注意终态与中间态的差别**：本阶段结束后 `lib/` 根目录仍会有 `events.ts`、`name-cache.ts`、`name-cache-store.ts`、`group-name.ts`、`kb-path.ts`、`reflect-promote.ts`、`reflect-stats.ts`、`tool-stats.ts`、`usage-stats.ts`、`transcript.ts`、`assemble.ts` 与 `runtime.ts`。「根目录只剩 `runtime.ts`」是整个重构（阶段 4 结束）的终态，**不是本阶段的验收标准**。

**Architecture:** 大规模机械路径改写：约 198 行 import 需要改。与阶段 1 不同，本阶段**不手写替换清单**——先 `git mv` 全部文件，再让 `pnpm typecheck` 逐条报出失效引用并修正。理由：漏改的引用 typecheck 一定会报，而手写 198 条替换的错误率更高。零行为改动：除 import 语句外不改任何内容。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（见「目标结构」与「迁移阶段」表第 2a 行）

## Global Constraints

- **零行为改动。** 除 import 语句外，任何文件的内容一字不动。没有例外，本阶段（与阶段 3 不同）**不切分任何文件**，只搬。
- **不写兼容 shim。** 旧路径一律不保留 re-export。
- **分支**：`refactor/stage2a-core`，从 `main` 切出。不直接提交 main，**不 push**。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**：仓库在 main 上有 41 个存量文件不符合 prettier，直接跑会产生巨大的无关 diff。只对自己改过的文件跑 `prettier --write`。
- **包管理器用 `pnpm`**，不用 `npx`。

## 搬迁清单

**两个目录整体搬迁：**

| 从 | 到 |
| --- | --- |
| `lib/db/`（含 `migrations/`、`repositories/` 等全部子目录） | `lib/core/db/` |
| `lib/config/` | `lib/core/config/` |

**11 个根目录文件搬迁**（`lib/` → `lib/core/`）：
`api.ts`、`app-context.ts`、`auth.ts`、`brand.ts`、`bus.ts`、`concurrency.ts`、`config-store.ts`、`log-context.ts`、`logger.ts`、`settings-writer.ts`、`utils.ts`

**迁完后 `lib/` 根目录只剩**：`runtime.ts`

**不搬的（后续阶段处理）：** `lib/agent/`、`lib/channels/`、`lib/tools/`、`lib/plugins/`、`lib/onebot/`（已不存在）、以及 `lib/events.ts`、`lib/name-cache.ts`、`lib/name-cache-store.ts`、`lib/group-name.ts`、`lib/kb-path.ts`、`lib/reflect-*.ts`、`lib/tool-stats.ts`、`lib/usage-stats.ts`、`lib/assemble.ts`、`lib/transcript.ts`。

## 影响面（约 198 行 import，按目标路径分）

| 被引用的路径 | 引用次数 |
| --- | --- |
| `lib/db/`（含 `db/repo`、`db/index`、`db/repositories/*` 等） | 83 |
| `lib/utils` | 44 |
| `lib/bus` | 35 |
| `lib/api` | 29 |
| `lib/app-context` | 23 |
| `lib/logger` | 20 |
| `lib/config-store` | 19 |
| `lib/config/` | 14 |
| `lib/brand` | 12 |
| `lib/log-context` | 9 |
| `lib/settings-writer` | 3 |
| `lib/concurrency` / `lib/auth` | 各 2 |

引用形式混用：别名导入（`@/lib/...`）与相对路径导入（`./`、`../`）都有，**两种都要改**——别名要插入 `core/`，相对路径要按新深度重新计算。

上方那张表的数字是**按目标路径分组的出现次数**，含少量非 import 的命中（注释、字符串、JSON 别名），用于估计规模。**实际被改写的 import 行数是 304**（阶段 2a 实测）。别把上表求和当成必须改的行数，否则会误判「漏改」。

**代码之外还有两类引用，typecheck 抓不到，必须手工检查**（详见 Task 1 Step 4）：
- `instrumentation.ts`：6 处 `await import("./lib/...")` 相对路径
- `scripts/*.ts`：`../lib/db/...`、`../lib/tools/embed.ts` 等

## Task 1: 搬迁 core 地基

**Files:**
- Move: `lib/db/` → `lib/core/db/`；`lib/config/` → `lib/core/config/`；11 个根目录文件 → `lib/core/`
- Modify: 全部引用上述路径的文件（约 80 个）

- [ ] **Step 1: 新建分支并确认起点干净**

```bash
git checkout main
git status --short          # 必须无输出
git checkout -b refactor/stage2a-core
```

- [ ] **Step 2: 搬两个目录与 11 个文件**

```bash
mkdir -p lib/core
git mv lib/db lib/core/db
git mv lib/config lib/core/config
git mv lib/api.ts lib/core/api.ts
git mv lib/app-context.ts lib/core/app-context.ts
git mv lib/auth.ts lib/core/auth.ts
git mv lib/brand.ts lib/core/brand.ts
git mv lib/bus.ts lib/core/bus.ts
git mv lib/concurrency.ts lib/core/concurrency.ts
git mv lib/config-store.ts lib/core/config-store.ts
git mv lib/log-context.ts lib/core/log-context.ts
git mv lib/logger.ts lib/core/logger.ts
git mv lib/settings-writer.ts lib/core/settings-writer.ts
git mv lib/utils.ts lib/core/utils.ts
```

- [ ] **Step 3: 让 typecheck 驱动修复 import**

```bash
pnpm typecheck 2>&1 | head -50
```

会产生大量 `Cannot find module` 错误。**逐条修正**，规则如下：

**别名导入**（`@/lib/...`）：在 `lib/` 之后插入 `core/`。
- `@/lib/db/repo` → `@/lib/core/db/repo`
- `@/lib/utils` → `@/lib/core/utils`
- `@/lib/config-store` → `@/lib/core/config-store`

**相对导入**（`./` 或 `../`）：按引用方的新位置与目标的新位置重新计算。
- 引用方**没搬**、目标**搬了**：插入 `core/`。例如 `lib/agent/session.ts` 里的 `../db/repo` → `../core/db/repo`；`lib/channels/tg/client.ts` 里的 `../../bus` → `../../core/bus`。
- 引用方**搬了**、目标**也搬了**：通常不变（两者一起移动，相对位置不变）。例如 `lib/core/logger.ts` 里的 `./bus` 仍是 `./bus`。
- 引用方**搬了**、目标**没搬**：深度变化。例如 `lib/core/app-context.ts` 里的 `./db/repo` 仍是 `./db/repo`（两者都进了 core）；但若它引用 `lib/channels/enabled-chats`，要写成 `../channels/enabled-chats`。

**循环修正直到 `pnpm typecheck` 输出为空。** 不要试图一次改完——边改边跑，让编译器告诉你还剩什么。

- [ ] **Step 4: 手工检查 typecheck 抓不到的引用**

这几类不是 TypeScript 的模块解析，typecheck 与分层测试都看不见：

```bash
grep -rn "lib/db\|lib/config\|lib/bus\|lib/logger\|lib/log-context\|lib/app-context\|lib/config-store\|lib/auth\|lib/settings-writer\|lib/concurrency\|lib/utils\|lib/brand\|lib/api" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' --include='*.js' \
  instrumentation.ts proxy.ts scripts plugins next.config.ts ecosystem.config.cjs 2>/dev/null
```

Expected: 无输出（全部改完）。逐个修正发现的问题。已知需要改的：
- `instrumentation.ts`：6 处 `await import("./lib/...")`
- `scripts/ingest.ts`：`../lib/db/index.ts`、`../lib/db/repo.ts`（`../lib/tools/embed.ts` 本阶段不动）
- `scripts/db-maintenance.ts`：`../lib/db/backup.ts`
- `proxy.ts`：`@/lib/auth` → `@/lib/core/auth`

同时 grep 注释里的路径引用（不会报错，只会腐烂）：

```bash
grep -rn "lib/db\|lib/config-store\|lib/utils" --include='*.ts' lib app | grep -E "^\S+:[0-9]+:\s*(//|\*|/\*)"
```

逐条修正为新的 `lib/core/...` 路径。

- [ ] **Step 5: 确认 `lib/` 根目录只剩 runtime.ts**

```bash
ls lib/*.ts
```

Expected: 输出**只有** `lib/runtime.ts`。

（若还有 `events.ts`、`name-cache.ts`、`group-name.ts`、`kb-path.ts`、`reflect-promote.ts`、`reflect-stats.ts`、`tool-stats.ts`、`usage-stats.ts`、`assemble.ts`、`transcript.ts`——那说明本阶段搬多了或没搬完。这些是**后续阶段 2b/3/4** 的目标，本阶段应保持原样。）

- [ ] **Step 6: 跑测试与类型检查**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；测试 **92 文件 / 970 用例**全过。

**注意会红的测试**：`tests/architecture/layering.test.ts` 的「lib 下每个文件都归属于某一层」——因为 `lib/core/db/` 等路径的映射规则已存在（`["lib/core/", "core"]`），但**旧的 `lib/db/`、`lib/config/`、以及 11 个精确文件规则仍然在表里**。这些是**死规则**，不会让它变红（守旧路径没有文件了）。真正会红的是**新路径下未归层的文件**——但 `lib/core/` 已经覆盖了。

若该测试红了，**不要在这里改它**——那是 Task 2 的范围。先只确认红的是哪些用例，记录下来。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor(core): db/config 与根目录设施迁入 lib/core

lib/ 根目录此前散着 11 个设施文件与 db/ config/ 两个目录,与
agent/ channels/ tools/ 这些业务域并列,看不出谁是谁的地基。
迁入 core/ 后 lib/ 根只剩 runtime.ts(组合根)。

零行为改动:约 198 行 import 路径改写,无一行逻辑变更。漏改的引用
由 typecheck 兜底,代码之外的相对路径(instrumentation.ts、scripts)
与注释路径另行手工核对。"
```

## Task 2: 同步护栏映射表与文档

**Files:**
- Modify: `tests/architecture/layering.test.ts`
- Modify: `docs/development.md`

**为什么必须做：** 搬完后 `layering.test.ts` 里旧路径的规则全部变成**死规则**（指向不存在的文件），而测试**察觉不到**。不同步的话护栏会悄悄退化。本任务是 spec 风险节里记下的「护栏映射表会随搬迁变脏」的正面处理。

- [ ] **Step 1: 先记录当前状态**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "lib/db/\|lib/config/\|lib/bus.ts\|lib/utils.ts\|lib/logger.ts" tests/architecture/layering.test.ts
```

记录哪些规则已成死规则。

- [ ] **Step 2: 改 `PREFIX_RULES`**

1. **删掉**这些已死的**目录规则**：

```ts
  ["lib/db/", "core"],
  ["lib/config/", "core"],
```

2. **删掉**这些已死的**精确文件规则**（11 个，逐条核对文件里的实际写法后删除）：`lib/api.ts`、`lib/app-context.ts`、`lib/auth.ts`、`lib/brand.ts`、`lib/bus.ts`、`lib/concurrency.ts`、`lib/config-store.ts`、`lib/log-context.ts`、`lib/logger.ts`、`lib/settings-writer.ts`、`lib/utils.ts`。

3. `["lib/core/", "core"]` 这条**已经在表里**（阶段 0 预留），它现在开始真正生效，覆盖 `lib/core/` 下的一切。**不需要新增规则。**

- [ ] **Step 3: 登记退役前缀**

```ts
const RETIRED_PREFIXES: string[] = [
  "lib/onebot/",
  "lib/db/",
  "lib/config/",
  "lib/bus.ts",
  "lib/logger.ts",
  "lib/log-context.ts",
  "lib/app-context.ts",
  "lib/config-store.ts",
  "lib/auth.ts",
  "lib/settings-writer.ts",
  "lib/concurrency.ts",
  "lib/utils.ts",
  "lib/brand.ts",
  "lib/api.ts",
]
```

（`RETIRED_PREFIXES` 用的是 `startsWith`，所以精确文件路径也能这样登记。阶段 1 登记的那条 `lib/onebot/` 保留。）

- [ ] **Step 4: 新增「精确文件规则必须命中真实文件」的断言**

这是 spec 风险节里记下的缺口：精确文件规则一旦指向不存在的文件就**完全不可见**（不产生假 PASS，但污染映射表）。本阶段新增大量精确规则的删除，正是补这条断言的时候。

在 `describe("分层结构契约", ...)` 里新增一个用例：

```ts
  it("每条精确文件规则都命中真实存在的文件", () => {
    const exactRules = PREFIX_RULES.filter(([p]) => !p.endsWith("/"))
    const files = new Set(
      listFiles(LIB_DIR).map((abs) => relative(REPO_ROOT, abs))
    )
    const dead = exactRules
      .map(([p]) => p)
      .filter((p) => !files.has(p))
    expect(dead).toEqual([])
  })
```

（只查精确文件规则；目录规则可能合法地空着，不查。`listFiles` 已在文件里定义。）

- [ ] **Step 5: 更新 `CURRENT_STAGE`**

```ts
const CURRENT_STAGE = "2a"
```

`STAGE_ORDER` 里已有 `"2a"` 这一项，无需改动。

- [ ] **Step 6: 改掉自检用例与分类钉子里会失效的路径**

**这一步不做的话测试会红。** 那个「扫描管线能识别逆向依赖」的自检用例用**合成路径**当输入，而这些路径本身也受本次搬迁影响：

`collectViolations(fromRel, source)` 的第一件事是 `layerOf(fromRel)`，取不到层就直接返回 `[]`。删掉 `["lib/config/", "core"]` 之后，`layerOf("lib/config/chats.ts")` 返回 `null`，于是三条 `toEqual([expectEdge])` 断言全部**误红**（拿到 `[]`）。同理，分类钉子用例里的 `expect(layerOf("lib/config/chats.ts")).toBe("core")` 也会红。

改法（注意：改了源路径，**相对 import 也要跟着改**，否则解析到的目标会变）：

```ts
    const expectEdge = "lib/core/config/chats -> lib/channels/qq/client"
    // 静态 import
    expect(
      collectViolations(
        "lib/core/config/chats.ts",
        `import { OneBotClient } from "../../channels/qq/client"`
      )
    ).toEqual([expectEdge])
    // 动态 import
    expect(
      collectViolations(
        "lib/core/config/chats.ts",
        `const m = await import("../../channels/qq/client")`
      )
    ).toEqual([expectEdge])
    // require
    expect(
      collectViolations(
        "lib/core/config/chats.ts",
        `const m = require("../../channels/qq/client")`
      )
    ).toEqual([expectEdge])
    // 合法方向不报
    expect(
      collectViolations(
        "lib/tools/kb.ts",
        `import { x } from "../core/db/kb-sql"`
      )
    ).toEqual([])
```

要点：`lib/core/config/chats.ts` 的目录是 `lib/core/config`，所以到 `lib/channels/qq/client` 要上**两层**（`../../`）。改完后 `../../channels/qq/client` 解析为 `lib/channels/qq/client` → channels 层，core → channels 判为逆向 ✓。

分类钉子用例里那一条改为：

```ts
    expect(layerOf("lib/core/config/chats.ts")).toBe("core")
```

**其余 6 条钉子不动**（`lib/channels/types.ts`、`lib/channels/qq/members-fetch.ts`、`lib/tools/embed.ts`、`lib/tools/kb.ts`、`lib/agent/agent.ts`、`lib/runtime.ts` 都不受本阶段影响）。

- [ ] **Step 7: 跑测试并做反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 8 个用例全绿（原 7 个 + 新增 1 个）。

**反向验证新增的那条断言不是摆设**：临时在 `PREFIX_RULES` 里加一条指向不存在文件的精确规则（例如 `["lib/nonexistent.ts", "core"]`），跑测试，应看到「每条精确文件规则都命中真实存在的文件」**失败**并列出该路径；然后删掉它，复跑恢复全绿，确认 `git status` 干净。

- [ ] **Step 8: 更新 `docs/development.md`**

`docs/development.md` 的「模块边界」一节与「待改写条目」表都提到 `lib/config/schema.ts`、`lib/config/{env,migrate,chats,patch}.ts`、`lib/config-store.ts`、`lib/db/repositories/`、`lib/db/migrations/` 这些路径，以及 `docs/data-access.md`、`docs/database-operations.md` 里的对应引用。

**按设计文档「既有引用同步」表里阶段 2a 那一行执行**（见 `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`）：
- `docs/development.md` 的「模块边界」里那五条路径 → 加 `core/`
- `docs/data-access.md` 里「以上路径相对于 `lib/db/`」与 `lib/db/index.ts` 的引用 → 加 `core/`
- `docs/database-operations.md` 里 `lib/db/migrations/registry.ts` 与 `lib/db/index.ts` 的引用 → 加 `core/`
- `CLAUDE.md` 的「仓库结构」一节的 `db/` 项 → `core/db/`

**不要写字面行号**（设计文档已明令）。改完后把「待改写条目」表里已完成的 2a 那一行**删除**——它的使命结束了，留着就是新的腐烂源。

- [ ] **Step 9: 提交**

```bash
git add tests/architecture/layering.test.ts docs/development.md docs/data-access.md docs/database-operations.md CLAUDE.md
git commit -m "refactor(arch): 同步护栏映射表并改写在库文档中的 lib/db 路径

旧路径规则搬完即成死规则而测试察觉不到,已从映射表移除并登记进
RETIRED_PREFIXES。新增「精确文件规则必须命中真实文件」断言,补上
spec 风险节记录的静默缺口。文档里的 lib/db、lib/config 引用同步
加 core/,并删除已完成的 2a 待改写条目。"
```

## Task 3: 测试目录对齐源码结构

**Files:**
- Move: `tests/lib/db/` → `tests/lib/core/db/`；`tests/lib/config/` → `tests/lib/core/config/`；以及 11 个设施文件对应的测试

**为什么必须做：** `docs/development.md` 明写「测试放在 `tests/`，镜像源码目录」。Task 1 把源码搬进了 `lib/core/`，但测试还留在 `tests/lib/`，镜像关系断了 —— 那份文档立刻开始说谎，而这正是本次重构要消灭的东西。

阶段 1 没暴露这条，是因为它只在同深度内搬（`lib/onebot/` → `lib/channels/qq/`），镜像恰好自动成立。本阶段新增了 `core/` 这一层，必须在测试侧同样新增。

- [ ] **Step 1: 搬两个目录**

```bash
mkdir -p tests/lib/core
git mv tests/lib/db tests/lib/core/db
git mv tests/lib/config tests/lib/core/config
```

- [ ] **Step 2: 搬 11 个设施文件对应的测试**

先确认哪些存在（不是每个源文件都有测试）：

```bash
ls tests/lib/{api,app-context,auth,brand,bus,concurrency,config-store,log-context,logger,settings-writer,utils}.test.ts 2>/dev/null
```

把**存在的**逐个 `git mv` 到 `tests/lib/core/`，例如：

```bash
git mv tests/lib/api.test.ts tests/lib/core/api.test.ts
git mv tests/lib/app-context.test.ts tests/lib/core/app-context.test.ts
# …其余按 ls 结果逐个执行
```

- [ ] **Step 3: 跑测试并修正失效的导入**

```bash
pnpm vitest run
```

Expected: **92 文件 / 971 用例**全过。

测试多数用 `@/lib/...` 别名导入，所以很可能**一条 import 都不用改**。但有少数可能用相对路径（如 `../../lib/db/...`），typecheck 与 vitest 会报出来，逐个修正。

**注意**：`tests/architecture/layering.test.ts` 的「lib 下每个文件都归属于某一层」只扫 `lib/`，不受测试目录搬迁影响。

- [ ] **Step 4: 更新文档里的测试路径举例**

`docs/development.md` 与 `CLAUDE.md` 里可能有举例的测试路径。检查：

```bash
grep -rn "tests/lib/" docs/*.md CLAUDE.md
```

把指向**本次搬走的**测试文件路径改到新位置（例如 `tests/lib/db/repo.test.ts` → `tests/lib/core/db/repo.test.ts`）。**注意**：`docs/data-access.md` 里的 `tests/lib/db/transactions.test.ts` 也要一并改——之前 implementer 因为本阶段不含测试搬迁而保留了它，现在搬迁做了，它就过时了。

- [ ] **Step 5: 确认没有旧目录残留**

```bash
ls tests/lib/db tests/lib/config 2>&1
grep -rn "tests/lib/db\|tests/lib/config" --include='*.ts' --include='*.tsx' --include='*.md' tests docs CLAUDE.md
```

Expected: 两个 `ls` 报不存在；grep 无输出。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(test): 测试目录镜像 lib/core 结构

docs/development.md 要求测试镜像源码目录,而 Task 1 把源码搬进了
lib/core/ 却没动测试,镜像关系断了。补上 core/ 这一层。多数测试
用 @/ 别名导入,故以 git mv 为主。"
```

## Task 4: 全量验证

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出；eslint 0 error（1 条 `tests/lib/ranking-route.test.ts` 的既有 warning 属 main 遗留）；vitest **92 文件 / 970 用例**全过。

**用例总数应为 971** —— 阶段 1 合并后基线是 970，加上 Task 2 新增的「每条精确文件规则都命中真实存在的文件」这一条，正好 +1。

若实测是 970，说明 Task 2 的 Step 4 没做；若是别的数字，说明有测试被误改或漏搬，停下报告。

- [ ] **Step 2: 确认 `lib/` 根目录只剩 runtime.ts**

```bash
ls lib/*.ts
```

Expected: 只有 `lib/runtime.ts`。其余根文件（`events.ts`、`name-cache.ts`、`group-name.ts` 等）是**后续阶段**的目标，仍在根目录属正常——但它们不应包含任何本阶段搬走的 11 个文件。

- [ ] **Step 3: 零行为改动取证**

```bash
git diff -M main..HEAD | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
```

把全部增删行过滤出来**逐行核对**。Expected: 全部是 import/from 语句、注释中的路径、文档内容、`git mv` 产生的 rename（rename 不出现在这种过滤结果里）。**零逻辑行。**

**注意**：`tests/architecture/layering.test.ts` 与各 `.md` 的改动是 Task 2 的授权范围，不算违反。若发现**任何业务逻辑行**（赋值、函数调用、条件、字符串常量、SQL）被改动，停下报告。

- [ ] **Step 4: 确认没有旧路径残留**

```bash
grep -rnE "(@/lib/|\.\.?/)(db|config)/(repo|index|backup|shared|context|repositories|migrations|schema|env|migrate|chats|patch)" --include='*.ts' --include='*.tsx' app lib components tests plugins scripts
grep -rn "lib/db\|lib/config" instrumentation.ts proxy.ts scripts next.config.ts ecosystem.config.cjs 2>/dev/null
```

Expected: 两条都无输出。（第一条若命中，多半是 `lib/core/db/...` 的正向引用——请确认前缀确实是 `lib/core/`。）

- [ ] **Step 5: 护栏映射表状态**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "CURRENT_STAGE" tests/architecture/layering.test.ts
grep -c "edge: \"lib/agent" tests/architecture/layering.test.ts
```

Expected: 8 个用例全绿；`CURRENT_STAGE` 为 `"2a"`；`TOLERATED` 仍恰为 3 条。

- [ ] **Step 6: 工作区**

```bash
git status --short
```

Expected: 无输出。

本任务不产生新提交。若 Step 1–6 全部符合 Expected，阶段 2a 即可收口。
