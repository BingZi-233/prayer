# 模块化分层重构 · 阶段 4b（conversation 层）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `lib/agent/` 剩下的 15 个文件与 `lib/assemble.ts`、`lib/transcript.ts` 迁入 `lib/conversation/`，`lib/agent/` 整个消失，**`lib/` 根目录只剩 `runtime.ts`**。另把 `introspect.ts` 归到 `lib/model/`（证据见下）。

**Architecture:** 纯搬迁 + 一次改名，约 54 行 import 改写。与前几阶段同法：先 `git mv`，再让 `pnpm typecheck` 驱动修正。

**为什么是最后一刀：** 搬完之后整套七阶段重构的「搬迁」部分就结束了 —— `lib/` 分五层（core / model / channels / knowledge / conversation）全部就位，根目录只剩组合根。阶段 5 是后台页面拆分，阶段 6 是收尾文档。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（「目标结构」`conversation/` 段与「迁移阶段」表第 4 行）

## Global Constraints

- **零行为改动。** 除 **（一）import 语句、（二）注释里指向本次搬迁路径的引用** 外，内容一字不动。本阶段**不切分任何文件**。
- **不写兼容 shim。** 旧路径一律不保留 re-export。
- **分支**：`refactor/stage4b-conversation`，从 `main` 切出。不直接提交 main，**不 push**。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**；也不要对本就不合 prettier 的存量文件跑 `--write`。
- 包管理器用 `pnpm`。

## 搬迁清单

**到 `lib/conversation/`（17 个）：**

`agent.ts`、`answerability.ts`、`command-keywords.ts`、`error-handler.ts`、`gateway.ts`、`handoff-handler.ts`、`intent.ts`、`message-buffer.ts`、`orchestrator.ts`、`prior-context.ts`、`reply-mapper.ts`、`resolution-recorder.ts`、`session.ts`、`topic-poller.ts`、`unanswered-poller.ts`（来自 `lib/agent/`），加上 `lib/assemble.ts`、`lib/transcript.ts`（来自 `lib/` 根）。

**到 `lib/model/`（1 个）：**

`lib/agent/introspect.ts` → `lib/model/introspect.ts`

> **为什么 `introspect.ts` 去 model 而不是跟着去 conversation**（设计文档的目标树原先把它放在 `conversation/`，那是错的）：
>
> - 它**直接用 `sdkQuery`** 探测模型能力，依赖 `model/tool-policy`（`isToolAllowed`/`TOOL_ALLOWLIST`）与 `model/sdk-env`（`sdkEnv`）—— 全部是模型基座；
> - 它的兄弟模块 `tool-policy` / `sdk-env` / `plugins/manager` **全在 `model/`**，同为「模型能用什么」这一族；
> - 它不参与任何会话流转，唯一消费者是 `app/api/capabilities/route.ts`（后台展示），与 `conversation/` 的编排无关。
>
> **本阶段要同时改设计文档的目标结构树**，把 `introspect.ts` 从 `conversation/` 行挪到 `model/` 行。

**搬完后：** `lib/agent/` **整个消失**；`lib/` 根目录只剩 `runtime.ts`。

## 影响面与深度变化

`lib/agent/*` 共约 51 行 import 引用（跨 app/lib/tests），`assemble`/`transcript` 另有 3 行。

**`lib/conversation/` 与 `lib/agent/` 同深度**，所以**大多数 import 不变**：
- 引用方在 `lib/` 其他目录（如 `lib/model/*`、`lib/knowledge/*`）的，`../agent/x` → `../conversation/x`（只换名字，深度不变）
- 引用方在 `lib/` 根（`runtime.ts`）的，`./agent/x` → `./conversation/x`
- **`lib/assemble.ts` → `lib/conversation/assemble.ts`**：它引的 `./agent/*` 全部变成同级 `./*`（因为它自己也进了 `conversation/`）；引的 `./knowledge/reflection/*` 变成 `../knowledge/reflection/*`（深一层）；引的 `./core/*` 变成 `../core/*`。**它是本次最需要注意的一个。**
- `lib/transcript.ts` 只引 `node:fs`/`node:path`，无变化。

**`typecheck` 覆盖不到的引用类型**（设计文档已列全）：`vi.mock` 字符串目标、运行时拼接路径、测试里的路径断言、配置文件别名、注释路径、仓库入口文件的相对导入。

## Task 1: 搬迁十八个文件

**Files:**
- Move: 上表 18 个文件
- Modify: 引用它们的文件（约 54 处 import）

- [ ] **Step 1: 新建分支并确认起点干净**

```bash
git checkout main
git status --short          # 必须无输出
git checkout -b refactor/stage4b-conversation
```

- [ ] **Step 2: 搬迁**

```bash
mkdir -p lib/conversation
git mv lib/agent/agent.ts lib/conversation/agent.ts
git mv lib/agent/answerability.ts lib/conversation/answerability.ts
git mv lib/agent/command-keywords.ts lib/conversation/command-keywords.ts
git mv lib/agent/error-handler.ts lib/conversation/error-handler.ts
git mv lib/agent/gateway.ts lib/conversation/gateway.ts
git mv lib/agent/handoff-handler.ts lib/conversation/handoff-handler.ts
git mv lib/agent/intent.ts lib/conversation/intent.ts
git mv lib/agent/message-buffer.ts lib/conversation/message-buffer.ts
git mv lib/agent/orchestrator.ts lib/conversation/orchestrator.ts
git mv lib/agent/prior-context.ts lib/conversation/prior-context.ts
git mv lib/agent/reply-mapper.ts lib/conversation/reply-mapper.ts
git mv lib/agent/resolution-recorder.ts lib/conversation/resolution-recorder.ts
git mv lib/agent/session.ts lib/conversation/session.ts
git mv lib/agent/topic-poller.ts lib/conversation/topic-poller.ts
git mv lib/agent/unanswered-poller.ts lib/conversation/unanswered-poller.ts
git mv lib/assemble.ts lib/conversation/assemble.ts
git mv lib/transcript.ts lib/conversation/transcript.ts
git mv lib/agent/introspect.ts lib/model/introspect.ts
rmdir lib/agent
```

- [ ] **Step 3: 让 typecheck 驱动修复 import**

```bash
pnpm typecheck 2>&1 | head -60
```

按上面「深度变化」分类处理。**循环修正直到 `pnpm typecheck` 输出为空。**

**特别留意 `lib/conversation/assemble.ts`** —— 它自己有 20 条 import，其中 `./agent/*` 要变同级 `./*`、`./knowledge/*` 要变 `../knowledge/*`、`./core/*` 要变 `../core/*`。

- [ ] **Step 4: 手工检查 typecheck 抓不到的引用**

```bash
grep -rn "lib/agent\|\.\./agent/\|\./agent/" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' --include='*.js' \
  app lib components tests plugins scripts instrumentation.ts proxy.ts next.config.ts ecosystem.config.cjs components.json \
  | grep -v "layering.test.ts"
```

Expected: 只剩**注释里**的引用（要改）或退役登记（在 `layering.test.ts` 里，已排除）。逐个修正。

**特别检查 `vi.mock` 与字符串路径：**

```bash
grep -rn 'vi.mock("@/lib/agent' --include='*.ts' tests
grep -rnE "join\(root, \"lib/agent" --include='*.ts' plugins scripts
```

Expected: 两条都无输出。

**并核两处已知的过期注释**（它们在别的层里引用 `lib/agent/agent.ts`）：

```bash
grep -rn "lib/agent/agent.ts" --include='*.ts' lib
```

Expected: `lib/model/timeout.ts` 与 `lib/model/stats/tool.ts` 各一处 —— 改成 `lib/conversation/agent.ts`。

同时查注释里的路径引用：

```bash
grep -rnE "^\s*(//|\*|/\*)" --include='*.ts' lib app | grep "lib/agent"
```

- [ ] **Step 5: 确认目录结构 —— 这是本阶段的里程碑**

```bash
ls lib/
ls lib/*.ts
ls lib/agent/ 2>&1
ls lib/conversation/ | wc -l
ls lib/model/introspect.ts
```

Expected：
- **`lib/*.ts` 只有 `runtime.ts` 一个** ← 设计里三条成功判据的第一条
- `lib/agent/` 报 `No such file or directory`
- `lib/conversation/` 含 17 个 `.ts`
- `lib/model/introspect.ts` 存在

- [ ] **Step 6: 同步镜像测试目录**

```bash
mkdir -p tests/lib/conversation
for f in agent answerability bypass-gating error-handler gateway handoff-handler intent message-buffer orchestrator prior-context session topic-poller unanswered-poller; do
  git mv "tests/lib/agent/$f.test.ts" "tests/lib/conversation/$f.test.ts"
done
git mv tests/lib/agent/introspect.test.ts tests/lib/model/introspect.test.ts
git mv tests/lib/assemble.test.ts tests/lib/conversation/assemble.test.ts
git mv tests/lib/transcript.test.ts tests/lib/conversation/transcript.test.ts
rmdir tests/lib/agent
```

⚠️ 说明：
- `tests/lib/agent/` 共 **14** 个测试（13 个去 conversation、1 个 `introspect.test.ts` 去 model）
- **`tests/lib/runtime.test.ts` 留在原地**（`lib/runtime.ts` 没搬）
- `tests/lib/core/brand.test.ts` 引 `@/lib/agent/{intent,answerability}` —— 改 import 即可，**文件不动**

- [ ] **Step 7: 跑测试与类型检查**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；vitest **96 文件 / 971 用例**全过（只搬位置、不增删测试）。

**`tests/architecture/layering.test.ts` 预计会红**（映射表还指着旧路径，且 `lib/conversation/` 尚无规则）—— 那是 **Task 2 的范围，本任务不要改它**。记下哪几个用例红了即可。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "refactor(conversation): 会话与编排迁入 lib/conversation

lib/agent/ 剩下的 15 个文件(编排、网关、会话、缓冲、重放等)与 lib/ 根的
assemble/transcript 迁入 conversation 层。搬完 lib/agent/ 目录消失,
lib/ 根只剩 runtime.ts —— 五层结构与组合根就此定型。

introspect.ts 改归 model/:它直接用 sdkQuery 探测模型能力、依赖
model 的 tool-policy 与 sdk-env,与 conversation 的编排无关(设计文档的
目标树原先把它放在 conversation,已同步订正)。

零行为改动,约 54 行 import 改写,测试目录同步镜像。"
```

## Task 2: 同步护栏与文档

**Files:**
- Modify: `tests/architecture/layering.test.ts`
- Modify: `docs/development.md`、`CLAUDE.md`、`docs/superpowers/specs/2026-09-10-modularize-layering-design.md`

> **护栏改动清单（六处，一处都不能漏）** —— 这是最后一次；做完 `lib/` 全部五层都对扫描可见。
>
> | # | 改动 |
> | --- | --- |
> | 1 | 新增 `["lib/conversation/", "conversation"]` |
> | 2 | 删 `["lib/agent/", "conversation"]` 与 `lib/transcript.ts`/`lib/assemble.ts` 的精确规则 |
> | 3 | 退役登记追加：目录 `lib/agent/` + `lib/agent/introspect.ts` + `lib/assemble.ts` + `lib/transcript.ts` |
> | 4 | 分类钉子 `lib/agent/agent.ts` → `lib/conversation/agent.ts`；并新增一条 `lib/model/introspect.ts` → `model` |
> | 5 | 刷新 `PREFIX_RULES` 注释里那条过期举例（4b 已在本次完成） |
> | 6 | `CURRENT_STAGE` → `"4b"` |

> **Task 1 质量审查开出的两处追加工作（本任务一并做）：**
>
> 1. **spec 的目标树还有一处被静默丢弃：`conversation/pollers/`。** spec 写的是
>    `pollers/{topic.ts,unanswered.ts}`（子目录 + 去掉 `-poller` 后缀），而实现与计划都平铺成了
>    `topic-poller.ts` / `unanswered-poller.ts`，**此前无人提及**。**选择实现它**（而非改 spec 删掉）：
>    spec 是已批准的设计，且 `model/stats/`（2 文件）与 `knowledge/reflection/`（5 文件）都用了子目录，
>    没有理由 2 个 poller 不配；`conversation/` 已有 17 个文件，划出一个内聚子组有帮助。
> 2. **补一条「层内环」检测。** 现有护栏只查**跨层**方向（比较 RANK），**层内环完全看不见** ——
>    而 `conversation/` 现在有 17 个文件。见下面的 Step 0。

- [ ] **Step 0: 把两个 poller 挪进子目录并改名**

```bash
mkdir -p lib/conversation/pollers
git mv lib/conversation/topic-poller.ts lib/conversation/pollers/topic.ts
git mv lib/conversation/unanswered-poller.ts lib/conversation/pollers/unanswered.ts
mkdir -p tests/lib/conversation/pollers
git mv tests/lib/conversation/topic-poller.test.ts tests/lib/conversation/pollers/topic.test.ts
git mv tests/lib/conversation/unanswered-poller.test.ts tests/lib/conversation/pollers/unanswered.test.ts
```

改引用（`pnpm typecheck` 会全找出来；大约 4~6 处，含 `lib/conversation/assemble.ts` 与 `lib/runtime.ts`）。

**并订正设计文档的目标结构树**：`conversation/` 段里 `pollers/{topic,unanswered}.ts` 保留（它本来就这么写），
但要把 `introspect.ts` 从 `conversation/` 行挪到 `model/` 行 —— **两处订正一起做**。

- [ ] **Step 1: 新增 `lib/conversation/` 的目录规则**

```ts
  // conversation(其余 agent/* 与两个装配模块)
  ["lib/conversation/", "conversation"],
```

**漏了它，搬过去的 17 个文件会全部「未归层」。**

- [ ] **Step 2: 删掉已死的规则**

- 目录规则 `["lib/agent/", "conversation"]`（`lib/agent/` 消失了）
- `["lib/transcript.ts", "conversation"]`、`["lib/assemble.ts", "conversation"]` 两条精确规则

- [ ] **Step 3: 登记退役前缀**

追加 **4 条**（目录与精确文件都要登记，不做区分）：
- 目录 `lib/agent/`（整个消失）
- `lib/agent/introspect.ts`（它去了 model，原路径退役）
- `lib/assemble.ts`
- `lib/transcript.ts`

**现有 38 项 + 4 项 = 42 项。** 请自己数一遍并在回报里给出实际条数。

- [ ] **Step 4: 更新分类钉子用例**

```ts
    expect(layerOf("lib/conversation/agent.ts")).toBe("conversation")
```

**并新增一条**（本阶段 introspect 改归 model 了）：

```ts
    expect(layerOf("lib/model/introspect.ts")).toBe("model")
```

其余各条逐条核对是否引用已搬走的路径。

- [ ] **Step 5: 刷新 `PREFIX_RULES` 注释里那条过期举例**

注释现在以「阶段 4b 会把 `lib/agent/agent.ts` 迁往 `lib/conversation/`」为例 —— **本阶段已经做了**。

**注意这次没有现成的替代例子了**：4b 之后目标结构是「一层一目录 + 根级只剩 `runtime.ts`」，而 `lib/runtime.ts` 是组合根（composition），它**物理位置与目标层恰好一致**。所以「按目标层而非物理位置判定」这条语义**在当前树里已无实例**。把注释改成一般化的表述（说明这条规则是为搬迁中途与未来而设），不要硬凑一个不成立的例子。

- [ ] **Step 6: 更新 `CURRENT_STAGE` 与 `STAGE_ORDER`**

```ts
const CURRENT_STAGE = "4b"
```

`STAGE_ORDER` 已经含 `"4b"`，不需改。

- [ ] **Step 6b: 补一条「层内环」检测**

现有护栏只比较 `RANK` 判**跨层**方向,**同层内的互相 import 形成环它看不见**。`conversation/` 现已有 17 个文件，未来引入环不会有任何信号。补一个用例：

```ts
  it("每层内部无循环 import", () => {
    const byLayer = new Map<Layer, Array<{ rel: string; deps: string[] }>>()
    for (const abs of listFiles(LIB_DIR)) {
      const rel = relative(REPO_ROOT, abs)
      const layer = layerOf(rel)
      if (!layer) continue
      const deps: string[] = []
      for (const m of readFileSync(abs, "utf8").matchAll(IMPORT_RE)) {
        const resolved = resolveSpecifier(abs, m[1])
        if (!resolved) continue
        if (layerAt(resolved) !== layer) continue
        deps.push(resolved)
      }
      const bucket = byLayer.get(layer) ?? []
      bucket.push({ rel: rel.replace(/\.tsx?$/, ""), deps })
      byLayer.set(layer, bucket)
    }

    const cycles: string[] = []
    for (const [layer, nodes] of byLayer) {
      const edges = new Map(nodes.map((n) => [n.rel, n.deps]))
      const state = new Map<string, 0 | 1 | 2>()
      const walk = (node: string, stack: string[]): void => {
        const st = state.get(node) ?? 0
        if (st === 2) return
        if (st === 1) {
          cycles.push(`${layer}: ${[...stack.slice(stack.indexOf(node)), node].join(" -> ")}`)
          return
        }
        state.set(node, 1)
        for (const next of edges.get(node) ?? []) {
          if (edges.has(next)) walk(next, [...stack, node])
        }
        state.set(node, 2)
      }
      for (const n of edges.keys()) walk(n, [])
    }
    expect(cycles).toEqual([])
  })
```

**注意**：`import type` 形成的边也算在内 —— 这是刻意的，因为**类型层双向引用同样会让后人误判依赖方向**（本项目已有一例：`core/chat/types.ts ↔ events.ts`）。**若这条新用例现在就是红的**，说明 `lib/` 里确有层内环：`core/chat/types.ts ↔ events.ts` 那一对是**已知且无害**的（两侧都是 `import type`，编译期擦除），把它记进一个如下的容忍清单后再跑：

```ts
// 已知的无害层内环：两侧都是 import type、编译期擦除；列出是为了让新增的环无处藏身
const TOLERATED_INTRA_CYCLES = ["core: lib/core/chat/events -> lib/core/chat/types -> lib/core/chat/events"]
```

然后断言改成 `expect(cycles.filter((c) => !TOLERATED_INTRA_CYCLES.some((t) => c.includes(t)))).toEqual([])`。
**清单里的条目要注明为什么无害**，且它**不应增长** —— 新增环先改代码而不是加清单。

- [ ] **Step 7: 跑测试并做反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 全绿。

反向验证（**真做，走真实磁盘文件**）：临时建 `lib/agent/probe.ts`（内容随意），跑测试，应看到「已退役前缀没有任何文件命中」**失败**；然后**完整删掉**该文件与空的 `lib/agent/` 目录，复跑恢复全绿，确认 `git status` 干净。

- [ ] **Step 8: 更新文档 —— 这是「待改写条目」表的最后一行**

- **`docs/development.md` 的「待改写条目」表**：本阶段完成后删除**最后一行**（那行讲 `agent/` 项与 `tests/lib/agent/session.test.ts`）。**整张表随之清空 —— 把表格连同「### 搬迁中：待改写条目」这个小节一起删掉**（使命结束，留着就是新的腐烂源）。同时把「分层结构」一节里那句「`lib/` 正分阶段搬到上述结构」的表述改成「已搬完」。
- **「模块边界」一节**：里面若有引用 `lib/agent/`、`lib/assemble.ts`、`lib/transcript.ts` 的路径，改到 `lib/conversation/…`。
- **`CLAUDE.md`**：
  - 「仓库结构」一节：`lib/` 括号里的 `agent/` agent+编排+反思循环 → `conversation/` 会话与编排（**注意「反思循环」那半已随 4a 迁往 `knowledge/`，一并去掉**）；加上 `knowledge/`
  - 「命令」一节举例的 `tests/lib/agent/session.test.ts` → `tests/lib/conversation/session.test.ts`
- **`README.md` 的「项目结构」一节（本阶段的意外发现，过去几个阶段一直漏改）**：
  它那块 `text` 代码块里的 `lib/` 条目**整体停留在重构前的样子**，四条里有三条是旧路径：

  ```text
  lib/agent/              Agent、会话编排、人工接管与后台循环     ← 已迁走（4b）
  lib/channels/           QQ / Telegram 通道抽象与适配器          ← 仍在
  lib/db/                 SQLite 数据访问、迁移与领域仓储          ← 2a 已迁往 core/db/
  lib/plugins/            插件生命周期管理                        ← 3a 已迁往 model/plugins/
  ```

  改成重构后的五层结构：

  ```text
  lib/core/               地基：SQLite 数据访问与迁移、配置、日志、事件总线、通道词汇
  lib/model/              模型基座：SDK 环境与 query options、工具白名单、prompt、用量计量
  lib/channels/           QQ / Telegram 通道抽象与适配器
  lib/knowledge/          知识库检索与反思链路（反思、压缩、升格）
  lib/conversation/       会话与编排：Agent、网关、缓冲区、人工接管、后台循环
  lib/runtime.ts          组合根：装配通道、Agent 与后台循环
  ```
- **设计文档**：把目标结构树里 `introspect.ts` 从 `conversation/` 行挪到 `model/` 行。

复核：

```bash
grep -rn "lib/agent\|lib/db/\|lib/plugins/\|lib/tools\|lib/onebot\|tests/lib/agent" \
  docs/development.md CLAUDE.md README.md docs/data-access.md docs/database-operations.md
```

Expected: 无输出（`lib/core/db/` 与 `lib/model/plugins/` 这类**新**路径不在模式内）。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "refactor(arch): 同步护栏与文档,搬完最后一刀

护栏六处同步:新增 lib/conversation/ 目录规则;lib/agent/ 与
transcript/assemble 的旧规则移入 RETIRED_PREFIXES(38→42);钉子改指
新家并补 introspect→model 一条。至此 lib/ 五层全部对扫描可见。

文档:待改写条目表连同小节一起删除(使命结束);CLAUDE.md 的仓库结构与
命令举例改到 conversation/;设计文档目标树里 introspect 挪到 model/。"
```

## Task 3: 全量验证

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出；eslint 0 error（1 条既有 warning）；vitest **96 文件 / 971 用例**全过。

- [ ] **Step 2: 里程碑 —— `lib/` 根只剩 runtime.ts**

```bash
ls lib/ lib/*.ts
ls lib/agent/ 2>&1
```

Expected: `lib/` 含五个目录 `channels/ core/ conversation/ knowledge/ model/` 与 `runtime.ts`；`lib/*.ts` **只有 `runtime.ts`**；`lib/agent/` 不存在。

**这是设计文档「目标」三条判据里的第一条**，在此确认。

- [ ] **Step 3: 零行为改动取证**

```bash
git diff -M main..HEAD --numstat -- lib/ app/ components/ plugins/ scripts/ components.json instrumentation.ts proxy.ts
git diff -M main..HEAD | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
```

Expected: 生产侧「既非 import 也非注释」的改动行数为 **0**。**逐行核对**，不要只靠脚本。

- [ ] **Step 4: 旧路径残留**

```bash
grep -rn "lib/agent\|\.\./agent/\|\./agent/" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' app lib components tests plugins scripts instrumentation.ts proxy.ts next.config.ts ecosystem.config.cjs components.json \
  | grep -v "layering.test.ts"
```

Expected: 无输出。

- [ ] **Step 5: 护栏状态与反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "CURRENT_STAGE\|STAGE_ORDER" tests/architecture/layering.test.ts
sed -n '/^const RETIRED_PREFIXES/,/^]/p' tests/architecture/layering.test.ts | grep -c '"lib/'
sed -n '/^const TOLERATED/,/^]/p' tests/architecture/layering.test.ts
```

Expected: 全绿；`CURRENT_STAGE = "4b"`；`RETIRED_PREFIXES` 恰 42 项；`TOLERATED` 空数组。

反向验证（**真做**）：建 `lib/agent/probe.ts` → 应红 → **完整删掉** → 复跑全绿 → `git status` 干净。

- [ ] **Step 6: 五层结构完整性**

```bash
for d in core model channels knowledge conversation; do echo "--- $d"; ls lib/$d | head -5; done
```

Expected: 五个目录都在。并核对每一层下的文件都能被映射表正确归层（护栏的「每文件归层」用例即覆盖此点）。

- [ ] **Step 7: 工作区**

```bash
git status --short
```

Expected: 无输出。

本任务不产生新提交。若 Step 1–7 全部符合 Expected，阶段 4b 即可收口 —— **至此搬迁部分全部结束**。
