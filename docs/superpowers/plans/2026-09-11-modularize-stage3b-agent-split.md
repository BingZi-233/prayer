# 模块化分层重构 · 阶段 3b（切分 agent.ts）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `lib/agent/agent.ts`(715 行)按职责切成六个模块放进 `lib/model/`,让 `agent.ts` 只剩 `Agent` 类与它的依赖契约(约 240–280 行);并把 `reflection-*` 对 `agent.ts` 的引用改指 `model/`,消除最后三条容忍的逆向边。

**Architecture:** 这是全套重构里**唯一一次真正的切分**(其余都是搬位置)。原则仍是「零行为改动」——代码块**原样搬移**,只调整 import/export 语句。**不允许合并重复实现**(见下),**不允许留 re-export shim**。

**为什么切:** `agent.ts` 里约 400 行回答的是「怎么调模型」(SDK 环境、query options、drain、system prompt、工具白名单、prompt 构造),而不是「会话怎么走」。切出去之后:①`lib/agent/` 只留会话编排;②知识层的 `reflection-*` 改从 `model/` 取 SDK 基座,不再是「知识层依赖会话层」。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`(「目标结构」`model/` 段与「迁移阶段」表 3b 行)

## Global Constraints

- **零行为改动。** 代码块原样搬移。除 import/export 语句外,搬走的代码**一字不动**。
- **禁止 re-export shim。** `agent.ts` **不得**写 `export { noToolQueryOptions } from "./…"`。留 shim 会让容忍边不消失,`removedBy:"3b"` 到点自红。同步地,被搬走的符号要从 `agent.ts` 的导出面**彻底移除**。
- **不许合并重复实现。** `drainQuery`(顶层导出)与 `Agent.run` 内联的 drain 是两份**刻意**分开的同款实现:内联版要「超时胜出仍保留累积文本」的降级语义、还要统计 `toolCalls`。**只把顶层 `drainQuery` 搬走,内联版原样留在 `Agent.run`。** 合并属重构,会改行为。
- **分支**:`refactor/stage3b-agent-split`,从 `main` 切出。不直接提交 main,**不 push**。
- **提交信息**:Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**(仓库有 41 个存量文件不符合 prettier)。只对自己改过的文件跑 `prettier --write`。
- 包管理器用 `pnpm`。

## 切分映射(按当前 HEAD 的行区间;实施时行号会随改动漂移,**以内容为准**,不要死记行号)

| 行区间 | 内容 | 落点 |
| --- | --- | --- |
| 18–27 | `ToolContext` 接口 | **留 `agent.ts`** |
| 29–43 | `sdkEnv()` | `model/sdk-env.ts` |
| 45–71 | `configuredSdkEnv()`(私有) | `model/query-options.ts`(**保持不导出**) |
| 73–91 | `STRUCTURED_OUTPUT_TOOL`、`isStructuredOutputTool`、`CanUseToolFn`(私有) | `model/tool-policy.ts` |
| 93–112 | `wrapCanUseToolForStructuredOutput()` | `model/tool-policy.ts` |
| 114–171 | `noToolQueryOptions()`、`agentQueryOptions()` | `model/query-options.ts` |
| 173–199 | `AgentDeps`、`DEFAULT_RUN_TIMEOUT_MS` | **留 `agent.ts`** |
| 201–210 | `AgentResult`、`AgentMedia` | **`AgentMedia` → `model/prompt.ts`**(见风险 2);`AgentResult` 留 `agent.ts` |
| 212–312 | `foldPreamble`、4 个 prompt marker + `AGENT_PROMPT_MARKERS`、`stripAgentPromptMarkers`、`Base64MediaType`、`kbProbeText`、`buildPrompt` | `model/prompt.ts` |
| 314–441 | `ResultUsageLike`、`usageFromResult`、`DrainResult`、`StructuredCarrier`、`pickStructuredFromMessage`、`drainQuery` | `model/drain.ts` |
| 443–503 | `DefaultSystemOptions`、`buildDefaultSystem`、`DEFAULT_SYSTEM` | `model/system-prompt.ts` |
| 505–548 | `CS_KB_TOOL`、`PACKY_TOOL`、`TOOL_ALLOWLIST`、`AGENT_FALLBACK_TEXT`、`NO_ANSWER_SENTINEL`、`PROACTIVE_SUFFIX`、`isNoAnswerText`、`isToolAllowed`、`denyMessage` | **拆三处**,见下 |
| 550–715 | `class Agent` | **留 `agent.ts`** |

## 共享符号的归属(本阶段最容易做错的地方)

**505–548 那段要按符号拆开,不能整段搬:**

| 符号 | 归属 | 理由 |
| --- | --- | --- |
| `CS_KB_TOOL`、`PACKY_TOOL`、`TOOL_ALLOWLIST`、`isToolAllowed`、`denyMessage` | `model/tool-policy.ts` | 工具白名单策略 |
| `PROACTIVE_SUFFIX`、`NO_ANSWER_SENTINEL`、`isNoAnswerText` | **`model/prompt.ts`** | `kbProbeText`(也在 prompt.ts)要按 `PROACTIVE_SUFFIX` 剥前缀。**留在 `agent.ts` 会让 `model/prompt.ts → conversation/agent.ts` 成为逆向依赖,护栏会红。** 而 `unanswered-poller`/`orchestrator`/`reply-mapper`(conversation)从 model import 是合法方向 |
| `AGENT_FALLBACK_TEXT` | **留 `agent.ts`** | `prompt.ts` 不需要它;`unanswered-poller`(conversation)与它同层,直接引用合法 |

**4 个 prompt marker**(`KB_CANDIDATES_BEGIN/END`、`USER_MESSAGE_BEGIN/END`)→ 归 `model/prompt.ts`。`buildDefaultSystem`(→ `model/system-prompt.ts`)会**把它拼进 system prompt 正文**,所以 `system-prompt.ts` 从 `prompt.ts` import(同层,合法)。

## 消费者改指向(切分后必须同步改的 import)

| 符号 | 新家 | 要改的消费者 |
| --- | --- | --- |
| `sdkEnv` | `model/sdk-env` | `lib/agent/introspect.ts` |
| `noToolQueryOptions` | `model/query-options` | `answerability.ts`、`intent.ts`、`topic-poller.ts`、`reflection-{poller,compactor,promoter}.ts` |
| `drainQuery` | `model/drain` | 同上 6 个 + `tests/lib/model/stats/usage.test.ts` |
| `usageFromResult` | `model/drain` | `tests/lib/model/stats/usage.test.ts` |
| `buildDefaultSystem` | `model/system-prompt` | `tests/lib/core/brand.test.ts` |
| `isToolAllowed`、`TOOL_ALLOWLIST` | `model/tool-policy` | `lib/agent/introspect.ts` |
| `PROACTIVE_SUFFIX`、`isNoAnswerText` | `model/prompt` | `unanswered-poller.ts`、`orchestrator.ts`、`reply-mapper.ts` |
| `PROBE_MAX_CHARS` | `model/prompt`(见风险 1) | `lib/agent/kb-prefetch.ts`(改为**反向** import) |

**留在 `agent.ts` 的导出**(消费者不用改):`Agent`、`AgentDeps`、`AgentResult`、`ToolContext`、`DEFAULT_RUN_TIMEOUT_MS`、`AGENT_FALLBACK_TEXT`。
→ 因此 `assemble.test.ts`、`orchestrator.test.ts` 的 `import type { Agent }` **不受影响**。

**`tests/lib/agent/agent.test.ts` 从 `@/lib/agent/agent` 一次导入 15 个符号,其中约 10 个要搬走** → 该测试**必须按目标文件拆分**(Task 3)。

## 风险清单(实施前必读)

1. **`PROBE_MAX_CHARS` 是头号雷。** 它定义在 `lib/agent/kb-prefetch.ts`(护栏归 **knowledge** 层),而 `agent.ts` 的 prompt 构造段用它。切出 `model/prompt.ts` 后若继续从 `kb-prefetch` import,就是 `model → knowledge` **逆向依赖,护栏必红**。**必须把该常量移到 `model/prompt.ts`,让 `kb-prefetch` 反向 import**(knowledge → model 合法)。这是本阶段唯一一处「不搬常量就过不去」。
2. **`AgentMedia` 必须随 prompt 段走。** 它同时被 `buildPrompt`/`kbProbeText`(→model)与 `Agent.run` 用。留在 `agent.ts` 会让 `model → conversation` 逆向;归 `model/prompt.ts`,`agent.ts` 从 model import。
3. **不要合并 `drainQuery` 与 `Agent.run` 内联 drain。** 见 Global Constraints。
4. **层内环**:按上述归属,`model/` 内部边为 `drain→tool-policy`、`query-options→{sdk-env,tool-policy}`、`prompt→sanitize-input`、`system-prompt→prompt`,**无环**。`prompt.ts` 只 import 已经搬走的 `model/sanitize-input.ts`,而后者只依赖 `core/log-context` —— **不存在** `prompt ↔ sanitize-input` 环。(但注意:**护栏测不到层内环**,所以实施时自己确认一遍没有新增层内互引。)
5. **模块级状态无坑**:`DEFAULT_SYSTEM` 是 import 期求值的纯函数结果,`TOOL_ALLOWLIST` 是只读 `Set`;**无 `globalThis`、无计数器、无 `bind*`**。`usageStats`/`toolStats` 挂在 `globalThis`(`model/stats/*`),切开**不会**产生两份实例。

## Task 1: 切出三个基础设施模块

**Files:**
- Create: `lib/model/sdk-env.ts`、`lib/model/tool-policy.ts`、`lib/model/query-options.ts`
- Modify: `lib/agent/agent.ts`、`lib/agent/introspect.ts`、`lib/agent/answerability.ts`、`lib/agent/intent.ts`、`lib/agent/topic-poller.ts`、`lib/agent/reflection-{poller,compactor,promoter}.ts`

- [ ] **Step 1: 新建分支**

```bash
git checkout main
git status --short          # 必须无输出
git checkout -b refactor/stage3b-agent-split
```

- [ ] **Step 2: 读一遍 `lib/agent/agent.ts`**

先把全文读一遍,对着上面的映射表确认行区间与内容**当前仍然一致**(2a/2b/3a 都改过它的 import 行)。若发现与映射表不符,**停下报给我**。

- [ ] **Step 3: 建 `lib/model/sdk-env.ts`**

把 `sdkEnv()` 整段**原样搬过来**(含它自己对 `node:path`/环境变量的引用方式)。把它需要的 import 一并搬;若它引用了 `agent.ts` 里的私有常量,**把那个常量也搬过来**并在回报里说明。

- [ ] **Step 4: 建 `lib/model/tool-policy.ts`**

搬入 `STRUCTURED_OUTPUT_TOOL`、`isStructuredOutputTool`、`CanUseToolFn`(保持不导出)、`wrapCanUseToolForStructuredOutput`、`CS_KB_TOOL`、`PACKY_TOOL`、`TOOL_ALLOWLIST`、`isToolAllowed`、`denyMessage`。

**导出面**要与原来一致(原来导出什么就导出什么;原来私有的保持私有)。

- [ ] **Step 5: 建 `lib/model/query-options.ts`**

搬入 `configuredSdkEnv`(**不导出**)、`noToolQueryOptions`、`agentQueryOptions`。它们会 import `sdk-env` 与 `tool-policy`(同层,合法)。

- [ ] **Step 6: 从 `agent.ts` 删掉已搬走的段落,并改它的 import**

`agent.ts` 改为从 `@/lib/model/...` 引入这三个模块的相关符号。**不要留任何 re-export。**

- [ ] **Step 7: 改消费者**

按上面的「消费者改指向」表,把 `sdkEnv`、`noToolQueryOptions`、`isToolAllowed`、`TOOL_ALLOWLIST` 的 import 从 `./agent` / `@/lib/agent/agent` 改到 `@/lib/model/...`。

**注意 `reflection-*` 三个文件此刻只改一半**(`noToolQueryOptions` 指向 model,`drainQuery` 还在 `agent.ts` 里等 Task 2)。`drainQuery` 继续从 `./agent` 引 —— 那三条容忍边此时**还没消失**,护栏仍绿。

- [ ] **Step 8: 验证**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出;vitest **92 文件 / 972 用例**全过(含护栏测试 —— 本任务不改护栏,它应仍绿)。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "refactor(model): 从 agent.ts 切出 sdk-env / tool-policy / query-options

agent.ts 里约 400 行回答的是「怎么调模型」而非「会话怎么走」。
本次先切出三个基础设施模块:SDK 环境、工具白名单策略、query options。
代码原样搬移,只调整 import/export。"
```

## Task 2: 切出三个内容模块并收敛容忍边

**Files:**
- Create: `lib/model/prompt.ts`、`lib/model/drain.ts`、`lib/model/system-prompt.ts`
- Modify: `lib/agent/agent.ts`、`lib/agent/kb-prefetch.ts`、`lib/agent/{unanswered-poller,orchestrator,reply-mapper,reflection-poller,reflection-compactor,reflection-promoter}.ts`、`tests/lib/model/stats/usage.test.ts`、`tests/lib/core/brand.test.ts`

- [ ] **Step 1: 建 `lib/model/prompt.ts`(含风险 1 的常量搬迁)**

搬入:`foldPreamble`、4 个 prompt marker + `AGENT_PROMPT_MARKERS`、`stripAgentPromptMarkers`、`Base64MediaType`、`kbProbeText`、`buildPrompt`、`AgentMedia`(**按风险 2,必须随它走**)。

**并做风险 1 的处理**:把 `PROBE_MAX_CHARS` 从 `lib/agent/kb-prefetch.ts` **移进本文件**,`kb-prefetch.ts` 改为从 `@/lib/model/prompt` import 它。**这是本阶段唯一一处「不搬就过不去」** —— 漏了护栏必红。

- [ ] **Step 2: 建 `lib/model/drain.ts`**

搬入 `ResultUsageLike`、`usageFromResult`、`DrainResult`、`StructuredCarrier`、`pickStructuredFromMessage`、`drainQuery`。

**`drainQuery` 只搬顶层那个。** `Agent.run` 里内联的 drain **原样保留在 `agent.ts`**(见 Global Constraints)。

- [ ] **Step 3: 建 `lib/model/system-prompt.ts`**

搬入 `DefaultSystemOptions`、`buildDefaultSystem`、`DEFAULT_SYSTEM`。它会从 `./prompt` import 那 4 个 marker(同层,合法)。

- [ ] **Step 4: 从 `agent.ts` 删掉已搬走的段落,并改它的 import**

`agent.ts` 改为从 model import 这些符号。**再次强调:不留 re-export。** 这一步之后 `agent.ts` 应只剩 `ToolContext`、`AgentDeps`、`AgentResult`、`DEFAULT_RUN_TIMEOUT_MS`、`AGENT_FALLBACK_TEXT` 与 `class Agent`(约 240–280 行)。

- [ ] **Step 5: 改消费者(这一步会让三条容忍边消失)**

按表改 `PROACTIVE_SUFFIX`/`isNoAnswerText`/`drainQuery`/`usageFromResult`/`buildDefaultSystem` 的 import。

**关键**:`reflection-{poller,compactor,promoter}.ts` 此刻不再从 `./agent` 引任何东西 —— 那三条容忍边(`knowledge → conversation`)**在这一步消失**。

- [ ] **Step 6: 验证**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出;**`tests/architecture/layering.test.ts` 预计会红 1 条** —— 「逆向依赖与容忍集合精确一致」:它期待那 3 条边**存在**,而现在它们已消失。**那是 Task 3 的活,本任务不要改它。**

其余全绿。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor(model): 从 agent.ts 切出 prompt / drain / system-prompt

连同 PROBE_MAX_CHARS 一起搬进 model/prompt.ts —— 它原在 kb-prefetch
(知识层),留在原处会让 model 反向依赖知识层。reflection-* 三个文件
对 agent.ts 的引用随之清空,最后三条容忍的逆向边消失。
agent.ts 降至约 250 行,只剩 Agent 类与它的依赖契约。"
```

## Task 3: 拆分测试并同步护栏

**Files:**
- Create: `tests/lib/model/{sdk-env,tool-policy,query-options,prompt,drain,system-prompt}.test.ts`
- Modify: `tests/lib/agent/agent.test.ts`
- Modify: `tests/architecture/layering.test.ts`

- [ ] **Step 1: 拆分 `tests/lib/agent/agent.test.ts`**

它现在从 `@/lib/agent/agent` 一次导入约 15 个符号,其中约 10 个已搬走。按**目标文件**把对应测试块搬进新文件:

`tests/lib/model/{sdk-env,tool-policy,query-options,prompt,drain,system-prompt}.test.ts`

**同步满足「测试镜像源码目录」**的约定。原 `agent.test.ts` 只保留测 `Agent` 类与 `AgentDeps` 的用例。

**只搬测试块,不改断言内容**(改 import 路径除外)。若某个测试块同时测多个模块、无法干净切分,**停下报给我**,不要强行拆。

- [ ] **Step 2: 跑测试**

```bash
pnpm vitest run
```

Expected: 全过,**用例总数仍是 972**(拆测试文件不改用例数)。文件数会因拆分而增加(92 → 约 97),**这是预期的**。

- [ ] **Step 3: 同步护栏**

**(a) 删掉 `TOLERATED` 里那 3 条边**(`reflection-{compactor,poller,promoter} -> lib/agent/agent`)。它们在本阶段已经真的消失了。

**容忍集合现在是空的**:

```ts
const TOLERATED: Array<{ edge: string; removedBy: string }> = []
```

**(b) `CURRENT_STAGE` 改为 `"3b"`。**

改完后「没有早该消失的容忍条目」会在 `CURRENT_STAGE="3b"` 下检查 `removedBy <= 3b` —— 数组空了,自然为空 ✓。

**(c) 检查那条「父目录规则与自身层别不同」的钉子。** 它枚举 4 条 knowledge 的(`kb-prefetch` + 3 个 `reflection-*`)。**本阶段这三个 `reflection-*` 文件仍在 `lib/agent/` 下没搬走**,所以那 4 条**都不受影响,保持原样**。但 `lib/model/` 层里可能新增了「父目录规则与自身层别不同」的情况吗?**不需要** —— `lib/model/` 下所有文件都由 `["lib/model/", "model"]` 一条规则覆盖,同层。

- [ ] **Step 4: 验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: **全绿**,且 `TOLERATED` 为空数组。

反向验证(**真做**):容忍集合清空之后,「逆向依赖与容忍集合精确一致」这条**不能变成永远绿的摆设** —— 它现在断言 `scanLib()` 返回空数组,若扫描器失灵,它也会「绿」。所以必须验证扫描器仍能抓到新的逆向依赖:

1. 临时往一个 **model 层**文件里加一条指向 conversation 的 import,例如在 `lib/model/drain.ts` 顶部加:
   ```ts
   import type { Agent } from "../agent/agent"
   ```
2. 跑 `pnpm vitest run tests/architecture/layering.test.ts` → 应看到「逆向依赖与容忍集合精确一致」**失败**,且列出的边是 `lib/model/drain -> lib/agent/agent`。
3. **完整删掉那一行**,复跑恢复全绿,`git status` 无输出。

若第 2 步没红,说明扫描器或断言已经失效,**停下报给我**。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "test(arch): 拆分 agent.test.ts 并清空容忍集合

agent.ts 切出的六个模块各有对应测试,按「测试镜像源码」落到
tests/lib/model/ 下。那三条 knowledge→conversation 的容忍边已随
reflection-* 改指向而消失,TOLERATED 清空 —— 容忍集合从阶段 0 的
3 条走到这里归零。"
```

## Task 4: 全量验证

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出;eslint 0 error(1 条既有 warning);vitest **用例数 972** 全过(文件数因测试拆分而增加)。

- [ ] **Step 2: `agent.ts` 真的瘦了**

```bash
wc -l lib/agent/agent.ts lib/model/*.ts
```

Expected: `agent.ts` 约 240–280 行;`lib/model/` 下新增 6 个文件(与已存在的 `sanitize-input.ts` 等并列)。

- [ ] **Step 3: 零行为改动取证**

```bash
git diff -M main..HEAD --stat
git diff -M main..HEAD -- lib/ | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
```

**这是本阶段最难的取证** —— 与前面几次「整文件搬迁」不同,这次是**代码块搬家**,`git diff` 会显示为「一个文件里删了 400 行、几个新文件里加了 400 行」。

判据改为:**把删掉的行与新增的行做内容比对,应当一一对应**(除 import/export 行)。建议用:

```bash
git diff -M main..HEAD -- lib/agent/agent.ts | grep '^-' | grep -vE '^---' | sed 's/^-//' | sort > /tmp/removed.txt
git diff -M main..HEAD -- lib/model/ | grep '^+' | grep -vE '^\+\+\+' | sed 's/^+//' | sort > /tmp/added.txt
comm -23 /tmp/removed.txt /tmp/added.txt   # 应当只剩 import/export 行
```

Expected: `comm` 的输出只有 import/export 语句(以及可能因为换行/空行处理产生的少量噪声 —— 若有,逐条核对)。**若出现任何业务逻辑行,那是搬漏或搬错,停下报告。**

- [ ] **Step 4: 消费者与导出面**

```bash
grep -rn "from \"\./agent\"\|from \"@/lib/agent/agent\"" --include='*.ts' lib tests
```

Expected: 剩下的消费者**只能**取那几个留在 `agent.ts` 的符号(`Agent`、`AgentDeps`、`AgentResult`、`ToolContext`、`DEFAULT_RUN_TIMEOUT_MS`、`AGENT_FALLBACK_TEXT`)。**若还有人在取已搬走的符号,说明 import 没改干净。**

再确认**没有 re-export shim**:

```bash
grep -n "^export {.*} from\|^export \*" lib/agent/agent.ts
```

Expected: 无输出。

- [ ] **Step 5: 护栏状态**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "CURRENT_STAGE\|const TOLERATED" tests/architecture/layering.test.ts
```

Expected: 全绿;`CURRENT_STAGE = "3b"`;`TOLERATED` 是空数组。

- [ ] **Step 6: 工作区**

```bash
git status --short
```

Expected: 无输出。

本任务不产生新提交。若 Step 1–6 全部符合 Expected,阶段 3b 即可收口 —— 至此 `lib/agent/` 只剩会话与编排,`lib/model/` 收下了全部「怎么调模型」。
