# 反思库压缩整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 定时把 `doc='human-reflection'` 反思条目喂 LLM 整理(近义合并、剔除被基础文档覆盖/矛盾者),整体替换并通知管理群,带安全底线防误清空。

**Architecture:** 新增旁路观察者模块 `reflection-compactor.ts`,结构与 `reflection-poller.ts` 对齐(`runCompact` 供测试直驱 + `registerReflectionCompactor` 定时器 + `running` 防重入门)。基础文档太大不整喂,按每条反思做向量检索取相关基础片段作权威上下文。整体替换走单事务,失败/异常输出保留旧库。

**Tech Stack:** TypeScript(Node 原生 strip)、better-sqlite3 + sqlite-vec、@anthropic-ai/claude-agent-sdk、vitest。

参考规格:`docs/superpowers/specs/2026-07-07-reflection-compaction-design.md`

---

## 文件结构

- Create: `lib/agent/reflection-compactor.ts` —— 压缩整理模块(runCompact + register + 校验)。
- Create: `tests/lib/agent/reflection-compactor.test.ts` —— 模块测试。
- Modify: `lib/db/repo.ts` —— 加 `searchBaseKb`、`replaceReflectionEntries`。
- Modify: `tests/lib/db/repo.test.ts`(若无则新建)—— 两方法测试。
- Modify: `lib/config-store.ts` —— 加 `reflectCompactMs`、`reflectCompactMinEntries`。
- Modify: `tests/lib/config-store.test.ts` —— 默认值/覆盖测试。
- Modify: `lib/assemble.ts` —— 接线 registerReflectionCompactor。
- Modify: `lib/runtime.ts` —— 透传两配置字段。

约定:`openDb(":memory:", 3)` 建 3 维向量库;测试 embed 用 `async () => new Float32Array([1, 0, 0])`,与之匹配。

---

## Task 1: repo.searchBaseKb —— 只检索基础文档

**Files:**
- Modify: `lib/db/repo.ts`(在 `searchKb` 之后)
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/lib/db/repo.test.ts` 追加(文件不存在则新建,头部见下):

```typescript
import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";

const vec = () => new Float32Array([1, 0, 0]);
const mkRepo = () => new Repo(openDb(":memory:", 3));

describe("searchBaseKb", () => {
  it("只返回非 human-reflection 条目", () => {
    const repo = mkRepo();
    repo.insertKbEntry("faq/x.md", "基础文档内容", "faq/x.md", vec());
    repo.insertKbEntry("human-reflection", "反思内容", "human-reflection:100:1", vec());
    const hits = repo.searchBaseKb(vec(), 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toBe("基础文档内容");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/db/repo.test.ts -t "searchBaseKb"`
Expected: FAIL —— `repo.searchBaseKb is not a function`

- [ ] **Step 3: 实现**

在 `lib/db/repo.ts` 的 `searchKb` 方法之后加:

```typescript
  // 只在基础文档(doc != human-reflection)里做向量近邻,供压缩整理取权威上下文。
  // vec0 KNN 需固定 k;doc 过滤在 join 后生效,故取 k*4 再过滤截断,避免被反思条目挤占额度。
  searchBaseKb(query: Float32Array, k: number): KbHit[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.source, v.distance
         FROM kb_vec v JOIN kb_chunks c ON c.id = v.chunk_id
         WHERE v.embedding MATCH ? AND k = ?
           AND c.doc != 'human-reflection'
         ORDER BY v.distance`
      )
      .all(Buffer.from(query.buffer), k * 4) as KbHit[];
    return rows.slice(0, k);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/db/repo.test.ts -t "searchBaseKb"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(repo): searchBaseKb 只检索基础文档"
```

---

## Task 2: repo.replaceReflectionEntries —— 整体替换反思条目

**Files:**
- Modify: `lib/db/repo.ts`(在 `searchBaseKb` 之后)
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `tests/lib/db/repo.test.ts`:

```typescript
describe("replaceReflectionEntries", () => {
  it("删旧 human-reflection + 插新,不动基础文档,向量数一致", () => {
    const repo = mkRepo();
    repo.insertKbEntry("faq/x.md", "基础", "faq/x.md", vec());
    repo.insertKbEntry("human-reflection", "旧1", "human-reflection:100:1", vec());
    repo.insertKbEntry("human-reflection", "旧2", "human-reflection:100:2", vec());

    repo.replaceReflectionEntries([{ content: "新条", embedding: vec() }], 12345);

    const refs = repo.reflectionEntries();
    expect(refs).toHaveLength(1);
    expect(refs[0].content).toBe("新条");
    expect(refs[0].groupId).toBe(0); // source = human-reflection:0:12345
    expect(refs[0].ts).toBe(12345);
    // 基础文档仍在
    expect(repo.searchBaseKb(vec(), 5)).toHaveLength(1);
    // chunk 与 vec 数一致(无孤儿)
    const t = repo.kbTotals();
    expect(t.chunks).toBe(t.vecs);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/db/repo.test.ts -t "replaceReflectionEntries"`
Expected: FAIL —— `repo.replaceReflectionEntries is not a function`

- [ ] **Step 3: 实现**

在 `lib/db/repo.ts` 的 `searchBaseKb` 之后加:

```typescript
  // 整体替换反思库(压缩整理用):单事务删全部 human-reflection chunk+vec,再逐条插入整理结果。
  // source 统一 human-reflection:0:{ts}(gid 0 = 已压缩,全局归属)。空 entries 由调用方安全底线拦截。
  replaceReflectionEntries(
    entries: { content: string; embedding: Float32Array }[],
    sourceTs: number
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM kb_vec WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE doc = 'human-reflection')"
        )
        .run();
      this.db.prepare("DELETE FROM kb_chunks WHERE doc = 'human-reflection'").run();
      for (const e of entries) {
        const id = this.insertKbChunk("human-reflection", e.content, `human-reflection:0:${sourceTs}`);
        this.insertKbVec(id, e.embedding);
      }
    })();
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/db/repo.test.ts -t "replaceReflectionEntries"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(repo): replaceReflectionEntries 整体替换反思库"
```

---

## Task 3: config 加 reflectCompactMs / reflectCompactMinEntries

**Files:**
- Modify: `lib/config-store.ts:5-22`(interface)、`:35-38`(seed)
- Test: `tests/lib/config-store.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `tests/lib/config-store.test.ts` 的 `describe("config-store", ...)` 内:

```typescript
  it("反思压缩默认值 + env 覆盖", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(cfg.reflectCompactMs).toBe(86_400_000);
    expect(cfg.reflectCompactMinEntries).toBe(10);
    const repo2 = mkRepo();
    const cfg2 = getConfig(repo2, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "1",
      ADMIN_GROUP_ID: "2",
      REFLECT_COMPACT_MS: "3600000",
      REFLECT_COMPACT_MIN_ENTRIES: "5",
    });
    expect(cfg2.reflectCompactMs).toBe(3_600_000);
    expect(cfg2.reflectCompactMinEntries).toBe(5);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/config-store.test.ts -t "反思压缩"`
Expected: FAIL —— `expected undefined to be 86400000`

- [ ] **Step 3: 实现**

`lib/config-store.ts` interface `AppConfig` 内,`reflectWindowMax: number;` 之后加:

```typescript
  reflectCompactMs: number;
  reflectCompactMinEntries: number;
```

`seedFromEnv` 内,`reflectWindowMax: Number(env.REFLECT_WINDOW_MAX ?? "60"),` 之后加:

```typescript
    reflectCompactMs: Number(env.REFLECT_COMPACT_MS ?? "86400000"),
    reflectCompactMinEntries: Number(env.REFLECT_COMPACT_MIN_ENTRIES ?? "10"),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/config-store.test.ts -t "反思压缩"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/config-store.ts tests/lib/config-store.test.ts
git commit -m "feat(config): reflectCompactMs / reflectCompactMinEntries"
```

---

## Task 4: reflection-compactor 核心 runCompact

**Files:**
- Create: `lib/agent/reflection-compactor.ts`
- Test: `tests/lib/agent/reflection-compactor.test.ts`

先建模块骨架(含所有导出与 `runCompact`,`registerReflectionCompactor` 的防重入门在 Task 5 加),再逐个行为写测试。

- [ ] **Step 1: 建模块**

Create `lib/agent/reflection-compactor.ts`:

```typescript
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus";
import type { Repo } from "../db/repo";
import { embed as defaultEmbed } from "../tools/embed";
import { sdkEnv } from "./agent";

export interface ReflectionCompactorDeps {
  repo: Repo;
  adminGroupId: number;
  compactMs?: number;
  minEntries?: number;
  baseContextK?: number;
  embed?: (text: string) => Promise<Float32Array>;
  queryFn?: typeof sdkQuery;
  now?: () => number;
}

interface Resolved {
  repo: Repo;
  adminGroupId: number;
  minEntries: number;
  baseContextK: number;
  embed: (text: string) => Promise<Float32Array>;
  queryFn: typeof sdkQuery;
  now: () => number;
}

const COMPACT_SYSTEM = `你是客服知识库整理助手。用户消息会给出两部分:
一、【权威基础文档片段】——正式产品文档节选,视为最新、最权威。
二、【现有反思条目】——历史沉淀的客服问答 FAQ,每条带序号。
任务:输出整理后的反思条目集,规则:
- 近义合并:表达同一问题要点的多条合并为一条更完整的 FAQ。
- 删除被基础文档覆盖:某条反思讲的内容基础文档已清楚覆盖,则删除(基础文档会被单独检索,无需在反思里重复)。
- 删除矛盾/失效:与基础文档或更完整反思冲突的旧条目删除。
硬约束:只能基于【现有反思条目】做合并与删除,不得新增基础片段之外的新事实,不得把基础文档片段本身写成反思条目。
只输出一个 JSON 数组,不要额外文字,不要 Markdown 代码块:
[{"faq":"整理后的问答要点,纯文本一段"}]
若全部应删除,仍至少保留信息量最高的若干条,不要输出空数组。`;

function resolve(deps: ReflectionCompactorDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    minEntries: deps.minEntries ?? 10,
    baseContextK: deps.baseContextK ?? 3,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
  };
}

function extractJsonArray(s: string): unknown {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function collectText(iter: unknown): Promise<string> {
  let out = "";
  for await (const msg of iter as AsyncIterable<any>) {
    if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) if (b.type === "text") out += b.text;
    }
  }
  return out;
}

// 安全底线:解析 + 校验 LLM 产出。返回整理后 faq 列表;任一异常返回 null(调用方保留旧库)。
export function validateCompacted(raw: string, inputCount: number): string[] | null {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) return null;
  const faqs = parsed
    .map((x) => (x && typeof x.faq === "string" ? x.faq.trim() : ""))
    .filter((s) => s.length > 0);
  if (faqs.length === 0 && inputCount > 0) return null; // 空集视为异常,防清空
  if (faqs.length > Math.ceil(inputCount * 1.5)) return null; // 暴涨视为无视约束
  return faqs;
}

// 执行一轮压缩整理,供测试直驱。旁路:异常保留旧库并 emit error,不抛。
export async function runCompact(deps: ReflectionCompactorDeps): Promise<void> {
  const d = resolve(deps);
  const entries = d.repo.reflectionEntries();
  if (entries.length < d.minEntries) return;

  // 权威上下文:逐条反思检索基础文档 top-k,按 chunk id 去重
  const ctx = new Map<number, string>();
  for (const e of entries) {
    for (const h of d.repo.searchBaseKb(await d.embed(e.content), d.baseContextK)) {
      ctx.set(h.id, h.content);
    }
  }
  const baseBlock = [...ctx.values()].map((c, i) => `(${i + 1}) ${c}`).join("\n");
  const refBlock = entries.map((e, i) => `[${i + 1}] ${e.content}`).join("\n");
  const prompt = `【权威基础文档片段】\n${baseBlock || "(无)"}\n\n【现有反思条目】\n${refBlock}`;

  let out: string;
  try {
    out = await collectText(
      d.queryFn({
        prompt,
        options: {
          systemPrompt: COMPACT_SYSTEM,
          canUseTool: async () => ({ behavior: "deny" as const, message: "压缩阶段不使用工具" }),
          maxTurns: 1,
          permissionMode: "default",
          settingSources: ["user"],
          env: sdkEnv(),
        } as never,
      })
    );
  } catch (err) {
    bus.emit("error.occurred", { scope: "reflection-compact", err });
    return;
  }

  const faqs = validateCompacted(out, entries.length);
  if (!faqs) {
    bus.emit("error.occurred", {
      scope: "reflection-compact",
      err: new Error("LLM 产出未过安全校验,保留旧库"),
    });
    return;
  }

  const withVec: { content: string; embedding: Float32Array }[] = [];
  for (const faq of faqs) withVec.push({ content: faq, embedding: await d.embed(faq) });
  d.repo.replaceReflectionEntries(withVec, d.now());

  bus.emit("action.send", {
    action: "send_group_msg",
    groupId: d.adminGroupId,
    text: `反思整理:${entries.length} → ${faqs.length} 条`,
  });
}

// Task 5 补 registerReflectionCompactor(定时器 + 防重入)
```

- [ ] **Step 2: 写测试文件头 + minEntries 跳过测试**

Create `tests/lib/agent/reflection-compactor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { runCompact, validateCompacted } from "@/lib/agent/reflection-compactor";

let repo: Repo;
const vec = () => new Float32Array([1, 0, 0]);
const embed = async () => vec();

function fakeQuery(text: string) {
  return () =>
    (async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text }] } };
      yield { type: "result", subtype: "success" };
    })();
}

function seedReflections(n: number) {
  for (let i = 0; i < n; i++) {
    repo.insertKbEntry("human-reflection", `反思${i}`, `human-reflection:100:${i}`, vec());
  }
}

const opts = (over: Record<string, unknown> = {}) => ({
  repo,
  adminGroupId: 999,
  embed,
  now: () => 7_000_000,
  minEntries: 3,
  ...over,
});

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("runCompact", () => {
  it("少于 minEntries → 跳过,不调 LLM,库不变", async () => {
    seedReflections(2);
    const qf = vi.fn(fakeQuery("[]"));
    await runCompact(opts({ queryFn: qf as never, minEntries: 3 }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.reflectionEntries()).toHaveLength(2);
  });
});
```

- [ ] **Step 3: 跑,确认通过(骨架已支持跳过)**

Run: `npx vitest run tests/lib/agent/reflection-compactor.test.ts -t "跳过"`
Expected: PASS

- [ ] **Step 4: 加正常整理测试**

追加到 `describe("runCompact", ...)`:

```typescript
  it("正常整理 → 库被替换为新集 + 通知管理群 + source 为 gid 0", async () => {
    seedReflections(5);
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    await runCompact(
      opts({
        queryFn: fakeQuery('[{"faq":"合并后的条目A"},{"faq":"合并后的条目B"}]') as never,
      })
    );
    const a = await notice;
    expect(a.groupId).toBe(999);
    expect(a.text).toContain("5 → 2");
    const refs = repo.reflectionEntries();
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.content).sort()).toEqual(["合并后的条目A", "合并后的条目B"]);
    expect(refs.every((r) => r.groupId === 0 && r.ts === 7_000_000)).toBe(true);
  });
```

- [ ] **Step 5: 跑,确认通过**

Run: `npx vitest run tests/lib/agent/reflection-compactor.test.ts -t "正常整理"`
Expected: PASS

- [ ] **Step 6: 加安全底线测试**

追加:

```typescript
  it("安全底线:空数组 → 保留旧库 + emit error,不替换", async () => {
    seedReflections(5);
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runCompact(opts({ queryFn: fakeQuery("[]") as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(5); // 未替换
    expect(spy).not.toHaveBeenCalled();
  });

  it("安全底线:非法 JSON → 保留旧库", async () => {
    seedReflections(5);
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runCompact(opts({ queryFn: fakeQuery("抱歉无法处理") as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(5);
  });

  it("安全底线:条目暴涨(> 输入 ×1.5)→ 保留旧库", async () => {
    seedReflections(4); // 上限 ceil(4*1.5)=6,给 7 条触发
    const arr = JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ faq: `x${i}` })));
    const err = new Promise<any>((res) => bus.once("error.occurred", res));
    await runCompact(opts({ queryFn: fakeQuery(arr) as never }));
    expect((await err).scope).toBe("reflection-compact");
    expect(repo.reflectionEntries()).toHaveLength(4);
  });
```

- [ ] **Step 7: 加 validateCompacted 单元测试**

追加(顶层新 describe):

```typescript
describe("validateCompacted", () => {
  it("正常 → 返回 trim 后非空 faq 列表", () => {
    expect(validateCompacted('[{"faq":" a "},{"faq":"b"}]', 3)).toEqual(["a", "b"]);
  });
  it("非数组 / 非法 → null", () => {
    expect(validateCompacted("不是JSON", 3)).toBeNull();
    expect(validateCompacted('{"faq":"a"}', 3)).toBeNull();
  });
  it("空集而输入非空 → null", () => {
    expect(validateCompacted("[]", 5)).toBeNull();
  });
  it("暴涨 > ×1.5 → null", () => {
    const arr = JSON.stringify(Array.from({ length: 7 }, () => ({ faq: "x" })));
    expect(validateCompacted(arr, 4)).toBeNull();
  });
  it("过滤空白 faq 后仍有内容 → 返回过滤结果", () => {
    expect(validateCompacted('[{"faq":"a"},{"faq":"  "},{"faq":""}]', 3)).toEqual(["a"]);
  });
});
```

- [ ] **Step 8: 跑全模块测试**

Run: `npx vitest run tests/lib/agent/reflection-compactor.test.ts`
Expected: PASS(全部)

- [ ] **Step 9: 提交**

```bash
git add lib/agent/reflection-compactor.ts tests/lib/agent/reflection-compactor.test.ts
git commit -m "feat(reflection): 压缩整理 runCompact + 安全底线校验"
```

---

## Task 5: registerReflectionCompactor —— 定时器 + 防重入门

**Files:**
- Modify: `lib/agent/reflection-compactor.ts`(文件末尾)
- Test: `tests/lib/agent/reflection-compactor.test.ts`

- [ ] **Step 1: 写失败测试(防重入)**

追加到 `describe("runCompact", ...)` 之外的新 describe:

```typescript
describe("registerReflectionCompactor 防重入", () => {
  it("上一轮未结束时下一 tick 跳过", async () => {
    const { registerReflectionCompactor } = await import("@/lib/agent/reflection-compactor");
    vi.useFakeTimers();
    try {
      seedReflections(5);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const qf = vi.fn(() =>
        (async function* () {
          await gate;
          yield { type: "assistant", message: { content: [{ type: "text", text: "[]" }] } };
        })()
      );
      const stop = registerReflectionCompactor(opts({ compactMs: 1000, queryFn: qf as never }));
      await vi.advanceTimersByTimeAsync(1000); // tick1:启动,卡 gate
      expect(qf).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000); // tick2:running=true → 跳过
      expect(qf).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/agent/reflection-compactor.test.ts -t "防重入"`
Expected: FAIL —— `registerReflectionCompactor is not a function`

- [ ] **Step 3: 实现**

替换 `lib/agent/reflection-compactor.ts` 末尾注释 `// Task 5 补 ...` 为:

```typescript
// 监听式装配:定时压缩,返回 teardown。旁路观察者,失败不阻断主链路。
export function registerReflectionCompactor(deps: ReflectionCompactorDeps): () => void {
  const compactMs = deps.compactMs ?? 86_400_000;
  let running = false; // 防重入:上一轮未结束则跳过本次触发
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runCompact(deps)
      .catch((err) => bus.emit("error.occurred", { scope: "reflection-compact", err }))
      .finally(() => {
        running = false;
      });
  }, compactMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/agent/reflection-compactor.test.ts -t "防重入"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/agent/reflection-compactor.ts tests/lib/agent/reflection-compactor.test.ts
git commit -m "feat(reflection): registerReflectionCompactor 定时器 + 防重入门"
```

---

## Task 6: 接线 assemble + runtime

**Files:**
- Modify: `lib/assemble.ts:9`(import)、`:20-30`(deps)、`:49-58`(注册)
- Modify: `lib/runtime.ts:109-112`(透传)

无独立测试(接线),靠 typecheck + 全量测试 + 现有 assemble/runtime 测试守护。

- [ ] **Step 1: assemble 加 import**

`lib/assemble.ts` 第 9 行 `import { registerReflectionPoller } ...` 之后加:

```typescript
import { registerReflectionCompactor } from "./agent/reflection-compactor";
```

- [ ] **Step 2: assemble 加 deps 字段**

`AssembleDeps` interface 内 `reflectWindowMax?: number;` 之后加:

```typescript
  reflectCompactMs?: number;
  reflectCompactMinEntries?: number;
```

- [ ] **Step 3: assemble 注册 compactor**

`lib/assemble.ts` 中 `registerReflectionPoller({...})` 那个数组项之后、`]` 之前,不加(定时器可选)。改为在 `const cleanups = [...]` 之后、`if (deps.proactiveEnabled)` 之前插入:

```typescript
  if ((deps.reflectCompactMs ?? 86_400_000) > 0) {
    cleanups.push(
      registerReflectionCompactor({
        repo,
        adminGroupId,
        compactMs: deps.reflectCompactMs,
        minEntries: deps.reflectCompactMinEntries,
      })
    );
  }
```

- [ ] **Step 4: runtime 透传**

`lib/runtime.ts` 中 `this.teardown = builders.assemble({...})` 内,`reflectWindowMax: cfg.reflectWindowMax,` 之后加:

```typescript
        reflectCompactMs: cfg.reflectCompactMs,
        reflectCompactMinEntries: cfg.reflectCompactMinEntries,
```

- [ ] **Step 5: typecheck + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `No errors found` + 全 PASS

- [ ] **Step 6: 提交**

```bash
git add lib/assemble.ts lib/runtime.ts
git commit -m "feat(reflection): 接线定时压缩到 assemble/runtime"
```

---

## Task 7: 端到端幂等冒烟(可选,不改产品码)

**Files:**
- Test: `tests/lib/agent/reflection-compactor.test.ts`

- [ ] **Step 1: 加幂等测试**

追加到 `describe("runCompact", ...)`:

```typescript
  it("对已压缩集(gid 0)再跑一轮不报错,产出替换成功", async () => {
    // 首轮:5 → 2
    seedReflections(5);
    await runCompact(opts({ queryFn: fakeQuery('[{"faq":"甲"},{"faq":"乙"}]') as never }));
    expect(repo.reflectionEntries()).toHaveLength(2);
    // 次轮:2 条(< minEntries 3)→ 跳过,不变
    const qf = vi.fn(fakeQuery('[{"faq":"甲"}]'));
    await runCompact(opts({ queryFn: qf as never, minEntries: 3 }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.reflectionEntries()).toHaveLength(2);
  });
```

- [ ] **Step 2: 跑,确认通过**

Run: `npx vitest run tests/lib/agent/reflection-compactor.test.ts -t "幂等"`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/lib/agent/reflection-compactor.test.ts
git commit -m "test(reflection): 压缩幂等冒烟"
```

---

## 完成校验

- [ ] `npx tsc --noEmit` 无错。
- [ ] `npx vitest run` 全绿。
- [ ] 手工确认:`data/agent.db` 上跑一次 `runCompact`(临时脚本或 REPL)后,`reflectionEntries()` 条数下降且 source 前缀为 `human-reflection:0:`(真实 LLM 冒烟,非必须但推荐)。
