# 模块化分层重构 · 阶段 2b（共享词汇）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把通道词汇与命名逻辑（`types` / `ids` / `enabled-chats` / `events` / `name-cache` / `name-cache-store` / `group-name`）从 `lib/channels/` 与 `lib/` 根目录迁入 `lib/core/chat/`，使「地基层」不再反向依赖「通道层」。

**Architecture:** 机械搬迁 + import 路径改写，约 93 行。与阶段 2a 同法：先 `git mv`，再让 `pnpm typecheck` 驱动修正。零行为改动。

**为什么要搬：** `lib/config/*`（地基层）今天 import `../channels/types`，方向是乱的；`lib/events.ts` 与 `lib/channels/types.ts` 还互相 `import type`。这 7 个文件不是「通道实现」，是全仓共用的词汇，就该住在地基层。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（见「目标结构」`core/chat/` 与「迁移阶段」表第 2b 行）

## Global Constraints

- **零行为改动。** 除 import 语句外，任何文件的内容一字不动。本阶段不切分任何文件。
- **不写兼容 shim。** 旧路径一律不保留 re-export。
- **分支**：`refactor/stage2b-chat-vocab`，从 `main` 切出。不直接提交 main，**不 push**。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**（仓库有 41 个存量文件不符合 prettier）。只对自己改过的文件跑 `prettier --write`。
- 包管理器用 `pnpm`。

## 搬迁清单

| 从 | 到 |
| --- | --- |
| `lib/channels/types.ts` | `lib/core/chat/types.ts` |
| `lib/channels/ids.ts` | `lib/core/chat/ids.ts` |
| `lib/channels/enabled-chats.ts` | `lib/core/chat/enabled-chats.ts` |
| `lib/events.ts` | `lib/core/chat/events.ts` |
| `lib/name-cache.ts` | `lib/core/chat/name-cache.ts` |
| `lib/name-cache-store.ts` | `lib/core/chat/name-cache-store.ts` |
| `lib/group-name.ts` | `lib/core/chat/group-name.ts` |

**搬完后 `lib/channels/` 只该剩**：`factory.ts`、`keepalive.ts`、`registry.ts`、`qq/`、`tg/`、`discord/`（README 占位）。

**明确不搬**（后续阶段）：`lib/kb-path.ts`、`lib/reflect-*.ts`、`lib/tool-stats.ts`、`lib/usage-stats.ts`、`lib/assemble.ts`、`lib/transcript.ts`、`lib/runtime.ts`、`lib/agent/`、`lib/tools/`、`lib/plugins/`。

## 影响面

| 被引用的路径 | 引用次数 |
| --- | --- |
| `events` | 32 |
| `channels/types` | 24 |
| `channels/enabled-chats` | 17 |
| `channels/ids` | 7 |
| `name-cache` | 6 |
| `group-name` | 6 |
| `name-cache-store` | 2 |

合计约 **93 行 import**（含少量非 import 命中，实际以 typecheck 报出的为准）。

**几处已探明的接缝：**

- `lib/channels/enabled-chats.ts` 引用 `../core/config-store`（阶段 2a 刚迁的）。搬进 `core/chat/` 后要改成 `../config-store`（同层内）。
- `lib/channels/types.ts` 与 `lib/events.ts` **互相 `import type`**。两个一起搬进 `core/chat/` 后变成同级互引（`./events`、`./types`），跨目录引用消失。
- `lib/channels/ids.ts` 引用 `./types`，两个一起搬，不变。
- `lib/name-cache.ts` 用别名引用 `@/lib/channels/types` → 改 `@/lib/core/chat/types`。
- `lib/group-name.ts` 引用 `react` 与 `@/lib/channels/ids` → 后者改 `@/lib/core/chat/ids`。**注意它是个 React hook**（`useState`/`useEffect`），搬进 `core/` 不改变这点——`core` 是「地基层」不是「纯后端层」，它本来就被 `components/` 依赖。

**`typecheck` 覆盖不到的引用类型**（设计文档已列全，本阶段同样要过一遍）：`vi.mock` 字符串目标、运行时拼接路径、测试里的路径断言、配置文件别名、注释路径、仓库入口文件的相对导入。

## Task 1: 搬迁七个文件

**Files:**
- Move: 上表 7 个文件
- Modify: 全部引用它们的文件（约 90 处 import）

- [ ] **Step 1: 新建分支并确认起点干净**

```bash
git checkout main
git status --short          # 必须无输出
git checkout -b refactor/stage2b-chat-vocab
```

- [ ] **Step 2: 搬迁**

```bash
mkdir -p lib/core/chat
git mv lib/channels/types.ts lib/core/chat/types.ts
git mv lib/channels/ids.ts lib/core/chat/ids.ts
git mv lib/channels/enabled-chats.ts lib/core/chat/enabled-chats.ts
git mv lib/events.ts lib/core/chat/events.ts
git mv lib/name-cache.ts lib/core/chat/name-cache.ts
git mv lib/name-cache-store.ts lib/core/chat/name-cache-store.ts
git mv lib/group-name.ts lib/core/chat/group-name.ts
```

- [ ] **Step 3: 让 typecheck 驱动修复 import**

```bash
pnpm typecheck 2>&1 | head -50
```

规则（与阶段 2a 相同）：

- **别名** `@/lib/channels/types` → `@/lib/core/chat/types`；`@/lib/events` → `@/lib/core/chat/events`；依此类推。
- **相对路径**：引用方与被引用方都搬过的，通常不变；只一方搬了的，按新深度重算。`lib/core/chat/` 比 `lib/channels/` 浅一层、比 `lib/` 根深一层，所以**两边都有变动**，务必以 typecheck 报错为准逐个核对。

**循环修正直到 `pnpm typecheck` 输出为空。**

- [ ] **Step 4: 手工检查 typecheck 抓不到的引用**

```bash
grep -rnE "(channels/(types|ids|enabled-chats)|\"@/lib/events|/lib/events\"|lib/name-cache|lib/group-name)" \
  --include='*.ts' --include='*.tsx' --include='*.json' --include='*.cjs' --include='*.js' \
  app lib components tests plugins scripts instrumentation.ts proxy.ts next.config.ts ecosystem.config.cjs components.json \
  | grep -v "core/chat/"
```

Expected: 无输出。逐个修正发现的问题。

**注意模式要带引号或 `lib/` 前缀**：裸的 `name-cache` 会命中散文注释里的词（如 `// 命中 name-cache 则…`），那不是路径引用，不该改。实现时踩过这个坑。

同时查注释里的路径引用（不报错，只会腐烂）：

```bash
grep -rnE "^\s*(//|\*|/\*)" --include='*.ts' lib app | grep -E "channels/(types|ids|enabled-chats)|lib/events"
```

- [ ] **Step 5: 确认目录结构**

```bash
ls lib/core/chat/
ls lib/channels/
ls lib/*.ts
```

Expected：`lib/core/chat/` 含那 7 个文件；`lib/channels/` 只剩 `factory.ts`、`keepalive.ts`、`registry.ts`、`qq/`、`tg/`、`discord/`；`lib/*.ts` 少掉 `events.ts`、`name-cache.ts`、`name-cache-store.ts`、`group-name.ts`，剩 `assemble.ts`、`kb-path.ts`、`reflect-promote.ts`、`reflect-stats.ts`、`runtime.ts`、`tool-stats.ts`、`transcript.ts`、`usage-stats.ts`（8 个）。

- [ ] **Step 6: 同步镜像测试目录**

**设计文档的「每个搬迁阶段的隐含必做项」第 2 条**：`docs/development.md` 明写「测试放在 `tests/`，镜像源码目录」，源码搬了测试就要跟着搬。

本次要搬的测试（先 `ls` 确认哪些存在）：

```bash
ls tests/lib/channels/ids.test.ts tests/lib/channels/enabled-chats.test.ts \
   tests/lib/name-cache.test.ts tests/lib/group-name-session.test.ts 2>/dev/null
```

把**存在的**逐个 `git mv` 到 `tests/lib/core/chat/`：

```bash
mkdir -p tests/lib/core/chat
git mv tests/lib/channels/ids.test.ts tests/lib/core/chat/ids.test.ts
git mv tests/lib/channels/enabled-chats.test.ts tests/lib/core/chat/enabled-chats.test.ts
git mv tests/lib/name-cache.test.ts tests/lib/core/chat/name-cache.test.ts
git mv tests/lib/group-name-session.test.ts tests/lib/core/chat/group-name-session.test.ts
```

（`types.ts`、`events.ts`、`name-cache-store.ts` 没有对应测试文件；`tests/lib/channels/` 里的 `factory`/`keepalive`/`registry`/`qq`/`tg` 测的是**没搬的**源码，**留在原地**。别整目录搬。）

测试多用 `@/` 别名，预期零 import 改动；有相对路径的报错就逐个修。

- [ ] **Step 7: 跑测试与类型检查**

```bash
pnpm typecheck
pnpm vitest run
```

Expected: typecheck 无输出；vitest **92 文件 / 971 用例**全过（只搬位置，不增删测试）。

**`tests/architecture/layering.test.ts` 预计会红**（它的映射表还指着旧路径）——那是 **Task 2 的范围，本阶段不要改它**。记下哪几个用例红了即可。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "refactor(core): 通道词汇与命名逻辑迁入 lib/core/chat

types/ids/enabled-chats 此前栖身 lib/channels/,而 lib/config 这些
地基层模块反过来 import 它们,方向是乱的;events.ts 与 channels/types.ts
还互相 import type。这七个文件是全仓共用词汇而非通道实现,迁入 core/chat
后地基层不再依赖通道层。零行为改动,约 93 行 import 改写,测试目录
同步镜像。"
```

## Task 2: 同步护栏与文档

**Files:**
- Modify: `tests/architecture/layering.test.ts`
- Modify: `docs/development.md`

- [ ] **Step 0: 顺带消除一处已登记的层内环（一行，且它本身就是 import 语句）**

设计文档登记过一条 `core` 层内的环：`config-store.ts` 运行时 import `chat/enabled-chats.ts` 的
`getGroupPolicy`，而后者反向引用 `config-store` 的**类型**。此前把它写成「调整任意一处都会
改变初始化顺序，属行为改动」——**那是错的**。

`AppConfig` 与 `GroupPolicy` 其实**定义在** `lib/core/config/schema.ts`，而 `config-store.ts:17`
只是 `export type { AppConfig, GroupPolicy } from "./config/schema"` 的 re-export。从定义处取类型
即可消除这条反向边：

```ts
// lib/core/chat/enabled-chats.ts:2
import type { AppConfig, GroupPolicy } from "../config/schema"
```

**它仍是 `import type`——运行期完全擦除，零行为影响**，也不越出本阶段「只改 import」的边界。

改完跑：

```bash
pnpm vitest run tests/lib/core/chat/ tests/lib/core/config-store.test.ts
```

Expected: 全过。（分层测试不受影响：两条边都在 `core` 层内，跨层检查看不到。）

- [ ] **Step 1: 从 `PREFIX_RULES` 删掉 7 条已死的精确规则**

```ts
  ["lib/events.ts", "core"],
  ["lib/name-cache.ts", "core"],
  ["lib/name-cache-store.ts", "core"],
  ["lib/group-name.ts", "core"],
  ["lib/channels/types.ts", "core"],
  ["lib/channels/ids.ts", "core"],
  ["lib/channels/enabled-chats.ts", "core"],
```

新位置由已存在的 `["lib/core/", "core"]` 覆盖，**不需要新增规则**。`["lib/channels/", "channels"]` **保留**（`factory/keepalive/registry/qq/tg` 还在那儿）。

- [ ] **Step 2: 把这 7 条路径登记进 `RETIRED_PREFIXES`**

**目录与精确文件都要登记，不要只登记目录项。** 本阶段正是这个规则的用武之地：`lib/channels/` 这条目录规则仍然存活，若有人重建 `lib/channels/types.ts`，它会被**静默地**归成 `channels` 层——只有退役登记能拦。

在现有 14 项后追加这 7 条（`lib/events.ts`、`lib/name-cache.ts`、`lib/name-cache-store.ts`、`lib/group-name.ts`、`lib/channels/types.ts`、`lib/channels/ids.ts`、`lib/channels/enabled-chats.ts`），共 21 项。

- [ ] **Step 3: 改分类钉子用例**

`expect(layerOf("lib/channels/types.ts")).toBe("core")` 改为：

```ts
    expect(layerOf("lib/core/chat/types.ts")).toBe("core")
```

**必须改**：删掉那三条精确规则后，`layerOf("lib/channels/types.ts")` 会命中 `["lib/channels/", "channels"]` 返回 `"channels"`，断言会红。其余 6 条钉子不动。

- [ ] **Step 4: 刷新 `PREFIX_RULES` 文档注释里已过期的示例**

注释里有两处举例已随本次搬迁失效：

- 「`lib/channels/types.ts` 眼下仍在 `channels/` 下，但最终去 `lib/core/chat/`」——它已经搬过去了，这个例子讲不通了。换成一个**仍然成立**的例子（例如阶段 3 会把 `lib/tools/embed.ts` 迁往 `lib/model/`，而它现在映射到的层是 `model`）。
- 「例如 2b 之后 `["lib/channels/", "channels"]` 仍在，重建 `lib/channels/types.ts` 会被悄悄算作 channels」——这正是**现在**的情形。改成一般化表述（「父目录规则仍存活时」），不点名具体阶段。

- [ ] **Step 5: 跑测试并做反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: **8 个用例全绿**。

反向验证（必须真做）：临时建 `lib/channels/types.ts`（内容随意），跑测试，应看到「已退役前缀没有任何文件命中」**失败**并列出该路径；然后**完整删掉**该文件，复跑恢复全绿，确认 `git status` 干净。

**这一步是本阶段最关键的验证** —— 它证明「父目录规则仍存活」那个盲区真的被退役登记堵住了。若没红，说明登记漏了，回头检查 Step 2。

- [ ] **Step 6: 修掉一处陈旧的测试标签（非 import 的例外，理由如下）**

`tests/lib/core/chat/ids.test.ts:9` 的标签仍是 `describe("channels/ids", …)`，而该目录已不存在。

**这是本阶段唯一允许改动的非 import 内容**，理由：它只影响测试输出，不进运行时、不进日志、不被任何告警规则匹配（与 `scope: "onebot.enrich"` 那种可观察输出不同），而它引用的路径已经不存在，留着只会让后来人 grep 到困惑。

仓库的标签惯例是**描述主题而非路径**（同目录下 `bus.test.ts` 用 `"bus"`、`auth.test.ts` 用 `"timingSafeEqualStr"`）。该文件测的是 session key 的编解码，改为：

```ts
describe("session key 编解码", () => {
```

改完复跑该文件确认仍通过：`pnpm vitest run tests/lib/core/chat/ids.test.ts`

- [ ] **Step 7: 更新 `docs/development.md`**

- 「模块边界」里 `lib/core/config-store.ts` 那条结尾的 `lib/channels/enabled-chats.ts` → `lib/core/chat/enabled-chats.ts`
- **删掉「待改写条目」表里标 `2b` 的那一行**（使命结束）
- 若别处还提到这 7 个文件的旧路径，一并改

复核：

```bash
grep -n "channels/types\|channels/ids\|channels/enabled-chats\|lib/events\|name-cache\|group-name" docs/development.md
```

Expected: 无输出。

- [ ] **Step 8: 提交**

```bash
git add tests/architecture/layering.test.ts docs/development.md
git commit -m "refactor(arch): 同步护栏映射表与文档的 core/chat 路径

七条旧精确规则已死,从 PREFIX_RULES 移除并登记进 RETIRED_PREFIXES。
本阶段正是「父目录规则仍存活」盲区的实例:lib/channels/ 规则还在,
重建 lib/channels/types.ts 会被静默归成 channels,只有退役登记能拦。
另刷新了映射表注释里两处已过期的举例。"
```

## Task 3: 全量验证

- [ ] **Step 1: 完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出；eslint 0 error（1 条 `tests/lib/ranking-route.test.ts` 的既有 warning）；vitest **92 文件 / 971 用例**全过（本阶段不增删测试）。

- [ ] **Step 2: 目录结构**

```bash
ls lib/core/chat/ lib/channels/ lib/*.ts
ls tests/lib/core/chat/ tests/lib/channels/
```

Expected：`lib/core/chat/` 含那 7 个源文件、`tests/lib/core/chat/` 含搬来的 4 个测试；`lib/channels/` 只剩 `factory.ts`、`keepalive.ts`、`registry.ts`、`qq/`、`tg/`、`discord/`，而 `tests/lib/channels/` 对应只剩 `factory.test.ts`、`keepalive.test.ts`、`registry.test.ts`、`qq/`、`tg/`；`lib/*.ts` 剩 8 个。

- [ ] **Step 3: 零行为改动取证**

```bash
git diff -M main..HEAD | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
```

把全部增删行过滤出来**逐行核对**，并做一次**范围收窄的强验证**：

```bash
git diff -M main..HEAD --numstat -- lib/ app/ components/ plugins/ scripts/ components.json
```

Expected: 生产代码侧（排除 `tests/` 与 `docs/`）的改动行里，**「既非 import 也非注释」的行数为 0**。这是阶段 2a 用过的判据，可靠性高。

**若出现任何业务逻辑行**（赋值、函数调用、条件、字符串常量、SQL），停下报告。

- [ ] **Step 4: 旧路径残留**

```bash
grep -rn "channels/types\|channels/ids\|channels/enabled-chats" --include='*.ts' --include='*.tsx' app lib components tests plugins scripts
grep -rn "@/lib/events\|@/lib/name-cache\|@/lib/group-name" --include='*.ts' --include='*.tsx' app lib components tests plugins scripts
```

Expected: 两条都**无输出**（`lib/channels/qq/...` 之类的正向引用不在模式内）。

- [ ] **Step 5: 护栏状态与反向验证**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "CURRENT_STAGE" tests/architecture/layering.test.ts
sed -n '/^const RETIRED_PREFIXES/,/^]/p' tests/architecture/layering.test.ts | grep -c '"lib/'
```

Expected: 8 用例全绿；`CURRENT_STAGE = "2b"`；`RETIRED_PREFIXES` 恰为 **21 项**（阶段 2a 的 14 项 + 本阶段新增 7 项）。

再跑一次 Task 2 Step 5 的反向验证（建 `lib/channels/types.ts` → 应红 → 删净 → 复跑全绿 → `git status` 干净）。

- [ ] **Step 6: 工作区**

```bash
git status --short
```

Expected: 无输出。

本任务不产生新提交。若 Step 1–6 全部符合 Expected，阶段 2b 即可收口。
