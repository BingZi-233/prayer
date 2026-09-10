# 模块化分层重构 · 阶段 1（QQ 归并）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `lib/onebot/` 的五个模块并入 `lib/channels/qq/`、删掉那个 5 行兼容 shim，使 QQ 通道的逻辑与 TG 一样收在一处，`lib/onebot/` 目录整个消失。

**Architecture:** 纯文件搬迁 + import 路径改写。零行为改动：所有被搬文件的内容除 import 语句外一字不动。搬完同步 `tests/architecture/layering.test.ts` 的路径映射表（旧前缀进 `RETIRED_PREFIXES`、`CURRENT_STAGE` 升到 1）与 `CLAUDE.md` 的仓库结构描述。

**Tech Stack:** TypeScript 5.9、Node 24、Vitest 4、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-10-modularize-layering-design.md`（见「迁移阶段」表第 1 行与「既有引用同步」一节）

## Global Constraints

- **零行为改动。** 这是本阶段唯一的要求：搬位置，不改逻辑。任何函数的运行时行为、SQL、提示词、常量值都必须一字不动。
- **不写兼容 shim。** 删掉 `lib/onebot/client.ts` 后，旧路径 `@/lib/onebot/client` **不保留**任何 re-export。
- **旧目录整个消失。** `lib/onebot/` 与 `tests/lib/onebot/` 搬空后删除目录本身。
- **别碰 HTTP 路由名。** `app/api/onebot/*`、`/api/onebot/groups`、`/api/onebot/members` 这些是**传输层的 URL 路径**，与 `lib/onebot/` 这个目录无关，本阶段一律不动。文件里的注释提到它们时也不动。
- **分支**：新建 `refactor/stage1-qq-merge`，从 `main` 切出。不直接提交 main，不 push。
- **提交信息**：Conventional Commits + 中文正文。
- **不要跑 `pnpm format`**：仓库在 main 上有 41 个存量文件不符合 prettier，直接跑会产生巨大的无关 diff。只对自己改过的文件跑 `prettier --write`。

## 影响面（动手前先核对，这是本阶段的全部改动集合）

**要搬的源文件（5 个）**，`lib/onebot/` → `lib/channels/qq/`：

| 文件 | 自身 import | 搬迁后需要改的 |
| --- | --- | --- |
| `admins.ts` | 无 | 无 |
| `media.ts` | 无 | 无 |
| `parse.ts` | 无 | 无 |
| `enrich.ts` | `../events` `./parse` `./media` `../log-context` `../logger` | 三个 `../` 变 `../../`；两个 `./` 不变 |
| `members-fetch.ts` | `@/lib/name-cache` | 无（别名不受目录深度影响） |

**要删的（1 个）**：`lib/onebot/client.ts`（5 行 re-export shim）

**要改 import 的源码（3 处）**：
- `lib/channels/qq/client.ts`：`../../onebot/enrich` → `./enrich`；`../../onebot/parse` → `./parse`
- `app/api/onebot/admins/route.ts`：两处 → `@/lib/channels/qq/{admins,members-fetch}`
- `app/api/onebot/members/route.ts`：一处 → `@/lib/channels/qq/members-fetch`

**要搬的测试（6 个）**，`tests/lib/onebot/` → `tests/lib/channels/qq/`（该目录现有 `channel.test.ts`，无同名冲突）：`client` `parse` `media` `enrich` `members-fetch` `admins`，各自把 `@/lib/onebot/…` 改成 `@/lib/channels/qq/…`。

**要同步的护栏与文档**：`tests/architecture/layering.test.ts` 的映射表；`CLAUDE.md` 的「仓库结构」一节里的 `onebot/` 项。

## Task 1: 搬迁源码与测试

**Files:**
- Move: `lib/onebot/{admins,media,parse,enrich,members-fetch}.ts` → `lib/channels/qq/`
- Delete: `lib/onebot/client.ts`
- Move: `tests/lib/onebot/*.test.ts` → `tests/lib/channels/qq/`
- Modify: `lib/channels/qq/client.ts`、`app/api/onebot/admins/route.ts`、`app/api/onebot/members/route.ts`、6 个被搬的测试文件

- [ ] **Step 1: 新建分支**

```bash
git checkout main
git checkout -b refactor/stage1-qq-merge
```

- [ ] **Step 2: 搬五个模块（用 git mv 保留历史）**

```bash
git mv lib/onebot/admins.ts lib/channels/qq/admins.ts
git mv lib/onebot/media.ts lib/channels/qq/media.ts
git mv lib/onebot/parse.ts lib/channels/qq/parse.ts
git mv lib/onebot/enrich.ts lib/channels/qq/enrich.ts
git mv lib/onebot/members-fetch.ts lib/channels/qq/members-fetch.ts
git rm lib/onebot/client.ts
```

- [ ] **Step 3: 修 `lib/channels/qq/enrich.ts` 的相对路径深度**

该文件从 `lib/onebot/` 下移了一层，三个 `../` 引用要变成 `../../`：

```
import type { IncomingMessage, ImageInput } from "../events"      → "../../events"
import { errorMessage } from "../log-context"                     → "../../log-context"
import { logger } from "../logger"                                → "../../logger"
```

`./parse` 与 `./media` **不变**（同级文件一起搬的）。

- [ ] **Step 4: 修 `lib/channels/qq/client.ts` 的两处引用**

```
import { enrich } from "../../onebot/enrich"   → "./enrich"
} from "../../onebot/parse"                    → "} from \"./parse\""
```

- [ ] **Step 5: 修两个 API 路由**

`app/api/onebot/admins/route.ts`：

```
import { collectAdmins } from "@/lib/onebot/admins"           → "@/lib/channels/qq/admins"
} from "@/lib/onebot/members-fetch"                            → "} from \"@/lib/channels/qq/members-fetch\""
```

`app/api/onebot/members/route.ts`：

```
import { loadGroupMembers } from "@/lib/onebot/members-fetch"  → "@/lib/channels/qq/members-fetch"
```

**注意**：这两个文件里的注释提到 `/api/onebot/admins`、`/api/onebot/groups` 等 HTTP 路径，**不要**动那些。

- [ ] **Step 6: 搬六个测试并改其 import**

```bash
git mv tests/lib/onebot/client.test.ts tests/lib/channels/qq/client.test.ts
git mv tests/lib/onebot/parse.test.ts tests/lib/channels/qq/parse.test.ts
git mv tests/lib/onebot/media.test.ts tests/lib/channels/qq/media.test.ts
git mv tests/lib/onebot/enrich.test.ts tests/lib/channels/qq/enrich.test.ts
git mv tests/lib/onebot/members-fetch.test.ts tests/lib/channels/qq/members-fetch.test.ts
git mv tests/lib/onebot/admins.test.ts tests/lib/channels/qq/admins.test.ts
```

然后把这六个文件里所有 `@/lib/onebot/` 改成 `@/lib/channels/qq/`（共 8 处：`client.test.ts` 1 处、`parse.test.ts` 1 处、`media.test.ts` 1 处、`enrich.test.ts` 2 处、`members-fetch.test.ts` 2 处、`admins.test.ts` 1 处）。

- [ ] **Step 7: 删掉两个空目录**

```bash
rmdir lib/onebot tests/lib/onebot
```

（`rmdir` 只在目录为空时成功 —— 若报非空，说明上一步漏搬了文件。）

- [ ] **Step 8: 确认旧路径真的没有残留**

```bash
grep -rn "lib/onebot" --include='*.ts' --include='*.tsx' app lib components tests plugins scripts
ls lib/onebot tests/lib/onebot
```

Expected: grep 只剩 `tests/architecture/layering.test.ts` 的两处（第 79 行的前缀映射与第 232 行的断言），那是 **Task 2 的范围**，本任务不动；`app/`、`lib/`、`components/`、`plugins/`、`scripts/` 下应零命中。两个 `ls` 都报 `No such file or directory`。

**注意**：`grep "onebot/"`（不带 `lib/`）会有大量输出，那是 `/api/onebot/...` 这类 HTTP 路径，正常，不要改。要 grep 的是带 `lib/` 前缀的目录引用。

- [ ] **Step 9: 跑测试**

```bash
pnpm vitest run tests/lib/channels/qq/
pnpm typecheck
```

Expected: `tests/lib/channels/qq/` 下的 7 个测试文件（原有的 `channel.test.ts` 加迁来的 6 个）全绿；typecheck 无错误。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "refactor(onebot): QQ 通道逻辑并入 lib/channels/qq

原 lib/onebot/ 与 lib/channels/qq/ 各持一半 QQ 逻辑:client 在
channels/qq,parse/enrich/media/admins/members-fetch 却在 onebot/,
另夹一个 5 行兼容 shim。TG 通道早已把全部逻辑收在 channels/tg/,
本次让 QQ 与之对齐。零行为改动:除 import 路径外内容一字未动。"
```

## Task 2: 同步护栏与文档

**Files:**
- Modify: `tests/architecture/layering.test.ts`
- Modify: `CLAUDE.md`

**为什么必须做这一步**：搬完文件后，`layering.test.ts` **照样会绿** —— 因为映射表是按路径前缀匹配的，`lib/onebot/` 那条规则变成指向不存在文件的死规则，而测试察觉不到。若不同步，这条护栏会悄悄退化成部分失效，且没有任何信号。这正是 spec 里「每个搬迁阶段的隐含必做项」要求的事。

- [ ] **Step 1: 先确认当前确实绿**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 7 个用例全绿。**记录这个状态** —— 下一步改完还是 7 个全绿，所以「绿」本身不是本任务的验收信号，映射表的正确性才是。

- [ ] **Step 2: 改 `tests/architecture/layering.test.ts` 的映射表**

三处改动：

1. **从 `PREFIX_RULES` 里删掉**这一行：

```ts
  ["lib/onebot/", "channels"],
```

（`lib/channels/` 那条通配已经覆盖搬过去的文件，不需要新增规则。）

2. **在 `RETIRED_PREFIXES` 里登记旧前缀**，把空数组改成：

```ts
const RETIRED_PREFIXES: string[] = ["lib/onebot/"]
```

3. **把分类钉子用例里的旧路径改掉**（`lib/onebot/` 已退役，`layerOf` 会对它返回 `null`）：

```ts
    expect(layerOf("lib/channels/qq/members-fetch.ts")).toBe("channels")
```

4. **`CURRENT_STAGE` 从 `"0"` 改成 `"1"`**：

```ts
const CURRENT_STAGE = "1"
```

- [ ] **Step 3: 确认「退役前缀」这条防线真的生效**

```bash
pnpm vitest run tests/architecture/layering.test.ts
```

Expected: 7 个用例全绿。

再做一次**反向验证**（确认这条检查不是摆设）：临时建一个文件 `lib/onebot/probe.ts`（内容随意，比如 `export const x = 1`），跑测试，应看到「已退役前缀没有任何文件命中」**失败**；然后删掉该文件，复跑应恢复全绿。**务必删干净并确认 `git status` 干净**。

- [ ] **Step 4: 改 `CLAUDE.md` 的仓库结构**

`CLAUDE.md` 的「仓库结构」一节目前写着（大意）：

```
`lib/`（核心:`agent/` agent+编排+反思循环、`db/` better-sqlite3、`onebot/` WS 客户端、`tools/` 嵌入+KB、`plugins/`）
```

把其中的 `onebot/` WS 客户端 改为 `channels/` 通道（QQ/TG）。注意只改这一处，`CLAUDE.md` 里其它提到 `/api/onebot/...` 的地方（如「命令」一节的测试路径举例）是 HTTP 路径或另有归属，本阶段不要动。

- [ ] **Step 5: 提交**

```bash
git add tests/architecture/layering.test.ts CLAUDE.md
git commit -m "refactor(arch): 同步护栏映射表与 CLAUDE.md 仓库结构

lib/onebot/ 已并入 channels/qq,映射表里那条规则会变成指向不存在
文件的死规则,而分层测试察觉不到这种陈旧(它只查未归层与新违规)。
旧前缀登记进 RETIRED_PREFIXES 后,「退役前缀无文件命中」开始生效。"
```

## Task 3: 全量验证

- [ ] **Step 1: 跑完整质量门**

```bash
pnpm check
```

Expected: typecheck 无输出；eslint 0 error（有 1 条 `tests/lib/ranking-route.test.ts` 的 `probe` 未使用警告，是 main 上就有的既有问题，与本阶段无关）；vitest 全绿。

**测试用例总数应与阶段 0 合并后一致（970）** —— 本阶段零行为改动、不增删测试，只是搬位置。若数字变了，说明有测试被漏搬或误删。

- [ ] **Step 2: 确认目录结构符合目标**

```bash
ls lib/onebot tests/lib/onebot
ls lib/channels/qq tests/lib/channels/qq
```

Expected: 前两个 `ls` 报不存在；`lib/channels/qq/` 含 `client.ts index.ts admins.ts enrich.ts media.ts members-fetch.ts parse.ts`；`tests/lib/channels/qq/` 含 `channel.test.ts` 加迁来的 6 个。

- [ ] **Step 3: 确认零行为改动**

```bash
git diff main..HEAD --stat
git diff main..HEAD -- lib/channels/qq/ | head -60
```

Expected: 改动集中在文件增删与 import 行。**逐行扫一遍 `git diff` 里带 `+`/`-` 的行**：除 `import` / `from` / 注释外，不应有任何逻辑行被改动。若发现逻辑行变化，停下报告，不要自行修正。

核对方法建议：用 `git diff -M main..HEAD | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '` 把全部增删行过滤出来逐行分类，而不是通读整个 diff。

**注意**：`lib/channels/qq/client.ts` 里有一处 `scope: "onebot.enrich"` 字符串**有意未改**（可观察的日志标签，改名属行为变更，已记为遗留）。它出现在 diff 的上下文行里属正常，不要报成问题。

- [ ] **Step 4: 确认没有 `lib/onebot` 残留**

```bash
grep -rn "lib/onebot" --include='*.ts' --include='*.tsx' app lib components tests plugins scripts
grep -rn "lib/onebot" --include='*.md' docs CLAUDE.md
```

Expected: 源码范围内只剩 **1 处** —— `tests/architecture/layering.test.ts` 里的
`const RETIRED_PREFIXES = ["lib/onebot/"]`。那是 Step 2 要求存在的登记项，**不是残留**。
`app/`、`lib/`、`components/`、`plugins/`、`scripts/` 下应零命中。

`docs/` 范围会命中历史计划文档（如 `2026-07-05-group-picker.md`）—— 那些是**历史记录**，
描述当时的工作，不应改写，命中它们属正常。

**注意**：`grep "onebot/"`（不带 `lib/`）会有大量输出，那是 `/api/onebot/*` 这类 HTTP 路由、
配置键 `onebotWsUrl`、协议名 OneBot，都是**合法**的，不要当成残留。

- [ ] **Step 5: 确认护栏映射表已同步**

```bash
pnpm vitest run tests/architecture/layering.test.ts
grep -n "RETIRED_PREFIXES\|CURRENT_STAGE" tests/architecture/layering.test.ts
```

Expected: 7 个用例全绿；`RETIRED_PREFIXES` 为 `["lib/onebot/"]`；`CURRENT_STAGE` 为 `"1"`；
`TOLERATED` 仍恰为 3 条。

- [ ] **Step 6: 确认工作区干净**

```bash
git status --short
git stash list
```

Expected: `git status` 无输出。`git stash list` 里有一条既有残留（分支 `codex/perf-maintainability`），与本阶段无关，**不要动它**。

本任务不产生新提交 —— 它是验证步骤。若 Step 1–6 全部符合 Expected，阶段 1 即可收口。
