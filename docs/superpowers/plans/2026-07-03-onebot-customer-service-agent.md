# OneBot 客服 Agent 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Next.js 项目内,基于 `@anthropic-ai/claude-agent-sdk` 构建一个事件驱动的 OneBot 客服 Agent:群聊 @bot 触发,经进程内事件总线流转,具备 RAG 知识库、业务 tool、转人工能力,模型经 PackyAPI 中转。

**Architecture:** 进程内 typed EventEmitter 事件总线解耦所有模块。OneBot WS client(纯 IO)收发消息经总线;Gateway 过滤,Orchestrator 编排调用 Claude Agent SDK,tool 以 in-process SDK MCP 形式挂载。SQLite(better-sqlite3 + sqlite-vec)持久化会话映射、工单与向量;embedding 用本地 transformers.js。由 `instrumentation.ts` 单例启动。

**Tech Stack:** TypeScript / Next.js 16(Node runtime,`next start`)/ `@anthropic-ai/claude-agent-sdk` / `ws` / `better-sqlite3` / `sqlite-vec` / `@huggingface/transformers` / `zod` / `vitest`。

**关键约束:** Claude Agent SDK 运行时会 spawn `claude` 二进制子进程 —— 部署环境必须能访问该二进制(SDK 的 optional 平台包会带,或用 `options.pathToClaudeCodeExecutable` 指定)。应用不可部署到 edge/serverless。

**参考 spec:** `docs/superpowers/specs/2026-07-03-onebot-customer-service-agent-design.md`

---

## 文件结构

```
lib/
  events.ts                 事件类型定义(EventMap)
  bus.ts                    进程内 typed EventEmitter 单例
  config.ts                 env 读取与校验
  db/
    index.ts                打开 SQLite + 加载 sqlite-vec + migrate
    repo.ts                 sessions/messages/tickets/kb CRUD
  onebot/
    client.ts               OneBot 正向 WS client(纯 IO,收发经总线)
    parse.ts                OneBot 事件 → IncomingMessage(纯函数)
  agent/
    session.ts              sessionKey → SDK session_id 映射
    agent.ts               封装 SDK query(systemPrompt/tools/resume)
    orchestrator.ts        订阅 message.qualified,串行编排
    gateway.ts             订阅 message.received,过滤/去重
    handoff-handler.ts     订阅 handoff.*,置位/通知/超时恢复
    error-handler.ts       订阅 error.occurred,日志/兜底
    reply-mapper.ts        reply.ready → action.send
  tools/
    embed.ts                本地 embedding(transformers.js)
    kb.ts                   RAG 检索 tool
    biz.ts                  业务 tool(stub)
    handoff.ts              转人工 tool(仅 emit 事件)
    index.ts                组装 createSdkMcpServer
scripts/
  ingest.ts                 知识库摄入 CLI
instrumentation.ts          装配所有订阅者 + 启动 WS client
docs/kb/                     知识库源文档目录
```

测试与实现同目录:`lib/**/<name>.test.ts`。

---

## Task 0: 项目脚手架(依赖 + vitest + 目录)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `docs/kb/.gitkeep`

- [ ] **Step 1: 安装依赖**

```bash
pnpm add @anthropic-ai/claude-agent-sdk ws better-sqlite3 sqlite-vec @huggingface/transformers zod
pnpm add -D vitest @types/ws @types/better-sqlite3
```

- [ ] **Step 2: 加测试脚本到 package.json**

在 `package.json` 的 `scripts` 加一行:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: 写 vitest 配置**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 20000,
  },
});
```

- [ ] **Step 4: 建知识库目录占位**

```bash
mkdir -p docs/kb && touch docs/kb/.gitkeep
```

- [ ] **Step 5: 验证 vitest 可运行(无测试时应 0 退出或提示 no tests)**

Run: `pnpm test`
Expected: 退出码 0(no test files found 属正常)。

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts docs/kb/.gitkeep
git commit -m "chore: 加 agent 依赖与 vitest 脚手架"
```

---

## Task 1: 事件类型与事件总线

**Files:**
- Create: `lib/events.ts`
- Create: `lib/bus.ts`
- Test: `lib/bus.test.ts`

- [ ] **Step 1: 写事件类型**

Create `lib/events.ts`:

```ts
export interface IncomingMessage {
  groupId: number;
  userId: number;
  messageId: number;
  rawText: string;
  atList: number[]; // 被 @ 的 QQ 列表
}

export interface QualifiedMessage {
  sessionKey: string;
  groupId: number;
  userId: number;
  text: string;
}

export interface ReplyReady {
  groupId: number;
  text: string;
}

export interface ActionSend {
  action: "send_group_msg";
  groupId: number;
  text: string;
}

export interface HandoffRequested {
  sessionKey: string;
  groupId: number;
  userId: number;
  lastQuestion: string;
}

export interface HandoffResumed {
  sessionKey: string;
}

export interface ErrorOccurred {
  scope: string;
  err: unknown;
  sessionKey?: string;
}

export interface EventMap {
  "message.received": IncomingMessage;
  "message.qualified": QualifiedMessage;
  "reply.ready": ReplyReady;
  "action.send": ActionSend;
  "handoff.requested": HandoffRequested;
  "handoff.resumed": HandoffResumed;
  "error.occurred": ErrorOccurred;
}
```

- [ ] **Step 2: 写失败测试**

Create `lib/bus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bus } from "./bus";

describe("bus", () => {
  it("emit/on 传递类型化 payload", () => {
    let got: number | undefined;
    bus.on("message.received", (p) => { got = p.groupId; });
    bus.emit("message.received", { groupId: 42, userId: 1, messageId: 1, rawText: "hi", atList: [] });
    expect(got).toBe(42);
  });

  it("是单例(同一引用)", async () => {
    const again = (await import("./bus")).bus;
    expect(again).toBe(bus);
  });
});
```

- [ ] **Step 3: 运行验证失败**

Run: `pnpm vitest run lib/bus.test.ts`
Expected: FAIL —— `Cannot find module './bus'`。

- [ ] **Step 4: 实现总线**

Create `lib/bus.ts`:

```ts
import { EventEmitter } from "node:events";
import type { EventMap } from "./events";

class TypedBus extends EventEmitter {
  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): boolean {
    return super.emit(type, payload);
  }
  on<K extends keyof EventMap>(type: K, handler: (payload: EventMap[K]) => void): this {
    return super.on(type, handler);
  }
  off<K extends keyof EventMap>(type: K, handler: (payload: EventMap[K]) => void): this {
    return super.off(type, handler);
  }
}

// 单例守卫:热重载不重复创建
const g = globalThis as unknown as { __packyBus?: TypedBus };
export const bus: TypedBus = g.__packyBus ?? (g.__packyBus = new TypedBus());
```

- [ ] **Step 5: 运行验证通过**

Run: `pnpm vitest run lib/bus.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 6: Commit**

```bash
git add lib/events.ts lib/bus.ts lib/bus.test.ts
git commit -m "feat: 事件类型与进程内 typed 事件总线"
```

---

## Task 2: 配置读取

**Files:**
- Create: `lib/config.ts`
- Test: `lib/config.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("从 env 读取并转型", () => {
    const c = loadConfig({
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "123",
      ADMIN_GROUP_ID: "456",
      HANDOFF_TIMEOUT_MIN: "15",
    });
    expect(c.botQQ).toBe(123);
    expect(c.adminGroupId).toBe(456);
    expect(c.handoffTimeoutMin).toBe(15);
    expect(c.onebotWsUrl).toBe("ws://x:1");
  });

  it("缺必填项抛错", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("HANDOFF_TIMEOUT_MIN 缺省为 30", () => {
    const c = loadConfig({ ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(c.handoffTimeoutMin).toBe(30);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/config.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现**

Create `lib/config.ts`:

```ts
export interface AppConfig {
  onebotWsUrl: string;
  onebotAccessToken?: string;
  botQQ: number;
  adminGroupId: number;
  handoffTimeoutMin: number;
  model: string;
  dbPath: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const required = ["ONEBOT_WS_URL", "BOT_QQ", "ADMIN_GROUP_ID"];
  for (const k of required) {
    if (!env[k]) throw new Error(`缺少必填环境变量: ${k}`);
  }
  return {
    onebotWsUrl: env.ONEBOT_WS_URL!,
    onebotAccessToken: env.ONEBOT_ACCESS_TOKEN,
    botQQ: Number(env.BOT_QQ),
    adminGroupId: Number(env.ADMIN_GROUP_ID),
    handoffTimeoutMin: Number(env.HANDOFF_TIMEOUT_MIN ?? "30"),
    model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    dbPath: env.DB_PATH ?? "./data/agent.db",
  };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/config.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts lib/config.test.ts
git commit -m "feat: 配置读取与校验"
```

---

## Task 3: 数据库层(SQLite + sqlite-vec)

**Files:**
- Create: `lib/db/index.ts`
- Create: `lib/db/repo.ts`
- Test: `lib/db/repo.test.ts`

- [ ] **Step 1: 写失败测试(用内存库)**

Create `lib/db/repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "./index";
import { Repo } from "./repo";
import type Database from "better-sqlite3";

let db: Database.Database;
let repo: Repo;

beforeEach(() => {
  db = openDb(":memory:");
  repo = new Repo(db);
});

describe("Repo sessions", () => {
  it("upsert 后能读回 session_id 与 human_mode", () => {
    repo.setSessionId("g:u", "sid-1");
    expect(repo.getSessionId("g:u")).toBe("sid-1");
    expect(repo.isHumanMode("g:u")).toBe(false);
    repo.setHumanMode("g:u", true);
    expect(repo.isHumanMode("g:u")).toBe(true);
  });

  it("列出超时的 human 会话", () => {
    repo.setHumanMode("g:old", true);
    // 手动把 human_since 改早
    db.prepare("UPDATE sessions SET human_since = ? WHERE key = ?").run(Date.now() - 60 * 60 * 1000, "g:old");
    const stale = repo.staleHumanSessions(30);
    expect(stale).toContain("g:old");
  });
});

describe("Repo dedupe", () => {
  it("seenMessage 首次 false,再次 true", () => {
    expect(repo.seenMessage(1001)).toBe(false);
    expect(repo.seenMessage(1001)).toBe(true);
  });
});

describe("Repo kb", () => {
  it("插入 chunk + 向量,可按向量近邻检索", () => {
    const id = repo.insertKbChunk("faq.md", "退货政策 7 天", "faq");
    repo.insertKbVec(id, new Float32Array([1, 0, 0]));
    const id2 = repo.insertKbChunk("faq.md", "无关内容", "faq");
    repo.insertKbVec(id2, new Float32Array([0, 1, 0]));
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 1);
    expect(hits[0].content).toContain("退货");
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/db/repo.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现 openDb(加载 sqlite-vec + 建表)**

Create `lib/db/index.ts`:

```ts
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const DIM = 512; // bge-small-zh-v1.5 输出维度

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  sqliteVec.load(db);
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      session_id TEXT,
      human_mode INTEGER NOT NULL DEFAULT 0,
      human_since INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS seen_messages (
      message_id INTEGER PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding FLOAT[${DIM}]
    );
  `);
}

export { DIM };
```

- [ ] **Step 4: 实现 Repo**

Create `lib/db/repo.ts`:

```ts
import type Database from "better-sqlite3";

export interface KbHit {
  id: number;
  content: string;
  source: string | null;
  distance: number;
}

export class Repo {
  constructor(private db: Database.Database) {}

  setSessionId(key: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (key, session_id) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, sessionId);
  }

  getSessionId(key: string): string | undefined {
    const row = this.db.prepare("SELECT session_id FROM sessions WHERE key = ?").get(key) as
      | { session_id: string | null }
      | undefined;
    return row?.session_id ?? undefined;
  }

  isHumanMode(key: string): boolean {
    const row = this.db.prepare("SELECT human_mode FROM sessions WHERE key = ?").get(key) as
      | { human_mode: number }
      | undefined;
    return !!row?.human_mode;
  }

  setHumanMode(key: string, on: boolean): void {
    this.db
      .prepare(
        `INSERT INTO sessions (key, human_mode, human_since) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET human_mode = excluded.human_mode, human_since = excluded.human_since`
      )
      .run(key, on ? 1 : 0, on ? Date.now() : null);
  }

  staleHumanSessions(timeoutMin: number): string[] {
    const cutoff = Date.now() - timeoutMin * 60 * 1000;
    const rows = this.db
      .prepare("SELECT key FROM sessions WHERE human_mode = 1 AND human_since IS NOT NULL AND human_since < ?")
      .all(cutoff) as { key: string }[];
    return rows.map((r) => r.key);
  }

  seenMessage(messageId: number): boolean {
    const info = this.db
      .prepare("INSERT OR IGNORE INTO seen_messages (message_id) VALUES (?)")
      .run(messageId);
    return info.changes === 0; // 0 = 已存在
  }

  createTicket(sessionKey: string, summary: string): number {
    const info = this.db
      .prepare("INSERT INTO tickets (session_key, summary) VALUES (?, ?)")
      .run(sessionKey, summary);
    return Number(info.lastInsertRowid);
  }

  insertKbChunk(doc: string, content: string, source: string): number {
    const info = this.db
      .prepare("INSERT INTO kb_chunks (doc, content, source) VALUES (?, ?, ?)")
      .run(doc, content, source);
    return Number(info.lastInsertRowid);
  }

  insertKbVec(chunkId: number, embedding: Float32Array): void {
    this.db
      .prepare("INSERT INTO kb_vec (chunk_id, embedding) VALUES (?, ?)")
      .run(chunkId, Buffer.from(embedding.buffer));
  }

  searchKb(query: Float32Array, k: number): KbHit[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.content, c.source, v.distance
         FROM kb_vec v JOIN kb_chunks c ON c.id = v.chunk_id
         WHERE v.embedding MATCH ? AND k = ?
         ORDER BY v.distance`
      )
      .all(Buffer.from(query.buffer), k) as KbHit[];
    return rows;
  }
}
```

- [ ] **Step 5: 运行验证通过**

Run: `pnpm vitest run lib/db/repo.test.ts`
Expected: PASS(4 tests)。若 sqlite-vec 原生扩展加载失败,确认 `sqlite-vec` 已安装且平台匹配。

- [ ] **Step 6: Commit**

```bash
git add lib/db/ && git commit -m "feat: SQLite 存储层(sessions/tickets/去重/kb 向量)"
```

---

## Task 4: OneBot 事件解析(纯函数)

**Files:**
- Create: `lib/onebot/parse.ts`
- Test: `lib/onebot/parse.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/onebot/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseGroupMessage } from "./parse";

describe("parseGroupMessage", () => {
  it("解析数组段格式,提取 @ 列表与纯文本", () => {
    const evt = {
      post_type: "message",
      message_type: "group",
      group_id: 100,
      user_id: 200,
      message_id: 9,
      message: [
        { type: "at", data: { qq: "555" } },
        { type: "text", data: { text: " 你好 " } },
      ],
    };
    const m = parseGroupMessage(evt);
    expect(m).toEqual({ groupId: 100, userId: 200, messageId: 9, rawText: "你好", atList: [555] });
  });

  it("解析 CQ 字符串格式", () => {
    const evt = {
      post_type: "message",
      message_type: "group",
      group_id: 1,
      user_id: 2,
      message_id: 3,
      message: "[CQ:at,qq=555] 在吗",
    };
    const m = parseGroupMessage(evt);
    expect(m?.atList).toEqual([555]);
    expect(m?.rawText).toBe("在吗");
  });

  it("非群消息返回 null", () => {
    expect(parseGroupMessage({ post_type: "message", message_type: "private" })).toBeNull();
    expect(parseGroupMessage({ post_type: "meta_event" })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/onebot/parse.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现**

Create `lib/onebot/parse.ts`:

```ts
import type { IncomingMessage } from "../events";

interface Segment { type: string; data: Record<string, string> }

export function parseGroupMessage(evt: any): IncomingMessage | null {
  if (evt?.post_type !== "message" || evt?.message_type !== "group") return null;

  const atList: number[] = [];
  let text = "";

  if (Array.isArray(evt.message)) {
    for (const seg of evt.message as Segment[]) {
      if (seg.type === "at" && seg.data?.qq) atList.push(Number(seg.data.qq));
      else if (seg.type === "text") text += seg.data?.text ?? "";
    }
  } else if (typeof evt.message === "string") {
    const cq = /\[CQ:at,qq=(\d+)\]/g;
    let mtch: RegExpExecArray | null;
    while ((mtch = cq.exec(evt.message)) !== null) atList.push(Number(mtch[1]));
    text = evt.message.replace(/\[CQ:[^\]]*\]/g, "");
  }

  return {
    groupId: Number(evt.group_id),
    userId: Number(evt.user_id),
    messageId: Number(evt.message_id),
    rawText: text.trim(),
    atList,
  };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/onebot/parse.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/onebot/parse.ts lib/onebot/parse.test.ts
git commit -m "feat: OneBot 群消息解析(数组段+CQ 字符串)"
```

---

## Task 5: OneBot WS Client(收发 + 重连)

**Files:**
- Create: `lib/onebot/client.ts`
- Test: `lib/onebot/client.test.ts`

- [ ] **Step 1: 写失败测试(起真实 ws server 做对端)**

Create `lib/onebot/client.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { bus } from "../bus";
import { OneBotClient } from "./client";

let wss: WebSocketServer | undefined;
let client: OneBotClient | undefined;

afterEach(() => {
  client?.stop();
  wss?.close();
});

function startServer(onConn: (ws: any) => void): Promise<number> {
  return new Promise((resolve) => {
    wss = new WebSocketServer({ port: 0 }, () => {
      resolve((wss!.address() as AddressInfo).port);
    });
    wss.on("connection", onConn);
  });
}

describe("OneBotClient", () => {
  it("收到群消息 → emit message.received", async () => {
    const port = await startServer((ws) => {
      ws.send(JSON.stringify({
        post_type: "message", message_type: "group",
        group_id: 1, user_id: 2, message_id: 3, message: "hi",
      }));
    });
    const received = new Promise((res) => bus.once("message.received", res));
    client = new OneBotClient(`ws://127.0.0.1:${port}`);
    client.start();
    const m: any = await received;
    expect(m.groupId).toBe(1);
  });

  it("action.send → 对端收到 send_group_msg 动作", async () => {
    const gotAction = new Promise<any>((res) => {
      startServer((ws) => {
        ws.on("message", (raw: Buffer) => res(JSON.parse(raw.toString())));
      }).then((port) => {
        client = new OneBotClient(`ws://127.0.0.1:${port}`);
        client.start();
        setTimeout(() => bus.emit("action.send", { action: "send_group_msg", groupId: 9, text: "hello" }), 100);
      });
    });
    const action = await gotAction;
    expect(action.action).toBe("send_group_msg");
    expect(action.params.group_id).toBe(9);
    expect(action.params.message).toBe("hello");
  });
});
```

> 注:`bus.once` 用 Node EventEmitter 原生方法,已由 TypedBus 继承。

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/onebot/client.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现**

Create `lib/onebot/client.ts`:

```ts
import WebSocket from "ws";
import { bus } from "../bus";
import { parseGroupMessage } from "./parse";
import type { ActionSend } from "../events";

export class OneBotClient {
  private ws?: WebSocket;
  private stopped = false;
  private backoff = 1000;
  private readonly onAction = (a: ActionSend) => this.sendAction(a);

  constructor(private url: string, private accessToken?: string) {}

  start(): void {
    this.stopped = false;
    bus.on("action.send", this.onAction);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    bus.off("action.send", this.onAction);
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    const headers = this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined;
    const ws = new WebSocket(this.url, { headers });
    this.ws = ws;

    ws.on("open", () => { this.backoff = 1000; });

    ws.on("message", (raw: WebSocket.RawData) => {
      let evt: unknown;
      try { evt = JSON.parse(raw.toString()); } catch { return; }
      const msg = parseGroupMessage(evt);
      if (msg) bus.emit("message.received", msg);
    });

    ws.on("close", () => this.scheduleReconnect());
    ws.on("error", () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  }

  private sendAction(a: ActionSend): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      action: a.action,
      params: { group_id: a.groupId, message: a.text },
    }));
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/onebot/client.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/onebot/client.ts lib/onebot/client.test.ts
git commit -m "feat: OneBot 正向 WS client(收发经总线 + 重连)"
```

---

## Task 6: Gateway(过滤 / 去重 / session key)

**Files:**
- Create: `lib/agent/gateway.ts`
- Test: `lib/agent/gateway.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/agent/gateway.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { bus } from "../bus";
import { registerGateway } from "./gateway";
import type { QualifiedMessage } from "../events";

let repo: Repo;
const BOT = 555;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
  registerGateway({ repo, botQQ: BOT, adminGroupId: 999 });
});

function collectQualified(): Promise<QualifiedMessage> {
  return new Promise((res) => bus.once("message.qualified", res));
}

describe("gateway", () => {
  it("@bot 的群消息 → emit message.qualified,含 sessionKey 与去 @ 文本", async () => {
    const p = collectQualified();
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 10, rawText: "订单在哪", atList: [BOT] });
    const q = await p;
    expect(q.sessionKey).toBe("1:2");
    expect(q.text).toBe("订单在哪");
  });

  it("未 @bot 不触发", async () => {
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 11, rawText: "闲聊", atList: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("重复 message_id 只触发一次", async () => {
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    const msg = { groupId: 1, userId: 2, messageId: 12, rawText: "x", atList: [BOT] };
    bus.emit("message.received", msg);
    bus.emit("message.received", msg);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("human-mode 会话被丢弃", async () => {
    repo.setHumanMode("1:2", true);
    const spy = vi.fn();
    bus.on("message.qualified", spy);
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 13, rawText: "x", atList: [BOT] });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("管理群 !resume <key> → emit handoff.resumed", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.resumed", res));
    bus.emit("message.received", { groupId: 999, userId: 7, messageId: 14, rawText: "!resume 1:2", atList: [BOT] });
    const r = await p;
    expect(r.sessionKey).toBe("1:2");
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/agent/gateway.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现**

Create `lib/agent/gateway.ts`:

```ts
import { bus } from "../bus";
import type { Repo } from "../db/repo";
import type { IncomingMessage } from "../events";

export interface GatewayDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
}

export function registerGateway(deps: GatewayDeps): void {
  const { repo, botQQ, adminGroupId } = deps;

  bus.on("message.received", (msg: IncomingMessage) => {
    // 管理群命令优先
    if (msg.groupId === adminGroupId) {
      const m = msg.rawText.match(/^!resume\s+(\S+)/);
      if (m) { bus.emit("handoff.resumed", { sessionKey: m[1] }); return; }
    }

    if (!msg.atList.includes(botQQ)) return;        // 仅 @bot
    if (repo.seenMessage(msg.messageId)) return;    // 去重
    const sessionKey = `${msg.groupId}:${msg.userId}`;
    if (repo.isHumanMode(sessionKey)) return;       // 人工接管中
    if (!msg.rawText) return;

    bus.emit("message.qualified", {
      sessionKey,
      groupId: msg.groupId,
      userId: msg.userId,
      text: msg.rawText,
    });
  });
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/agent/gateway.test.ts`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/agent/gateway.ts lib/agent/gateway.test.ts
git commit -m "feat: Gateway 过滤/去重/session key/管理命令"
```

---

## Task 7: Session 管理(sessionKey → SDK session_id)

**Files:**
- Create: `lib/agent/session.ts`
- Test: `lib/agent/session.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/agent/session.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { SessionStore } from "./session";

let store: SessionStore;

beforeEach(() => {
  store = new SessionStore(new Repo(openDb(":memory:")));
});

describe("SessionStore", () => {
  it("初次无 session_id", () => {
    expect(store.resumeId("a:b")).toBeUndefined();
  });
  it("记录后可取回用于 resume", () => {
    store.remember("a:b", "sid-9");
    expect(store.resumeId("a:b")).toBe("sid-9");
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/agent/session.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `lib/agent/session.ts`:

```ts
import type { Repo } from "../db/repo";

export class SessionStore {
  constructor(private repo: Repo) {}

  resumeId(sessionKey: string): string | undefined {
    return this.repo.getSessionId(sessionKey);
  }

  remember(sessionKey: string, sessionId: string): void {
    this.repo.setSessionId(sessionKey, sessionId);
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/agent/session.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/agent/session.ts lib/agent/session.test.ts
git commit -m "feat: Session 存储(sessionKey↔session_id)"
```

---

## Task 8: 本地 Embedding

**Files:**
- Create: `lib/tools/embed.ts`
- Test: `lib/tools/embed.test.ts`

- [ ] **Step 1: 写测试(真实模型,首次会下载,故超时放宽)**

Create `lib/tools/embed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { embed } from "./embed";
import { DIM } from "../db/index";

describe("embed", () => {
  it("返回长度为 DIM 的归一化向量", async () => {
    const v = await embed("退货政策");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(DIM);
  }, 120000);

  it("相近语义向量点积高于不相近", async () => {
    const a = await embed("怎么退货");
    const b = await embed("退货流程");
    const c = await embed("今天天气");
    const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, xi, i) => s + xi * y[i], 0);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  }, 120000);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/tools/embed.test.ts`
Expected: FAIL —— 找不到模块。

- [ ] **Step 3: 实现(单例 pipeline,mean-pool + 归一化)**

Create `lib/tools/embed.ts`:

```ts
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL = "Xenova/bge-small-zh-v1.5";
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Float32Array.from(output.data as Float32Array);
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/tools/embed.test.ts`
Expected: PASS(首次运行会下载模型 ~100MB,耐心等)。若 DIM 与实际输出不符,按实际输出维度改 `lib/db/index.ts` 的 `DIM`。

- [ ] **Step 5: Commit**

```bash
git add lib/tools/embed.ts lib/tools/embed.test.ts
git commit -m "feat: 本地 transformers.js embedding"
```

---

## Task 9: 知识库摄入 CLI

**Files:**
- Create: `scripts/ingest.ts`
- Test: `scripts/ingest.test.ts`

- [ ] **Step 1: 写测试(切块函数纯逻辑单测)**

Create `scripts/ingest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "./ingest";

describe("chunkText", () => {
  it("按段落切块,过滤空块", () => {
    const chunks = chunkText("第一段\n\n第二段\n\n\n第三段");
    expect(chunks).toEqual(["第一段", "第二段", "第三段"]);
  });
  it("超长段落按上限切分", () => {
    const long = "a".repeat(1200);
    const chunks = chunkText(long, 500);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(500);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run scripts/ingest.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `scripts/ingest.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../lib/db/index";
import { Repo } from "../lib/db/repo";
import { embed } from "../lib/tools/embed";
import { loadConfig } from "../lib/config";

export function chunkText(text: string, maxLen = 500): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= maxLen) out.push(p);
    else for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
  }
  return out;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const repo = new Repo(db);
  const dir = "docs/kb";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8");
    const chunks = chunkText(content);
    for (const c of chunks) {
      const id = repo.insertKbChunk(f, c, f);
      repo.insertKbVec(id, await embed(c));
    }
    console.log(`ingested ${f}: ${chunks.length} chunks`);
  }
}

// 直接运行时执行(vitest import 时不执行)
if (process.argv[1]?.endsWith("ingest.ts")) main();
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run scripts/ingest.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 5: 加运行脚本到 package.json**

在 `scripts` 加:

```json
    "ingest": "node scripts/ingest.ts"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest.ts scripts/ingest.test.ts package.json
git commit -m "feat: 知识库摄入 CLI(切块+embed 入库)"
```

---

## Task 10: Tools —— kb / biz / handoff / 组装

**Files:**
- Create: `lib/tools/kb.ts`
- Create: `lib/tools/biz.ts`
- Create: `lib/tools/handoff.ts`
- Create: `lib/tools/index.ts`
- Test: `lib/tools/tools.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/tools/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { bus } from "../bus";
import { makeKbTool } from "./kb";
import { makeHandoffTool } from "./handoff";

let repo: Repo;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
});

describe("kb tool", () => {
  it("检索命中片段文本", async () => {
    const fakeEmbed = async () => new Float32Array([1, 0, 0]);
    const id = repo.insertKbChunk("faq.md", "退货 7 天内", "faq");
    repo.insertKbVec(id, new Float32Array([1, 0, 0]));
    const tool = makeKbTool(repo, fakeEmbed as any, 512);
    const res = await tool.handler({ query: "退货" }, {});
    expect(res.content[0].text).toContain("退货 7 天内");
  });
});

describe("handoff tool", () => {
  it("调用只 emit handoff.requested,不直接改库", async () => {
    const p = new Promise<any>((res) => bus.once("handoff.requested", res));
    const tool = makeHandoffTool();
    const res = await tool.handler(
      { sessionKey: "1:2", groupId: 1, userId: 2, lastQuestion: "退款没到" },
      {}
    );
    const evt = await p;
    expect(evt.sessionKey).toBe("1:2");
    expect(res.content[0].text).toContain("人工");
    expect(repo.isHumanMode("1:2")).toBe(false); // tool 本身不改库
  });
});
```

> 注:`makeKbTool`/`makeHandoffTool` 返回带 `.handler` 的对象(即 `tool()` 的产物),测试直接调 handler。

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/tools/tools.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 kb tool**

Create `lib/tools/kb.ts`:

```ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Repo } from "../db/repo";

type EmbedFn = (text: string) => Promise<Float32Array>;

export function makeKbTool(repo: Repo, embed: EmbedFn, _dim: number) {
  return tool(
    "kb_search",
    "检索产品知识库/FAQ,回答事实性问题前先调用。返回最相关的知识片段。",
    { query: z.string().describe("用户问题或检索关键词") },
    async ({ query }) => {
      const vec = await embed(query);
      const hits = repo.searchKb(vec, 5);
      const text = hits.length
        ? hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n")
        : "知识库无相关内容。";
      return { content: [{ type: "text", text }] };
    }
  );
}
```

- [ ] **Step 4: 实现 biz tool(stub)**

Create `lib/tools/biz.ts`:

```ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// stub:接真实业务系统时替换 handler 内部实现
export function makeOrderTool() {
  return tool(
    "lookup_order",
    "按订单号查询订单状态。",
    { orderId: z.string().describe("订单号") },
    async ({ orderId }) => {
      // TODO 接真实订单 API;当前返回占位
      return { content: [{ type: "text", text: `订单 ${orderId}: 状态=已发货(示例数据)` }] };
    }
  );
}
```

- [ ] **Step 5: 实现 handoff tool(仅 emit)**

Create `lib/tools/handoff.ts`:

```ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { bus } from "../bus";

export function makeHandoffTool() {
  return tool(
    "handoff_to_human",
    "当无法解决用户问题、或用户明确要求人工时调用,转接人工客服。",
    {
      sessionKey: z.string(),
      groupId: z.number(),
      userId: z.number(),
      lastQuestion: z.string().describe("用户最后的问题摘要"),
    },
    async ({ sessionKey, groupId, userId, lastQuestion }) => {
      bus.emit("handoff.requested", { sessionKey, groupId, userId, lastQuestion });
      return { content: [{ type: "text", text: "已为您转接人工客服,请稍候。" }] };
    }
  );
}
```

- [ ] **Step 6: 组装 MCP server**

Create `lib/tools/index.ts`:

```ts
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Repo } from "../db/repo";
import { embed } from "./embed";
import { makeKbTool } from "./kb";
import { makeOrderTool } from "./biz";
import { makeHandoffTool } from "./handoff";
import { DIM } from "../db/index";

export const TOOL_NAMES = [
  "mcp__cs__kb_search",
  "mcp__cs__lookup_order",
  "mcp__cs__handoff_to_human",
];

export function buildToolServer(repo: Repo) {
  return createSdkMcpServer({
    name: "cs",
    version: "1.0.0",
    tools: [makeKbTool(repo, embed, DIM), makeOrderTool(), makeHandoffTool()],
  });
}
```

- [ ] **Step 7: 运行验证通过**

Run: `pnpm vitest run lib/tools/tools.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 8: Commit**

```bash
git add lib/tools/kb.ts lib/tools/biz.ts lib/tools/handoff.ts lib/tools/index.ts lib/tools/tools.test.ts
git commit -m "feat: kb/biz/handoff 工具 + MCP server 组装"
```

---

## Task 11: Agent 核心(封装 SDK query)

**Files:**
- Create: `lib/agent/agent.ts`
- Test: `lib/agent/agent.test.ts`

**说明:** 单测通过注入一个 `queryFn`(默认 = SDK 的 `query`)来 mock SDK,避免测试时 spawn claude 子进程。

- [ ] **Step 1: 写失败测试**

Create `lib/agent/agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Agent } from "./agent";

// 模拟 SDK query:产出 init(带 session_id)+ 一条 assistant 文本
async function* fakeQuery(_args: any) {
  yield { type: "system", subtype: "init", session_id: "sid-new" };
  yield { type: "assistant", message: { content: [{ type: "text", text: "你好,请问有什么可以帮您?" }] } };
  yield { type: "result", subtype: "success" };
}

describe("Agent.run", () => {
  it("返回最终文本 + 新 session_id", async () => {
    const agent = new Agent({ model: "claude-sonnet-5", systemPrompt: "客服", toolServer: {} as any, queryFn: fakeQuery as any });
    const out = await agent.run("在吗", undefined);
    expect(out.text).toContain("有什么可以帮您");
    expect(out.sessionId).toBe("sid-new");
  });

  it("传入 resumeId 时透传给 options.resume", async () => {
    let seen: any;
    const spyQuery = async function* (args: any) {
      seen = args;
      yield { type: "system", subtype: "init", session_id: "sid-x" };
      yield { type: "result", subtype: "success" };
    };
    const agent = new Agent({ model: "m", systemPrompt: "s", toolServer: {} as any, queryFn: spyQuery as any });
    await agent.run("hi", "sid-prev");
    expect(seen.options.resume).toBe("sid-prev");
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/agent/agent.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `lib/agent/agent.ts`:

```ts
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { TOOL_NAMES } from "../tools/index";

export interface AgentDeps {
  model: string;
  systemPrompt: string;
  toolServer: unknown;
  queryFn?: typeof sdkQuery;
}

export interface AgentResult {
  text: string;
  sessionId?: string;
}

const DEFAULT_SYSTEM = `你是一名专业、友好的客服助手。规则:
1. 回答产品/业务问题前,先用 kb_search 检索知识库,依据检索结果作答,不要编造。
2. 涉及具体订单时用 lookup_order 查询。
3. 无法解决或用户要求人工时,调用 handoff_to_human。
4. 回答简洁、有礼,用中文。`;

export class Agent {
  private queryFn: typeof sdkQuery;
  constructor(private deps: AgentDeps) {
    this.queryFn = deps.queryFn ?? sdkQuery;
  }

  async run(text: string, resumeId: string | undefined): Promise<AgentResult> {
    const iter = this.queryFn({
      prompt: text,
      options: {
        model: this.deps.model,
        systemPrompt: this.deps.systemPrompt || DEFAULT_SYSTEM,
        mcpServers: { cs: this.deps.toolServer as any },
        allowedTools: TOOL_NAMES,
        resume: resumeId,
        maxTurns: 8,
      } as any,
    });

    let sessionId: string | undefined = resumeId;
    let out = "";
    for await (const msg of iter as AsyncIterable<any>) {
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
        sessionId = msg.session_id;
      }
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === "text") out += block.text;
        }
      }
    }
    return { text: out.trim(), sessionId };
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/agent/agent.test.ts`
Expected: PASS(2 tests)。

> 注:真实 SDK 的 assistant message 结构以运行时为准;若字段不同,在此调整提取逻辑(仅此一处)。

- [ ] **Step 5: Commit**

```bash
git add lib/agent/agent.ts lib/agent/agent.test.ts
git commit -m "feat: Agent 核心(封装 SDK query,支持 resume/tools)"
```

---

## Task 12: Orchestrator + Reply Mapper(串行编排)

**Files:**
- Create: `lib/agent/orchestrator.ts`
- Create: `lib/agent/reply-mapper.ts`
- Test: `lib/agent/orchestrator.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/agent/orchestrator.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { bus } from "../bus";
import { registerOrchestrator } from "./orchestrator";
import { registerReplyMapper } from "./reply-mapper";
import { SessionStore } from "./session";

let repo: Repo;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
});

describe("orchestrator", () => {
  it("message.qualified → 调 agent → emit reply.ready,并记住 session_id", async () => {
    const fakeAgent = { run: vi.fn(async () => ({ text: "回复内容", sessionId: "sid-1" })) };
    const store = new SessionStore(repo);
    registerOrchestrator({ agent: fakeAgent as any, store });

    const p = new Promise<any>((res) => bus.once("reply.ready", res));
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "在吗" });
    const r = await p;
    expect(r.text).toBe("回复内容");
    expect(r.groupId).toBe(1);
    expect(store.resumeId("1:2")).toBe("sid-1");
  });

  it("同一 session 串行:第二条等第一条完成", async () => {
    const order: string[] = [];
    const fakeAgent = {
      run: vi.fn(async (text: string) => {
        order.push(`start:${text}`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`end:${text}`);
        return { text: `re:${text}`, sessionId: "s" };
      }),
    };
    registerOrchestrator({ agent: fakeAgent as any, store: new SessionStore(repo) });
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "A" });
    bus.emit("message.qualified", { sessionKey: "1:2", groupId: 1, userId: 2, text: "B" });
    await new Promise((r) => setTimeout(r, 120));
    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("reply mapper: reply.ready → action.send", async () => {
    registerReplyMapper();
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("reply.ready", { groupId: 5, text: "hi" });
    const a = await p;
    expect(a).toEqual({ action: "send_group_msg", groupId: 5, text: "hi" });
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/agent/orchestrator.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 orchestrator(per-session 串行队列)**

Create `lib/agent/orchestrator.ts`:

```ts
import { bus } from "../bus";
import type { Agent } from "./agent";
import type { SessionStore } from "./session";
import type { QualifiedMessage } from "../events";

export interface OrchestratorDeps {
  agent: Agent;
  store: SessionStore;
}

export function registerOrchestrator(deps: OrchestratorDeps): void {
  const { agent, store } = deps;
  // 每个 sessionKey 一条 Promise 链,保证串行
  const chains = new Map<string, Promise<void>>();

  bus.on("message.qualified", (q: QualifiedMessage) => {
    const prev = chains.get(q.sessionKey) ?? Promise.resolve();
    const next = prev.then(() => handle(q)).catch((err) => {
      bus.emit("error.occurred", { scope: "orchestrator", err, sessionKey: q.sessionKey });
    });
    chains.set(q.sessionKey, next);
  });

  async function handle(q: QualifiedMessage): Promise<void> {
    const resumeId = store.resumeId(q.sessionKey);
    const result = await agent.run(q.text, resumeId);
    if (result.sessionId) store.remember(q.sessionKey, result.sessionId);
    if (result.text) bus.emit("reply.ready", { groupId: q.groupId, text: result.text });
  }
}
```

- [ ] **Step 4: 实现 reply mapper**

Create `lib/agent/reply-mapper.ts`:

```ts
import { bus } from "../bus";

export function registerReplyMapper(): void {
  bus.on("reply.ready", (r) => {
    bus.emit("action.send", { action: "send_group_msg", groupId: r.groupId, text: r.text });
  });
}
```

- [ ] **Step 5: 运行验证通过**

Run: `pnpm vitest run lib/agent/orchestrator.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 6: Commit**

```bash
git add lib/agent/orchestrator.ts lib/agent/reply-mapper.ts lib/agent/orchestrator.test.ts
git commit -m "feat: Orchestrator 串行编排 + reply mapper"
```

---

## Task 13: Handoff Handler(置位 / 通知 / 超时恢复)

**Files:**
- Create: `lib/agent/handoff-handler.ts`
- Test: `lib/agent/handoff-handler.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/agent/handoff-handler.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { bus } from "../bus";
import { registerHandoffHandler } from "./handoff-handler";

let repo: Repo;

beforeEach(() => {
  bus.removeAllListeners();
  vi.useRealTimers();
  repo = new Repo(openDb(":memory:"));
});

describe("handoff handler", () => {
  it("handoff.requested → 置 human_mode + 通知管理群", async () => {
    const stop = registerHandoffHandler({ repo, adminGroupId: 999, timeoutMin: 30 });
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("handoff.requested", { sessionKey: "1:2", groupId: 1, userId: 2, lastQuestion: "退款没到" });
    const a = await notice;
    expect(repo.isHumanMode("1:2")).toBe(true);
    expect(a.groupId).toBe(999);
    expect(a.text).toContain("1:2");
    stop();
  });

  it("handoff.resumed → 复位 human_mode", () => {
    const stop = registerHandoffHandler({ repo, adminGroupId: 999, timeoutMin: 30 });
    repo.setHumanMode("1:2", true);
    bus.emit("handoff.resumed", { sessionKey: "1:2" });
    expect(repo.isHumanMode("1:2")).toBe(false);
    stop();
  });

  it("扫描到超时会话自动 emit handoff.resumed", async () => {
    const stop = registerHandoffHandler({ repo, adminGroupId: 999, timeoutMin: 30, scanMs: 20 });
    repo.setHumanMode("1:2", true);
    (repo as any).db?.prepare?.("UPDATE sessions SET human_since=? WHERE key=?");
    // 直接构造超时:改 human_since 到 1 小时前
    openDb; // no-op
    const p = new Promise<any>((res) => bus.once("handoff.resumed", res));
    // 用 repo 暴露的底层 db 更新时间
    (repo as unknown as { db: any });
    // 通过再次 setHumanMode 后手动回拨
    // 简化:直接调用内部 SQL
    // @ts-expect-error 访问私有 db 仅测试用
    repo["db"].prepare("UPDATE sessions SET human_since=? WHERE key=?").run(Date.now() - 3600_000, "1:2");
    const r = await p;
    expect(r.sessionKey).toBe("1:2");
    stop();
  });
});
```

> 注:第三个测试依赖 Repo 内部持有 `db`。实现时把构造函数参数 `db` 存为 `private db` 即可(已在 Task 3 满足)。

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/agent/handoff-handler.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `lib/agent/handoff-handler.ts`:

```ts
import { bus } from "../bus";
import type { Repo } from "../db/repo";

export interface HandoffDeps {
  repo: Repo;
  adminGroupId: number;
  timeoutMin: number;
  scanMs?: number;
}

export function registerHandoffHandler(deps: HandoffDeps): () => void {
  const { repo, adminGroupId, timeoutMin, scanMs = 60000 } = deps;

  const onRequested = (e: { sessionKey: string; lastQuestion: string }) => {
    repo.setHumanMode(e.sessionKey, true);
    bus.emit("action.send", {
      action: "send_group_msg",
      groupId: adminGroupId,
      text: `【转人工】会话 ${e.sessionKey} 需人工介入。最后问题:${e.lastQuestion}\n回复 !resume ${e.sessionKey} 结束接管。`,
    });
  };

  const onResumed = (e: { sessionKey: string }) => {
    repo.setHumanMode(e.sessionKey, false);
  };

  bus.on("handoff.requested", onRequested);
  bus.on("handoff.resumed", onResumed);

  const timer = setInterval(() => {
    for (const key of repo.staleHumanSessions(timeoutMin)) {
      bus.emit("handoff.resumed", { sessionKey: key });
    }
  }, scanMs);

  return () => {
    bus.off("handoff.requested", onRequested);
    bus.off("handoff.resumed", onResumed);
    clearInterval(timer);
  };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/agent/handoff-handler.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/agent/handoff-handler.ts lib/agent/handoff-handler.test.ts
git commit -m "feat: 转人工处理器(置位/通知/超时恢复)"
```

---

## Task 14: Error Handler

**Files:**
- Create: `lib/agent/error-handler.ts`
- Test: `lib/agent/error-handler.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/agent/error-handler.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { bus } from "../bus";
import { registerErrorHandler } from "./error-handler";

beforeEach(() => bus.removeAllListeners());

describe("error handler", () => {
  it("带 groupId 的错误 → 兜底话术发回群", async () => {
    registerErrorHandler({ logger: () => {} });
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("error.occurred", { scope: "test", err: new Error("boom"), sessionKey: "7:8" });
    const a = await p;
    expect(a.groupId).toBe(7);
    expect(a.text).toContain("稍后");
  });

  it("调用 logger 记录", () => {
    const logger = vi.fn();
    registerErrorHandler({ logger });
    bus.emit("error.occurred", { scope: "x", err: "e" });
    expect(logger).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/agent/error-handler.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `lib/agent/error-handler.ts`:

```ts
import { bus } from "../bus";

export interface ErrorHandlerDeps {
  logger?: (scope: string, err: unknown) => void;
}

export function registerErrorHandler(deps: ErrorHandlerDeps = {}): void {
  const logger = deps.logger ?? ((scope, err) => console.error(`[${scope}]`, err));

  bus.on("error.occurred", (e) => {
    logger(e.scope, e.err);
    if (e.sessionKey) {
      const groupId = Number(e.sessionKey.split(":")[0]);
      if (!Number.isNaN(groupId)) {
        bus.emit("action.send", {
          action: "send_group_msg",
          groupId,
          text: "系统繁忙,请稍后再试,或回复「人工」转接客服。",
        });
      }
    }
  });
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/agent/error-handler.test.ts`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add lib/agent/error-handler.ts lib/agent/error-handler.test.ts
git commit -m "feat: 集中错误处理(日志+兜底话术)"
```

---

## Task 15: 装配(instrumentation)+ 端到端

**Files:**
- Create: `lib/assemble.ts`
- Create: `instrumentation.ts`
- Test: `lib/assemble.test.ts`

**说明:** 把「装配逻辑」抽到可测的 `lib/assemble.ts`;`instrumentation.ts` 只做 env 读取 + 调用装配 + 起 WS client。E2E 用 mock agent + 真实 ws server 验证「群消息进 → 回复出」。

- [ ] **Step 1: 写端到端失败测试**

Create `lib/assemble.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "./db/index";
import { Repo } from "./db/repo";
import { bus } from "./bus";
import { assemble } from "./assemble";

beforeEach(() => bus.removeAllListeners());

describe("assemble e2e(总线级)", () => {
  it("@bot 群消息 → 经全链路 → 发出 send_group_msg", async () => {
    const repo = new Repo(openDb(":memory:"));
    const fakeAgent = { run: vi.fn(async () => ({ text: "已收到您的问题", sessionId: "s1" })) };
    assemble({
      repo,
      botQQ: 555,
      adminGroupId: 999,
      timeoutMin: 30,
      agent: fakeAgent as any,
    });

    const sent = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 1, rawText: "退货", atList: [555] });
    const a = await sent;
    expect(a.action).toBe("send_group_msg");
    expect(a.groupId).toBe(1);
    expect(a.text).toBe("已收到您的问题");
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run lib/assemble.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现装配**

Create `lib/assemble.ts`:

```ts
import type { Repo } from "./db/repo";
import type { Agent } from "./agent/agent";
import { SessionStore } from "./agent/session";
import { registerGateway } from "./agent/gateway";
import { registerOrchestrator } from "./agent/orchestrator";
import { registerReplyMapper } from "./agent/reply-mapper";
import { registerHandoffHandler } from "./agent/handoff-handler";
import { registerErrorHandler } from "./agent/error-handler";

export interface AssembleDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  timeoutMin: number;
  agent: Agent;
}

export function assemble(deps: AssembleDeps): void {
  const { repo, botQQ, adminGroupId, timeoutMin, agent } = deps;
  registerErrorHandler();
  registerGateway({ repo, botQQ, adminGroupId });
  registerOrchestrator({ agent, store: new SessionStore(repo) });
  registerReplyMapper();
  registerHandoffHandler({ repo, adminGroupId, timeoutMin });
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run lib/assemble.test.ts`
Expected: PASS(1 test)。

- [ ] **Step 5: 实现 instrumentation.ts(真实启动入口)**

Create `instrumentation.ts`:

```ts
export async function register(): Promise<void> {
  // 仅 Node runtime 执行(跳过 edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadConfig } = await import("./lib/config");
  const { openDb } = await import("./lib/db/index");
  const { Repo } = await import("./lib/db/repo");
  const { Agent } = await import("./lib/agent/agent");
  const { buildToolServer } = await import("./lib/tools/index");
  const { assemble } = await import("./lib/assemble");
  const { OneBotClient } = await import("./lib/onebot/client");

  const g = globalThis as unknown as { __agentBooted?: boolean };
  if (g.__agentBooted) return; // 单例守卫
  g.__agentBooted = true;

  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const repo = new Repo(db);
  const agent = new Agent({
    model: cfg.model,
    systemPrompt: "",
    toolServer: buildToolServer(repo),
  });

  assemble({
    repo,
    botQQ: cfg.botQQ,
    adminGroupId: cfg.adminGroupId,
    timeoutMin: cfg.handoffTimeoutMin,
    agent,
  });

  const client = new OneBotClient(cfg.onebotWsUrl, cfg.onebotAccessToken);
  client.start();
  console.log("[agent] OneBot 客服 Agent 已启动");
}
```

- [ ] **Step 6: 确认 Next 配置允许 instrumentation(Next 16 默认启用)**

确认 `next.config.ts` 无禁用项;Next 16 默认执行根目录 `instrumentation.ts` 的 `register()`。数据目录需存在:

```bash
mkdir -p data && echo "data/" >> .gitignore
```

- [ ] **Step 7: 跑全量测试**

Run: `pnpm test`
Expected: 全部 PASS(排除需下模型的 embed 测试可能耗时)。

- [ ] **Step 8: Commit**

```bash
git add lib/assemble.ts lib/assemble.test.ts instrumentation.ts .gitignore
git commit -m "feat: 装配全链路 + instrumentation 启动入口"
```

---

## Task 16: 环境样例 + 文档 + 冒烟验证

**Files:**
- Create: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: 写 .env.example**

Create `.env.example`:

```
# PackyAPI(Claude 中转)
ANTHROPIC_BASE_URL=https://www.packyapi.ai
ANTHROPIC_AUTH_TOKEN=your-cc-group-token
ANTHROPIC_MODEL=claude-sonnet-5

# OneBot(NapCat 正向 WS server)
ONEBOT_WS_URL=ws://127.0.0.1:3001
ONEBOT_ACCESS_TOKEN=
BOT_QQ=10000
ADMIN_GROUP_ID=20000
HANDOFF_TIMEOUT_MIN=30

# 存储
DB_PATH=./data/agent.db
```

- [ ] **Step 2: README 加运行说明**

在 `README.md` 追加一节「OneBot 客服 Agent」:填写 `.env` → `pnpm ingest`(灌知识库)→ `pnpm build && pnpm start`(node runtime)→ NapCat 开正向 WS server 指向本机端口 → 群里 @bot 测试。注明:不能用 `next dev` 的 edge/serverless 部署;SDK 需 claude 二进制。

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `pnpm typecheck && pnpm test`
Expected: 无类型错误;测试全绿。

- [ ] **Step 4: 冒烟(需真实 NapCat 或手动 WS 模拟)**

启动应用,用一个最小 WS server 模拟 NapCat 发一条 @bot 群消息,确认应用回连并发出 `send_group_msg`。或直接接真实 NapCat 群聊 @bot 验证。

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md
git commit -m "docs: 环境样例与运行说明"
```

---

## 自检对照(spec 覆盖)

- 事件驱动总线 → Task 1 ✓
- PackyAPI 接入(env)→ Task 2 + Task 11(options.model)+ Task 16 ✓
- 正向 WS 收发 + 重连 → Task 5 ✓
- 群聊 @bot 触发 / session key / 去重 / 管理命令 → Task 6 ✓
- 多轮记忆(session_id resume)→ Task 7 + Task 11 + Task 12 ✓
- RAG(sqlite-vec + 本地 embed + ingest)→ Task 3/8/9/10 ✓
- 业务 tool → Task 10 ✓
- 转人工(tool 仅 emit + handler 置位/通知/超时)→ Task 10/13 ✓
- 错误处理集中化 → Task 14 ✓
- 单例装配 / instrumentation → Task 15 ✓
- 测试策略(emit 输入→断言输出)→ 各 Task 测试 ✓

## 未决 / 实现时确认项

1. **SDK message 结构**:Task 11 提取 assistant 文本、init session_id 的字段名以运行时实测为准,不符只改 `agent.ts` 一处。
2. **embedding 维度**:Task 8 实测 bge-small-zh-v1.5 输出维度,与 `lib/db/index.ts` 的 `DIM` 对齐(预设 512)。
3. **NapCat 消息格式**:数组段 vs CQ 字符串由 NapCat 配置决定,Task 4 已两者兼容。
4. **claude 二进制**:部署环境确保 SDK 能找到 claude 可执行文件(平台包或 `pathToClaudeCodeExecutable`)。
