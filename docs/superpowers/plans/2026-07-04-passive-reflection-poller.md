# 被动反思沉淀（轮询缓冲版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用「群消息落库缓冲 + 定时器扫窗口 + LLM 批判有效性」的被动反思，取代依赖转人工的事件驱动反思，并彻底移除整个 handoff 子系统。

**Architecture:** 新增旁路 `registerMessageBuffer`（每条用户群消息落 `group_messages` 表）与 `registerReflectionPoller`（`setInterval` 扫「已沉降」时间带 `(cursor, now-settle]`，把每个含管理发言的群近 `lookback` 窗口喂 LLM，判定「管理发言是否有效解答用户问题」，有效则 embed 入 KB）。游标用现有 `config` 表存。删除 handoff 工具 / handoff-handler / reflection-handler / human_mode 全套。

**Tech Stack:** TypeScript, better-sqlite3 + sqlite-vec, `@anthropic-ai/claude-agent-sdk`（单轮无工具）, vitest, mitt 事件总线（`lib/bus`）。

---

## File Structure

**新增：**
- `lib/agent/message-buffer.ts` — 监听 `message.received`，落库群消息（排除管理群/bot/空文本）
- `lib/agent/reflection-poller.ts` — 定时扫描 + LLM 判定 + 沉淀（含可单测的 `runScan`）
- `tests/lib/agent/message-buffer.test.ts`
- `tests/lib/agent/reflection-poller.test.ts`

**修改：**
- `lib/db/index.ts` — 加 `group_messages` 表 + 索引
- `lib/db/repo.ts` — 加 buffer/cursor 方法；删 6 个 handoff 方法
- `lib/config-store.ts` — AppConfig 加 4 个 reflect 字段 + env seed
- `lib/assemble.ts` — 换注册（去 handoff/reflection，加 buffer/poller），去 `timeoutMin`
- `lib/runtime.ts` — assemble 调用传 reflect 配置，去 `timeoutMin`
- `lib/agent/gateway.ts` — 删管理回复块 + `isHumanMode` 判断 + `!resume` 命令
- `lib/tools/index.ts` — 去 handoff 工具与工具名
- `lib/agent/agent.ts` — system prompt 去转人工引导行
- `lib/events.ts` — 删 3 个 handoff 事件与 interface
- `tests/lib/db/repo.test.ts` — 删 handoff 用例，加 buffer/cursor 用例
- `tests/lib/agent/gateway.test.ts` — 删 handoff 用例

**删除：**
- `lib/tools/handoff.ts`
- `lib/agent/handoff-handler.ts`
- `lib/agent/reflection-handler.ts`
- `tests/lib/agent/handoff-handler.test.ts`
- `tests/lib/agent/reflection-handler.test.ts`

**运行命令：** 单测 `npx vitest run <文件>`；全量 `npm test`；类型 `npm run typecheck`。

---

## Task 1: DB schema — group_messages 表

**Files:**
- Modify: `lib/db/index.ts:15-51`（migrate 的 `db.exec` 建表块）
- Test: `tests/lib/db/repo.test.ts`（Task 2 覆盖，本任务仅建表）

- [ ] **Step 1: 加建表 SQL**

在 `lib/db/index.ts` 的 `migrate()` 内 `db.exec(\`...\`)` 模板字符串末尾（`config` 表之后、闭合反引号之前）追加：

```sql
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      sender_role TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_gm_group_time ON group_messages(group_id, created_at);
```

- [ ] **Step 2: 类型检查通过**

Run: `npm run typecheck`
Expected: 无错误（纯 SQL 追加，不改 TS 类型）

- [ ] **Step 3: Commit**

```bash
git add lib/db/index.ts
git commit -m "feat(db): group_messages 缓冲表(被动反思用)"
```

---

## Task 2: Repo — buffer + cursor 方法

**Files:**
- Modify: `lib/db/repo.ts`（在 `seenMessage` 之前插入新方法）
- Test: `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/lib/db/repo.test.ts` 末尾追加：

```ts
describe("Repo group_messages buffer", () => {
  it("落库后能按窗口升序取回,并按 limit 截最近", () => {
    repo.bufferGroupMessage(100, 200, "member", "问题一");
    repo.bufferGroupMessage(100, 201, "admin", "回答一");
    repo.bufferGroupMessage(999, 300, "member", "别的群"); // 不同群
    const win = repo.groupMessageWindow(100, 0, 10);
    expect(win.map((m) => m.text)).toEqual(["问题一", "回答一"]);
    expect(win[1].senderRole).toBe("admin");
    expect(win[1].userId).toBe(201);
  });

  it("groupsWithAdminMessagesBetween 只返带 owner/admin 且时间带内的群", () => {
    const now = Date.now();
    // 手动指定 created_at 以控时间带
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(100, 201, "admin", "带内客服", now - 100);
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(101, 202, "member", "带内用户", now - 100); // 非管理
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(102, 203, "owner", "带外客服", now - 99999); // 太早
    const groups = repo.groupsWithAdminMessagesBetween(now - 1000, now);
    expect(groups).toEqual([100]);
  });

  it("pruneGroupMessages 删早于阈值的行", () => {
    const now = Date.now();
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(100, 200, "member", "旧", now - 10000);
    repo.bufferGroupMessage(100, 200, "member", "新");
    repo.pruneGroupMessages(now - 5000);
    expect(repo.groupMessageWindow(100, 0, 10).map((m) => m.text)).toEqual(["新"]);
  });

  it("reflectCursor 缺省 0,可读写 round-trip", () => {
    expect(repo.reflectCursor()).toBe(0);
    repo.setReflectCursor(123456);
    expect(repo.reflectCursor()).toBe(123456);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/db/repo.test.ts`
Expected: FAIL —「repo.bufferGroupMessage is not a function」等

- [ ] **Step 3: 实现方法**

在 `lib/db/repo.ts` 的 `seenMessage(` 方法之前插入：

```ts
  // 群消息缓冲(被动反思用):落库
  bufferGroupMessage(groupId: number, userId: number, senderRole: string | null, text: string): void {
    this.db
      .prepare(
        "INSERT INTO group_messages (group_id, user_id, sender_role, text) VALUES (?, ?, ?, ?)"
      )
      .run(groupId, userId, senderRole, text);
  }

  // 指定时间带 (afterTs, untilTs] 内含 owner/admin 发言的 group,去重
  groupsWithAdminMessagesBetween(afterTs: number, untilTs: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT group_id FROM group_messages
         WHERE created_at > ? AND created_at <= ? AND sender_role IN ('owner','admin')
         ORDER BY group_id`
      )
      .all(afterTs, untilTs) as { group_id: number }[];
    return rows.map((r) => r.group_id);
  }

  // 某群 sinceTs 之后最近 limit 条,按时间升序返回
  groupMessageWindow(
    groupId: number,
    sinceTs: number,
    limit: number
  ): { userId: number; senderRole: string | null; text: string; createdAt: number }[] {
    const rows = this.db
      .prepare(
        `SELECT user_id, sender_role, text, created_at FROM group_messages
         WHERE group_id = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(groupId, sinceTs, limit) as {
      user_id: number;
      sender_role: string | null;
      text: string;
      created_at: number;
    }[];
    return rows
      .map((r) => ({ userId: r.user_id, senderRole: r.sender_role, text: r.text, createdAt: r.created_at }))
      .reverse();
  }

  pruneGroupMessages(beforeTs: number): void {
    this.db.prepare("DELETE FROM group_messages WHERE created_at < ?").run(beforeTs);
  }

  // 反思游标(已处理到的时间戳),复用 config 表
  reflectCursor(): number {
    return Number(this.getConfigRow("reflect_cursor") ?? "0");
  }

  setReflectCursor(ts: number): void {
    this.setConfigRow("reflect_cursor", String(ts));
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/lib/db/repo.test.ts`
Expected: PASS（新增 4 用例全绿；注意此文件旧 handoff 用例 Task 9 才删，本步应仍全绿）

- [ ] **Step 5: Commit**

```bash
git add lib/db/repo.ts tests/lib/db/repo.test.ts
git commit -m "feat(db): repo 群消息缓冲/窗口/剪枝/反思游标方法"
```

---

## Task 3: message-buffer 观察者

**Files:**
- Create: `lib/agent/message-buffer.ts`
- Test: `tests/lib/agent/message-buffer.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/lib/agent/message-buffer.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerMessageBuffer } from "@/lib/agent/message-buffer";
import type { IncomingMessage } from "@/lib/events";

let repo: Repo;

function msg(over: Partial<IncomingMessage>): IncomingMessage {
  return { groupId: 100, userId: 200, messageId: 1, rawText: "hi", atList: [], ...over };
}

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("message-buffer", () => {
  it("普通用户群消息落库(含 senderRole)", () => {
    const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999 });
    bus.emit("message.received", msg({ senderRole: "admin", rawText: "答案" }));
    const win = repo.groupMessageWindow(100, 0, 10);
    expect(win).toHaveLength(1);
    expect(win[0].senderRole).toBe("admin");
    stop();
  });

  it("排除管理群 / bot 自己 / 空文本", () => {
    const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999 });
    bus.emit("message.received", msg({ groupId: 999, rawText: "管理群" }));
    bus.emit("message.received", msg({ userId: 1, rawText: "bot 自己" }));
    bus.emit("message.received", msg({ rawText: "   " }));
    expect(repo.groupMessageWindow(100, 0, 10)).toHaveLength(0);
    expect(repo.groupMessageWindow(999, 0, 10)).toHaveLength(0);
    stop();
  });

  it("teardown 后不再落库", () => {
    const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999 });
    stop();
    bus.emit("message.received", msg({ rawText: "之后" }));
    expect(repo.groupMessageWindow(100, 0, 10)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/agent/message-buffer.test.ts`
Expected: FAIL —「Cannot find module '@/lib/agent/message-buffer'」

- [ ] **Step 3: 实现**

新建 `lib/agent/message-buffer.ts`：

```ts
import { bus } from "../bus";
import type { Repo } from "../db/repo";
import type { IncomingMessage } from "../events";

export interface MessageBufferDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
}

// 旁路缓冲:每条用户群消息落 group_messages,供反思轮询回看。
// 排除管理群、bot 自己、空文本;不做 @bot 过滤(反思要看全量对话上下文)。
export function registerMessageBuffer(deps: MessageBufferDeps): () => void {
  const { repo, botQQ, adminGroupId } = deps;

  const onReceived = (msg: IncomingMessage) => {
    if (msg.groupId === adminGroupId) return;
    if (msg.userId === botQQ) return;
    if (!msg.rawText?.trim()) return;
    try {
      repo.bufferGroupMessage(msg.groupId, msg.userId, msg.senderRole ?? null, msg.rawText);
    } catch (err) {
      bus.emit("error.occurred", { scope: "message-buffer", err });
    }
  };

  bus.on("message.received", onReceived);
  return () => bus.off("message.received", onReceived);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/lib/agent/message-buffer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent/message-buffer.ts tests/lib/agent/message-buffer.test.ts
git commit -m "feat(agent): message-buffer 落库群消息(反思缓冲)"
```

---

## Task 4: reflection-poller 扫描与判定

**Files:**
- Create: `lib/agent/reflection-poller.ts`
- Test: `tests/lib/agent/reflection-poller.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/lib/agent/reflection-poller.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { runScan } from "@/lib/agent/reflection-poller";

let repo: Repo;
const embed = async () => new Float32Array([1, 0, 0]); // 与 openDb(:memory:,3) 一致

// 假 query:产出单条 assistant 文本
function fakeQuery(text: string) {
  return async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text }] } };
    yield { type: "result", subtype: "success" };
  };
}

// 用固定 now 造时间带内消息:seedAt 相对 now 的偏移(ms,负数=更早)
function seed(groupId: number, userId: number, role: string, text: string, at: number) {
  (repo as any).db
    .prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
    .run(groupId, userId, role, text, at);
}

const NOW = 10_000_000;
const opts = (over: Record<string, unknown> = {}) => ({
  repo,
  adminGroupId: 999,
  embed,
  now: () => NOW,
  scanMs: 1, // 不用于 runScan
  lookbackMs: 1_000_000,
  settleMs: 1000,
  windowMax: 60,
  ...over,
});

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("reflection-poller runScan", () => {
  it("有效解答 → 入库 + 通知管理群 + 推进游标", async () => {
    // 已沉降带 (0, NOW-settle=9_999_000]
    seed(100, 200, "member", "退款多久到账?", NOW - 5000);
    seed(100, 201, "admin", "一般 3 个工作日", NOW - 4000);
    seed(100, 200, "member", "好的谢谢解决了", NOW - 3000);
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    await runScan(
      opts({
        queryFn: fakeQuery(
          '[{"question":"退款多久到账","answer":"3个工作日","effective":true,"faq":"退款一般 3 个工作日到账"}]'
        ) as never,
      })
    );
    const a = await notice;
    expect(a.groupId).toBe(999);
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 1);
    expect(hits[0].content).toContain("退款");
    expect(hits[0].source).toContain("human-reflection:100:");
    expect(repo.reflectCursor()).toBe(NOW - 1000); // until = now - settle
  });

  it("effective=false → 不入库不通知", async () => {
    seed(100, 201, "admin", "在的亲", NOW - 4000);
    const spy = vi.fn();
    bus.on("action.send", spy);
    await runScan(opts({ queryFn: fakeQuery('[{"effective":false}]') as never }));
    expect(spy).not.toHaveBeenCalled();
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0);
  });

  it("时间带内无管理发言 → 不调用 LLM,游标仍推进", async () => {
    seed(100, 200, "member", "只有用户发言", NOW - 4000);
    const qf = vi.fn(fakeQuery("[]"));
    await runScan(opts({ queryFn: qf as never }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.reflectCursor()).toBe(NOW - 1000);
  });

  it("太新(settle 带内)的管理发言不被处理", async () => {
    // at = NOW-500 > until(NOW-1000) → 不在已沉降带
    seed(100, 201, "admin", "刚说的", NOW - 500);
    const qf = vi.fn(fakeQuery("[]"));
    await runScan(opts({ queryFn: qf as never }));
    expect(qf).not.toHaveBeenCalled();
  });

  it("LLM 输出非法 JSON → 不入库不抛", async () => {
    seed(100, 201, "admin", "答案", NOW - 4000);
    await runScan(opts({ queryFn: fakeQuery("抱歉无法处理") as never }));
    expect(repo.searchKb(new Float32Array([1, 0, 0]), 1)).toHaveLength(0);
    expect(repo.reflectCursor()).toBe(NOW - 1000); // 仍推进
  });

  it("until <= cursor → 直接跳过(不重复处理)", async () => {
    repo.setReflectCursor(NOW); // 游标已在 now,until=now-settle < cursor
    seed(100, 201, "admin", "答案", NOW - 4000);
    const qf = vi.fn(fakeQuery("[]"));
    await runScan(opts({ queryFn: qf as never }));
    expect(qf).not.toHaveBeenCalled();
    expect(repo.reflectCursor()).toBe(NOW); // 不动
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/agent/reflection-poller.test.ts`
Expected: FAIL —「Cannot find module '@/lib/agent/reflection-poller'」

- [ ] **Step 3: 实现**

新建 `lib/agent/reflection-poller.ts`：

```ts
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus";
import type { Repo } from "../db/repo";
import { embed as defaultEmbed } from "../tools/embed";

export interface ReflectionPollerDeps {
  repo: Repo;
  adminGroupId: number;
  scanMs?: number;
  lookbackMs?: number;
  settleMs?: number;
  windowMax?: number;
  embed?: (text: string) => Promise<Float32Array>;
  queryFn?: typeof sdkQuery;
  now?: () => number;
}

interface Resolved {
  repo: Repo;
  adminGroupId: number;
  lookbackMs: number;
  settleMs: number;
  windowMax: number;
  embed: (text: string) => Promise<Float32Array>;
  queryFn: typeof sdkQuery;
  now: () => number;
}

const REFLECT_SYSTEM = `你是客服知识运营助手。用户消息会给出一段 QQ 群对话记录,每行格式 [ts=毫秒][角色 QQ] 文本,角色为"客服"(群主/群管)或"用户",并给出一个已沉降时间区间。
任务:只针对 ts 落在该区间内、且角色为"客服"的发言,判断它是否在有效解答某个用户问题。区间外与用户发言仅作上下文。
有效性(两信号):优先看后续 —— 该客服回答之后,提问用户是否表示感谢/确认解决/不再追问,是则有效;若窗口内该问题没有用户后续,则退回判断回答本身是否完整、正确、可复用。
排除(判为无效/跳过):闲聊寒暄、纯指令、与提问无关、信息不足、一次性、含隐私(订单号/手机号)。
对每条有效解答输出一个对象,faq 需脱离本次上下文、含问题要点与结论,纯文本一段。
只输出一个 JSON 数组,不要额外文字,不要 Markdown 代码块:
[{"question":"...","answer":"...","effective":true,"faq":"..."}]
无可沉淀输出 []。`;

function extractJsonArray(s: string): any[] {
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function label(role: string | null): string {
  return role === "owner" || role === "admin" ? "客服" : "用户";
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

function resolve(deps: ReflectionPollerDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    lookbackMs: deps.lookbackMs ?? 7_200_000,
    settleMs: deps.settleMs ?? 600_000,
    windowMax: deps.windowMax ?? 60,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
  };
}

async function scanOnce(d: Resolved): Promise<void> {
  const now = d.now();
  const cursor = d.repo.reflectCursor();
  const until = now - d.settleMs;
  if (until <= cursor) return; // 无新沉降带

  for (const groupId of d.repo.groupsWithAdminMessagesBetween(cursor, until)) {
    try {
      const window = d.repo.groupMessageWindow(groupId, now - d.lookbackMs, d.windowMax);
      if (!window.length) continue;
      const transcript = window
        .map((m) => `[ts=${m.createdAt}][${label(m.senderRole)} ${m.userId}] ${m.text}`)
        .join("\n");
      const prompt = `已沉降时间区间(只判定此区间内客服发言):(${cursor}, ${until}]\n\n对话记录:\n${transcript}`;
      const out = await collectText(
        d.queryFn({
          prompt,
          options: {
            systemPrompt: { type: "preset", preset: "claude_code", append: REFLECT_SYSTEM },
            canUseTool: async () => ({ behavior: "deny" as const, message: "反思阶段不使用工具" }),
            maxTurns: 1,
            settingSources: ["user"],
          } as never,
        })
      );
      for (const it of extractJsonArray(out)) {
        if (!it || it.effective !== true || typeof it.faq !== "string" || !it.faq.trim()) continue;
        const faq = it.faq.trim();
        const id = d.repo.insertKbChunk("human-reflection", faq, `human-reflection:${groupId}:${d.now()}`);
        d.repo.insertKbVec(id, await d.embed(faq));
        bus.emit("action.send", {
          action: "send_group_msg",
          groupId: d.adminGroupId,
          text: `已从群 ${groupId} 的人工回复沉淀 1 条知识:${faq.slice(0, 40)}${faq.length > 40 ? "…" : ""}`,
        });
      }
    } catch (err) {
      bus.emit("error.occurred", { scope: "reflection", err, groupId });
    }
  }

  d.repo.setReflectCursor(until);
  d.repo.pruneGroupMessages(now - d.lookbackMs - d.settleMs);
}

// 供测试直接驱动一次扫描
export async function runScan(deps: ReflectionPollerDeps): Promise<void> {
  await scanOnce(resolve(deps));
}

// 监听式装配:定时扫描,返回 teardown。旁路观察者,失败不阻断主链路。
export function registerReflectionPoller(deps: ReflectionPollerDeps): () => void {
  const d = resolve(deps);
  const scanMs = deps.scanMs ?? 300_000;
  const timer = setInterval(() => {
    void scanOnce(d).catch((err) => bus.emit("error.occurred", { scope: "reflection", err }));
  }, scanMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/lib/agent/reflection-poller.test.ts`
Expected: PASS（6 用例全绿）

- [ ] **Step 5: Commit**

```bash
git add lib/agent/reflection-poller.ts tests/lib/agent/reflection-poller.test.ts
git commit -m "feat(agent): reflection-poller 扫窗口 LLM 判定有效性并沉淀"
```

---

## Task 5: Config — reflect 参数

**Files:**
- Modify: `lib/config-store.ts:5-27`
- Test: `tests/lib/config-store.test.ts`（追加断言）

- [ ] **Step 1: 写失败测试**

在 `tests/lib/config-store.test.ts` 里，找到断言 `seedFromEnv`/`getConfig` 默认值的 `it` 块，追加一个新 `it`（放在该文件最后一个 `it` 之后、`describe` 闭合前）：

```ts
  it("reflect 参数有默认值,env 可覆盖", () => {
    const repo = new Repo(openDb(":memory:", 3));
    const cfg = getConfig(repo, { REFLECT_SETTLE_MS: "1000" } as any);
    expect(cfg.reflectSettleMs).toBe(1000);
    expect(cfg.reflectScanMs).toBe(300000); // 默认
    expect(cfg.reflectLookbackMs).toBe(7200000);
    expect(cfg.reflectWindowMax).toBe(60);
  });
```

> 若该测试文件顶部未 import `Repo`/`openDb`/`getConfig`，补齐 import（参照文件现有 import 行）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/config-store.test.ts`
Expected: FAIL —「reflectSettleMs 为 undefined」

- [ ] **Step 3: 实现**

`lib/config-store.ts` 的 `AppConfig` interface 内（`model` 之后）追加：

```ts
  reflectScanMs: number;
  reflectLookbackMs: number;
  reflectSettleMs: number;
  reflectWindowMax: number;
```

`seedFromEnv` 的 return 对象内（`model` 之后）追加：

```ts
    reflectScanMs: Number(env.REFLECT_SCAN_MS ?? "300000"),
    reflectLookbackMs: Number(env.REFLECT_LOOKBACK_MS ?? "7200000"),
    reflectSettleMs: Number(env.REFLECT_SETTLE_MS ?? "600000"),
    reflectWindowMax: Number(env.REFLECT_WINDOW_MAX ?? "60"),
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/lib/config-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/config-store.ts tests/lib/config-store.test.ts
git commit -m "feat(config): reflect 轮询参数(scan/lookback/settle/windowMax)"
```

---

## Task 6: 装配换线 — assemble + runtime

**Files:**
- Modify: `lib/assemble.ts`
- Modify: `lib/runtime.ts:90-96`
- Test: `tests/lib/assemble.test.ts`, `tests/lib/runtime.test.ts`

> 本任务只改装配：加 buffer+poller、去 handoff/reflection 注册与 `timeoutMin`。被删的 `lib/agent/handoff-handler.ts` / `reflection-handler.ts` 文件在 Task 9 才物理删除；本任务先摘除对它们的 import 与注册，编译仍通过（旧文件变为无人引用）。

- [ ] **Step 1: 改 assemble 实现**

将 `lib/assemble.ts` 全文替换为：

```ts
import type { Repo } from "./db/repo";
import type { Agent } from "./agent/agent";
import { SessionStore } from "./agent/session";
import { registerGateway } from "./agent/gateway";
import { registerOrchestrator } from "./agent/orchestrator";
import { registerReplyMapper } from "./agent/reply-mapper";
import { registerMessageBuffer } from "./agent/message-buffer";
import { registerReflectionPoller } from "./agent/reflection-poller";
import { registerErrorHandler } from "./agent/error-handler";

export interface AssembleDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  agent: Agent;
  reflectScanMs?: number;
  reflectLookbackMs?: number;
  reflectSettleMs?: number;
  reflectWindowMax?: number;
}

/** 装配全链路,返回 teardown 用于热重载时卸载监听器与定时器 */
export function assemble(deps: AssembleDeps): () => void {
  const { repo, botQQ, adminGroupId, agent } = deps;
  const cleanups = [
    registerErrorHandler(),
    registerGateway({ repo, botQQ, adminGroupId }),
    registerOrchestrator({ agent, store: new SessionStore(repo) }),
    registerReplyMapper(),
    registerMessageBuffer({ repo, botQQ, adminGroupId }),
    registerReflectionPoller({
      repo,
      adminGroupId,
      scanMs: deps.reflectScanMs,
      lookbackMs: deps.reflectLookbackMs,
      settleMs: deps.reflectSettleMs,
      windowMax: deps.reflectWindowMax,
    }),
  ];
  return () => cleanups.forEach((c) => c());
}
```

- [ ] **Step 2: 改 runtime 调用**

`lib/runtime.ts` 中 `builders.assemble({...})` 调用（约 90-96 行）替换为：

```ts
      this.teardown = builders.assemble({
        repo,
        botQQ: cfg.botQQ,
        adminGroupId: cfg.adminGroupId,
        agent,
        reflectScanMs: cfg.reflectScanMs,
        reflectLookbackMs: cfg.reflectLookbackMs,
        reflectSettleMs: cfg.reflectSettleMs,
        reflectWindowMax: cfg.reflectWindowMax,
      });
```

- [ ] **Step 3: 修 assemble/runtime 测试**

在 `tests/lib/assemble.test.ts` 与 `tests/lib/runtime.test.ts` 中：删除对 `timeoutMin` 的传参；若断言了 `registerHandoffHandler`/`registerReflectionHandler` 被调用，改为不再断言（或改断言 buffer/poller）。若测试 mock 了 `assemble` 的 builders，确保不再引用 `timeoutMin`。

> 具体改动依测试现状而定：搜索这两文件中的 `timeoutMin`/`handoff`/`reflection` 逐处调整。运行 Step 4 定位残留。

- [ ] **Step 4: 类型检查 + 跑受影响测试**

Run: `npm run typecheck && npx vitest run tests/lib/assemble.test.ts tests/lib/runtime.test.ts`
Expected: PASS（若 typecheck 报 `reflectScanMs` 不存在于 cfg，确认 Task 5 已合并）

- [ ] **Step 5: Commit**

```bash
git add lib/assemble.ts lib/runtime.ts tests/lib/assemble.test.ts tests/lib/runtime.test.ts
git commit -m "refactor(assemble): 换线 message-buffer + reflection-poller,去 timeoutMin"
```

---

## Task 7: gateway — 移除 handoff/human_mode

**Files:**
- Modify: `lib/agent/gateway.ts`
- Test: `tests/lib/agent/gateway.test.ts`

- [ ] **Step 1: 改 gateway 测试(先删 handoff 用例)**

在 `tests/lib/agent/gateway.test.ts` 中删除以下用例（按 `it` 描述搜索并整块删除）：涉及 `!resume`、`handoff.humanReply`、管理员发言触发反思、`isHumanMode` 拦截 的所有 `it`。保留：管理群 `!reset`、`@bot` 过滤、去重、用户自助 `重置` 关键词、正常 `message.qualified` 派发 等用例。

- [ ] **Step 2: 改 gateway 实现**

`lib/agent/gateway.ts` 中：

1. 删除管理群命令块里的 `!resume` 分支（约 20-21 行）：
```ts
      const mResume = msg.rawText.match(/^!resume\s+(\S+)/);
      if (mResume) { bus.emit("handoff.resumed", { sessionKey: mResume[1] }); return; }
```
2. 整块删除「人工接管期」检测（约 34-47 行，从注释 `// 人工接管期` 到该 `if` 块闭合）。
3. 删除人工接管拦截行（约 52 行）：
```ts
    if (repo.isHumanMode(sessionKey)) return;       // 人工接管中
```

保留 `!reset`（清 resumeId）与其余逻辑不动。

- [ ] **Step 3: 类型检查 + 跑 gateway 测试**

Run: `npm run typecheck && npx vitest run tests/lib/agent/gateway.test.ts`
Expected: 若 typecheck 报 `handoff.resumed`/`handoff.humanReply` 事件仍存在则正常（Task 9 才删事件）；gateway 测试 PASS

- [ ] **Step 4: Commit**

```bash
git add lib/agent/gateway.ts tests/lib/agent/gateway.test.ts
git commit -m "refactor(gateway): 移除 handoff/human_mode 拦截与 !resume"
```

---

## Task 8: tools + agent prompt — 摘掉 handoff 工具

**Files:**
- Modify: `lib/tools/index.ts`
- Modify: `lib/agent/agent.ts:72`（system prompt）
- Test: `tests/lib/tools/tools.test.ts`

- [ ] **Step 1: 改 tools 测试**

`tests/lib/tools/tools.test.ts` 中删除断言 `mcp__cs__handoff_to_human` 存在于 `TOOL_NAMES`、或测试 `makeHandoffTool`/`handoff_to_human` 的用例。若有断言 `TOOL_NAMES.length === 3`，改为 `=== 2`。

- [ ] **Step 2: 改 tools/index.ts**

```ts
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Repo } from "../db/repo";
import { embed } from "./embed";
import { makeKbTool } from "./kb";
import { makeOrderTool } from "./biz";
import { DIM } from "../db/index";

export const TOOL_NAMES = ["mcp__cs__kb_search", "mcp__cs__lookup_order"];

// 当前消息的会话上下文(orchestrator 绑定,当前工具未使用,保留以兼容调用签名)
export interface ToolContext {
  sessionKey: string;
  groupId: number;
  userId: number;
}

// 按消息构建:kb/order 无状态
export function buildToolServer(repo: Repo, _ctx: ToolContext) {
  return createSdkMcpServer({
    name: "cs",
    version: "1.0.0",
    tools: [makeKbTool(repo, embed, DIM), makeOrderTool()],
  });
}
```

- [ ] **Step 3: 改 agent.ts system prompt**

`lib/agent/agent.ts` 的 `DEFAULT_SYSTEM` 中删除转人工引导行（约 72 行）：
```
- 遇到下列情形调用 handoff_to_human 转人工:用户明确要求人工、投诉或情绪激烈、知识库无法解决、涉及退款 / 赔付 / 账号异常等需人工裁量的事项。
```
并把第 7 行注释 `// 按消息构建工具服务器,把当前会话上下文绑进 handoff 工具` 改为 `// 按消息构建工具服务器(kb/order)`。

- [ ] **Step 4: 类型检查 + 跑 tools/agent 测试**

Run: `npm run typecheck && npx vitest run tests/lib/tools/tools.test.ts tests/lib/agent/agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tools/index.ts lib/agent/agent.ts tests/lib/tools/tools.test.ts
git commit -m "refactor(tools): 移除 handoff 工具与 system prompt 转人工引导"
```

---

## Task 9: 删文件 + events + repo handoff 方法（收口）

**Files:**
- Delete: `lib/tools/handoff.ts`, `lib/agent/handoff-handler.ts`, `lib/agent/reflection-handler.ts`
- Delete: `tests/lib/agent/handoff-handler.test.ts`, `tests/lib/agent/reflection-handler.test.ts`
- Modify: `lib/events.ts`, `lib/db/repo.ts`, `tests/lib/db/repo.test.ts`

- [ ] **Step 1: 删除死文件**

```bash
git rm lib/tools/handoff.ts lib/agent/handoff-handler.ts lib/agent/reflection-handler.ts \
       tests/lib/agent/handoff-handler.test.ts tests/lib/agent/reflection-handler.test.ts
```

- [ ] **Step 2: 删 events**

`lib/events.ts` 中删除：`HandoffRequested`、`HandoffResumed`、`HandoffHumanReply` 三个 interface 定义，以及 `EventMap` 里的 `"handoff.requested"`、`"handoff.resumed"`、`"handoff.humanReply"` 三键。`IncomingMessage.senderRole` **保留**。

- [ ] **Step 3: 删 repo handoff 方法**

`lib/db/repo.ts` 中删除以下 6 个方法：`isHumanMode`、`setHumanMode`、`staleHumanSessions`、`setHandoffQuestion`、`handoffQuestion`、`humanSessionsInGroup`。
`listSessions` 内仍读 `human_mode` 列（列保留、恒 0），**不改**。

- [ ] **Step 4: 删 repo.test 里的 handoff 用例**

`tests/lib/db/repo.test.ts` 中删除引用 `setHumanMode`/`isHumanMode`/`staleHumanSessions`/`setHandoffQuestion`/`handoffQuestion`/`humanSessionsInGroup` 的用例。首个用例「upsert 后能读回 session_id 与 human_mode」改为只断言 session_id：
```ts
  it("upsert 后能读回 session_id", () => {
    repo.setSessionId("g:u", "sid-1");
    expect(repo.getSessionId("g:u")).toBe("sid-1");
  });
```

- [ ] **Step 5: 全局搜残留引用**

Run: `grep -rn "handoff\|humanReply\|isHumanMode\|setHumanMode\|staleHumanSessions\|handoffQuestion\|humanSessionsInGroup\|makeHandoffTool" lib tests --include="*.ts"`
Expected: 无输出（除 `senderRole` 注释可能含"人工"字样，非标识符引用可忽略）。若有残留（如 `repo.stats.test.ts`、`api.test.ts` 引用 human_mode/handoffQueue），逐处清理：`handoffQueue` 若来自 RuntimeStatus 保持硬编码 0，不追加逻辑。

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `npm run typecheck && npm test`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: 删除 handoff 子系统(工具/handler/reflection-handler/events/repo方法)"
```

---

## Task 10: 全量回归 + 最终核对

**Files:** 无（验证）

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全绿（较改前净减少 handoff/reflection-handler 两文件用例，新增 buffer/poller/repo 用例）

- [ ] **Step 3: 残留扫描**

Run: `grep -rn "handoff_to_human\|human_mode\|reflection-handler\|handoff-handler" lib tests app --include="*.ts" --include="*.tsx"`
Expected: 仅可能出现在 db migrate 的列定义（`human_mode` 列保留）与本 plan/spec 文档；lib 逻辑代码无引用。

- [ ] **Step 4: 若涉及网页/API 展示层**

Run: `grep -rn "handoffQueue\|humanMode\|转人工\|人工接管" app --include="*.tsx" --include="*.ts"`
Expected: 若前端展示 `handoffQueue`/`humanMode`,保持显示（值恒 0/false),不新增功能。如展示文案明显误导(如"转人工队列"),记为后续单独任务,不在本 plan 扩张。

- [ ] **Step 5: 最终 commit（若 Step 4 有微调）**

```bash
git add -A
git commit -m "chore(reflection): 被动反思沉淀收口,全量回归通过"
```

---

## Self-Review 记录

- **Spec 覆盖**：缓冲(Task 3)、扫描判定两信号(Task 4)、游标/settle band(Task 2/4)、移除清单(Task 6-9)、配置(Task 5)、测试(各 Task + Task 10)——全覆盖。轮询取数改为「缓冲推送」已在 Task 3 落实（非 get_group_msg_history）。
- **类型一致**：`bufferGroupMessage/groupMessageWindow/groupsWithAdminMessagesBetween/pruneGroupMessages/reflectCursor/setReflectCursor`（Task 2）与 Task 3/4 调用签名一致；`registerReflectionPoller`/`runScan`/`ReflectionPollerDeps`（Task 4）与 assemble（Task 6）一致；config 字段 `reflectScanMs/reflectLookbackMs/reflectSettleMs/reflectWindowMax`（Task 5）与 assemble/runtime（Task 6）一致。
- **游标存储**：复用现有 `config` 表 + `getConfigRow/setConfigRow`，key=`reflect_cursor`，不新建表（较 spec 的 kv 表更省）。
- **占位符**：无 TBD/TODO；每步含实际代码或精确命令。
- **依赖顺序**：additive(1-5) → 换线(6) → strip(7-8) → 删文件收口(9) → 回归(10)。events/repo 方法在最后统一删，前序任务编译期仍有效。
