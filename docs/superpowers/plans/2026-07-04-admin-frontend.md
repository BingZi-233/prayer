# 管理后台前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 OneBot 客服 Agent 建立 Web 管理后台,所有配置(OneBot + Claude Agent SDK)由前端完成,配置热重载生效,并提供运行监控、知识库管理、会话/日志查看。

**Architecture:** 单进程 Next.js。把 `instrumentation.ts` 的 boot 逻辑抽到 `lib/runtime.ts` 的 `RuntimeManager` 单例(挂 globalThis),持有 Agent 运行时生命周期,暴露 `start/stop/reconfigure/getStatus`。Next API route handler 同进程直接调 manager,零 IPC。配置存 SQLite `config` 表;SDK 靠写 `CLAUDE_CONFIG_DIR/settings.json` + query 传 `settingSources`。

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · better-sqlite3 + sqlite-vec · @anthropic-ai/claude-agent-sdk · zod v4 · react-hook-form · shadcn/ui · vitest。

**关联 spec:** `docs/superpowers/specs/2026-07-04-admin-frontend-design.md`

**约束:** 依赖用 `pnpm add`,脚本用 `pnpm pkg set`,**不手改 package.json**。延续现有 TDD + 频繁提交。

---

## 文件结构

**新建:**
- `lib/config-store.ts` — `config` 表读写 + env 种子
- `lib/config-store.test.ts`
- `lib/settings-writer.ts` — settings.json 读写 + 校验 + secret 掩码/合并
- `lib/settings-writer.test.ts`
- `lib/logger.ts` — ring buffer logger + console 捕获
- `lib/logger.test.ts`
- `lib/runtime.ts` — RuntimeManager
- `lib/runtime.test.ts`
- `lib/transcript.ts` — SDK JSONL 解析 + 路径定位
- `lib/transcript.test.ts`
- `lib/api.ts` — API 统一响应工具 `{ok,data?,error?}`
- `app/admin/layout.tsx` · `app/admin/page.tsx`(状态)· `app/admin/config/page.tsx` · `app/admin/kb/page.tsx` · `app/admin/sessions/page.tsx`
- `app/api/config/route.ts` · `app/api/status/route.ts` · `app/api/runtime/restart/route.ts` · `app/api/kb/route.ts` · `app/api/kb/[file]/route.ts` · `app/api/kb/ingest/route.ts` · `app/api/sessions/route.ts` · `app/api/sessions/[id]/route.ts` · `app/api/logs/route.ts`

**修改:**
- `lib/db/repo.ts` — 加 `getConfigRow/setConfigRow/countSessions/listSessions/openTickets`
- `lib/onebot/client.ts` — 暴露连接状态 + status 回调
- `scripts/ingest.ts` — 抽出可复用 `runIngest(repo, dir)`
- `instrumentation.ts` — 瘦身,改调 `RuntimeManager`

---

## Task 1: config 表 + config-store

**Files:**
- Modify: `lib/db/index.ts`(migrate 加 config 表)
- Modify: `lib/db/repo.ts`(加 getConfigRow/setConfigRow)
- Create: `lib/config-store.ts`
- Test: `lib/config-store.test.ts`

- [ ] **Step 1: 加 config 表到 migrate**

`lib/db/index.ts` 的 `migrate` 内 `db.exec` 模板字符串**末尾**(kb_vec 之后)追加:

```sql
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
```

- [ ] **Step 2: Repo 加 config 行读写**

`lib/db/repo.ts` 类内追加:

```typescript
  getConfigRow(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setConfigRow(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, value);
  }
```

- [ ] **Step 3: 写失败测试 config-store**

`lib/config-store.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { openDb } from "./db/index";
import { Repo } from "./db/repo";
import { getConfig, setConfig } from "./config-store";

function mkRepo(): Repo {
  return new Repo(openDb(":memory:", 3));
}

describe("config-store", () => {
  it("无行时用 env 种子并落库", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, {
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "111",
      ADMIN_GROUP_ID: "222",
    });
    expect(cfg.onebotWsUrl).toBe("ws://x:1");
    expect(cfg.botQQ).toBe(111);
    // 已落库:再读(空 env)仍拿到
    const again = getConfig(repo, {});
    expect(again.botQQ).toBe(111);
  });

  it("setConfig 局部更新并持久化", () => {
    const repo = mkRepo();
    getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    setConfig(repo, { botQQ: 999, model: "claude-opus-4-8" });
    const cfg = getConfig(repo, {});
    expect(cfg.botQQ).toBe(999);
    expect(cfg.model).toBe("claude-opus-4-8");
    expect(cfg.onebotWsUrl).toBe("ws://x:1"); // 未改字段保留
  });

  it("默认值:handoffTimeoutMin=30, model, dbPath, claudeConfigDir", () => {
    const repo = mkRepo();
    const cfg = getConfig(repo, { ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(cfg.handoffTimeoutMin).toBe(30);
    expect(cfg.model).toBe("claude-sonnet-5");
    expect(cfg.dbPath).toBe("./data/agent.db");
    expect(cfg.claudeConfigDir).toBe("./data/claude-config");
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm vitest run lib/config-store.test.ts`
Expected: FAIL —「Cannot find module './config-store'」

- [ ] **Step 5: 实现 config-store**

`lib/config-store.ts`:

```typescript
import type { Repo } from "./db/repo";

const KEY = "app";

export interface AppConfig {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  model: string;
}

function seedFromEnv(env: Record<string, string | undefined>): AppConfig {
  return {
    onebotWsUrl: env.ONEBOT_WS_URL ?? "",
    onebotAccessToken: env.ONEBOT_ACCESS_TOKEN ?? "",
    botQQ: Number(env.BOT_QQ ?? "0"),
    adminGroupId: Number(env.ADMIN_GROUP_ID ?? "0"),
    handoffTimeoutMin: Number(env.HANDOFF_TIMEOUT_MIN ?? "30"),
    dbPath: env.DB_PATH ?? "./data/agent.db",
    claudeConfigDir: env.CLAUDE_CONFIG_DIR ?? "./data/claude-config",
    model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  };
}

export function getConfig(
  repo: Repo,
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const raw = repo.getConfigRow(KEY);
  if (!raw) {
    const seeded = seedFromEnv(env);
    repo.setConfigRow(KEY, JSON.stringify(seeded));
    return seeded;
  }
  return JSON.parse(raw) as AppConfig;
}

export function setConfig(repo: Repo, patch: Partial<AppConfig>): AppConfig {
  const current = getConfig(repo);
  const next = { ...current, ...patch };
  repo.setConfigRow(KEY, JSON.stringify(next));
  return next;
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm vitest run lib/config-store.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/db/index.ts lib/db/repo.ts lib/config-store.ts lib/config-store.test.ts
git commit -m "feat: config 表 + config-store(env 种子 + 局部更新)"
```

---

## Task 2: settings-writer(SDK settings.json + secret 掩码)

**Files:**
- Create: `lib/settings-writer.ts`
- Test: `lib/settings-writer.test.ts`

- [ ] **Step 1: 写失败测试**

`lib/settings-writer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maskSecret, mergeSecret, writeSettings, readSettings } from "./settings-writer";

describe("maskSecret", () => {
  it("空值返回空", () => expect(maskSecret("")).toBe(""));
  it("短值全掩码", () => expect(maskSecret("abc")).toBe("••••"));
  it("留后4位", () => expect(maskSecret("sk-12345678")).toBe("••••5678"));
});

describe("mergeSecret", () => {
  it("incoming 空则保留 existing", () => expect(mergeSecret("old", "")).toBe("old"));
  it("incoming 非空则覆盖", () => expect(mergeSecret("old", "new")).toBe("new"));
});

describe("settings.json 读写", () => {
  it("写入合法 JSON 再读回", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    writeSettings(dir, { env: { ANTHROPIC_MODEL: "claude-sonnet-5" } });
    const raw = readFileSync(join(dir, "settings.json"), "utf8");
    expect(JSON.parse(raw).env.ANTHROPIC_MODEL).toBe("claude-sonnet-5");
    expect(readSettings(dir)?.env?.ANTHROPIC_MODEL).toBe("claude-sonnet-5");
  });

  it("目录不存在时自动创建", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "cfg-")), "nested");
    writeSettings(dir, { model: "x" });
    expect(readSettings(dir)?.model).toBe("x");
  });

  it("读不存在的 settings 返回 null", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    expect(readSettings(dir)).toBeNull();
  });

  it("writeSettingsRaw 拒绝非法 JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    expect(() => writeSettingsRaw(dir, "{not json")).toThrow();
  });
});

import { writeSettingsRaw } from "./settings-writer";
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run lib/settings-writer.test.ts`
Expected: FAIL —「Cannot find module './settings-writer'」

- [ ] **Step 3: 实现**

`lib/settings-writer.ts`:

```typescript
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Settings = Record<string, unknown> & {
  env?: Record<string, string>;
  model?: string;
};

function settingsPath(configDir: string): string {
  return join(configDir, "settings.json");
}

export function maskSecret(v: string): string {
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return "••••" + v.slice(-4);
}

export function mergeSecret(existing: string, incoming: string): string {
  return incoming ? incoming : existing;
}

export function writeSettings(configDir: string, settings: Settings): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath(configDir), JSON.stringify(settings, null, 2), "utf8");
}

export function writeSettingsRaw(configDir: string, raw: string): void {
  JSON.parse(raw); // 校验:非法 JSON 抛错
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath(configDir), raw, "utf8");
}

export function readSettings(configDir: string): Settings | null {
  const p = settingsPath(configDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Settings;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run lib/settings-writer.test.ts`
Expected: PASS(8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/settings-writer.ts lib/settings-writer.test.ts
git commit -m "feat: settings.json 读写 + secret 掩码/合并"
```

---

## Task 3: logger ring buffer

**Files:**
- Create: `lib/logger.ts`
- Test: `lib/logger.test.ts`

- [ ] **Step 1: 写失败测试**

`lib/logger.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { logger } from "./logger";

describe("logger ring buffer", () => {
  beforeEach(() => logger.clear());

  it("记录并读回", () => {
    logger.log("info", "hello");
    const lines = logger.tail();
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe("hello");
    expect(lines[0].level).toBe("info");
    expect(typeof lines[0].ts).toBe("number");
  });

  it("超过上限截断保留最新", () => {
    for (let i = 0; i < 600; i++) logger.log("info", `m${i}`);
    const lines = logger.tail();
    expect(lines).toHaveLength(500);
    expect(lines[0].msg).toBe("m100");
    expect(lines[499].msg).toBe("m599");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run lib/logger.test.ts`
Expected: FAIL —「Cannot find module './logger'」

- [ ] **Step 3: 实现**

`lib/logger.ts`:

```typescript
export interface LogLine {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
}

const MAX = 500;

class RingLogger {
  private buf: LogLine[] = [];

  log(level: LogLine["level"], msg: string): void {
    this.buf.push({ ts: Date.now(), level, msg });
    if (this.buf.length > MAX) this.buf.splice(0, this.buf.length - MAX);
  }

  tail(): LogLine[] {
    return [...this.buf];
  }

  clear(): void {
    this.buf = [];
  }
}

const g = globalThis as unknown as { __agentLogger?: RingLogger; __consolePatched?: boolean };
export const logger: RingLogger = g.__agentLogger ?? (g.__agentLogger = new RingLogger());

// 一次性捕获 console 输出到 ring buffer(SDK/agent 的日志也进来)
export function captureConsole(): void {
  if (g.__consolePatched) return;
  g.__consolePatched = true;
  const wrap = (level: LogLine["level"], orig: (...a: unknown[]) => void) => {
    return (...args: unknown[]) => {
      logger.log(level, args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      orig(...args);
    };
  };
  console.log = wrap("info", console.log.bind(console));
  console.warn = wrap("warn", console.warn.bind(console));
  console.error = wrap("error", console.error.bind(console));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run lib/logger.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/logger.ts lib/logger.test.ts
git commit -m "feat: ring buffer logger + console 捕获"
```

---

## Task 4: OneBotClient 暴露连接状态

**Files:**
- Modify: `lib/onebot/client.ts`

- [ ] **Step 1: 加连接状态 + 回调**

`lib/onebot/client.ts` 改造。构造函数加可选 `onStatus` 回调,`open`/`close` 时触发;加 `isConnected()`:

```typescript
import WebSocket from "ws";
import { bus } from "../bus";
import { parseGroupMessage } from "./parse";
import type { ActionSend } from "../events";

export class OneBotClient {
  private ws?: WebSocket;
  private stopped = false;
  private backoff = 1000;
  private connected = false;
  private readonly onAction = (a: ActionSend) => this.sendAction(a);

  constructor(
    private url: string,
    private accessToken?: string,
    private onStatus?: (connected: boolean) => void
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    this.stopped = false;
    bus.on("action.send", this.onAction);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    bus.off("action.send", this.onAction);
    this.setConnected(false);
    this.ws?.close();
    this.ws = undefined;
  }

  private setConnected(v: boolean): void {
    if (this.connected === v) return;
    this.connected = v;
    this.onStatus?.(v);
  }

  private connect(): void {
    const headers = this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined;
    const ws = new WebSocket(this.url, { headers });
    this.ws = ws;

    ws.on("open", () => {
      this.backoff = 1000;
      this.setConnected(true);
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      let evt: unknown;
      try { evt = JSON.parse(raw.toString()); } catch { return; }
      const msg = parseGroupMessage(evt);
      if (msg) bus.emit("message.received", msg);
    });

    ws.on("close", () => {
      this.setConnected(false);
      this.scheduleReconnect();
    });
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

- [ ] **Step 2: typecheck 确认无回归**

Run: `pnpm typecheck`
Expected: 无错误(现有 `instrumentation.ts` 用两参构造仍兼容,onStatus 可选)

- [ ] **Step 3: Commit**

```bash
git add lib/onebot/client.ts
git commit -m "feat: OneBotClient 暴露连接状态与 onStatus 回调"
```

---

## Task 5: Repo 加统计/列表方法

**Files:**
- Modify: `lib/db/repo.ts`
- Test: `lib/db/repo.stats.test.ts`

- [ ] **Step 1: 写失败测试**

`lib/db/repo.stats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { openDb } from "./index";
import { Repo } from "./repo";

function mkRepo(): Repo {
  return new Repo(openDb(":memory:", 3));
}

describe("Repo 统计/列表", () => {
  it("countSessions 计数", () => {
    const repo = mkRepo();
    expect(repo.countSessions()).toBe(0);
    repo.setSessionId("g1:u1", "s1");
    repo.setSessionId("g1:u2", "s2");
    expect(repo.countSessions()).toBe(2);
  });

  it("listSessions 返回 key/session_id/human_mode/updated_at", () => {
    const repo = mkRepo();
    repo.setSessionId("g1:u1", "s1");
    repo.setHumanMode("g1:u1", true);
    const list = repo.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe("g1:u1");
    expect(list[0].sessionId).toBe("s1");
    expect(list[0].humanMode).toBe(true);
  });

  it("openTickets 只返回 open", () => {
    const repo = mkRepo();
    repo.createTicket("g1:u1", "退款问题");
    const t = repo.openTickets();
    expect(t).toHaveLength(1);
    expect(t[0].sessionKey).toBe("g1:u1");
    expect(t[0].summary).toBe("退款问题");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run lib/db/repo.stats.test.ts`
Expected: FAIL —「repo.countSessions is not a function」

- [ ] **Step 3: 实现 — Repo 追加方法**

`lib/db/repo.ts` 类内追加:

```typescript
  countSessions(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    return row.n;
  }

  listSessions(): { key: string; sessionId: string | null; humanMode: boolean; updatedAt: number }[] {
    const rows = this.db
      .prepare("SELECT key, session_id, human_mode, updated_at FROM sessions ORDER BY updated_at DESC")
      .all() as { key: string; session_id: string | null; human_mode: number; updated_at: number }[];
    return rows.map((r) => ({
      key: r.key,
      sessionId: r.session_id,
      humanMode: !!r.human_mode,
      updatedAt: r.updated_at,
    }));
  }

  openTickets(): { id: number; sessionKey: string; summary: string; createdAt: number }[] {
    const rows = this.db
      .prepare("SELECT id, session_key, summary, created_at FROM tickets WHERE status = 'open' ORDER BY created_at DESC")
      .all() as { id: number; session_key: string; summary: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, sessionKey: r.session_key, summary: r.summary, createdAt: r.created_at }));
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run lib/db/repo.stats.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db/repo.ts lib/db/repo.stats.test.ts
git commit -m "feat: Repo 加 countSessions/listSessions/openTickets"
```

---

## Task 6: RuntimeManager

**Files:**
- Create: `lib/runtime.ts`
- Test: `lib/runtime.test.ts`

- [ ] **Step 1: 写失败测试**

`lib/runtime.test.ts`(用注入的 builders 隔离真实 WS/agent):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeManager, type RuntimeBuilders } from "./runtime";
import type { AppConfig } from "./config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "",
  botQQ: 1,
  adminGroupId: 2,
  handoffTimeoutMin: 30,
  dbPath: ":memory:",
  claudeConfigDir: "/tmp/cfgdir-test",
  model: "claude-sonnet-5",
};

function fakeBuilders(overrides: Partial<RuntimeBuilders> = {}): RuntimeBuilders {
  const client = {
    started: false,
    stopped: false,
    conn: false,
    start() { this.started = true; },
    stop() { this.stopped = true; },
    isConnected() { return this.conn; },
  };
  return {
    openDb: () => ({}) as never,
    makeRepo: () => ({ countSessions: () => 3, openTickets: () => [{}, {}] }) as never,
    makeAgent: () => ({}) as never,
    assemble: () => {},
    makeClient: () => client as never,
    ...overrides,
  };
}

describe("RuntimeManager", () => {
  let m: RuntimeManager;
  beforeEach(() => {
    m = new RuntimeManager();
  });

  it("初始 stopped", () => {
    expect(m.getStatus().state).toBe("stopped");
  });

  it("start 后 running,getStatus 汇报会话数与队列", () => {
    m.start(cfg, fakeBuilders());
    const s = m.getStatus();
    expect(s.state).toBe("running");
    expect(s.sessionCount).toBe(3);
    expect(s.handoffQueue).toBe(2);
    expect(typeof s.bootedAt).toBe("number");
  });

  it("start 时设置 CLAUDE_CONFIG_DIR", () => {
    m.start(cfg, fakeBuilders());
    expect(process.env.CLAUDE_CONFIG_DIR).toBe("/tmp/cfgdir-test");
  });

  it("makeClient.start 抛错 → error 态 + lastError", () => {
    const b = fakeBuilders({
      makeClient: () => ({ start() { throw new Error("boom"); }, stop() {}, isConnected: () => false }) as never,
    });
    m.start(cfg, b);
    const s = m.getStatus();
    expect(s.state).toBe("error");
    expect(s.lastError).toContain("boom");
  });

  it("reconfigure 先 stop 旧再 start 新", () => {
    let stops = 0;
    const client = { start() {}, stop() { stops++; }, isConnected: () => false };
    const b = fakeBuilders({ makeClient: () => client as never });
    m.start(cfg, b);
    m.reconfigure({ ...cfg, botQQ: 9 }, b);
    expect(stops).toBeGreaterThanOrEqual(1);
    expect(m.getStatus().state).toBe("running");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run lib/runtime.test.ts`
Expected: FAIL —「Cannot find module './runtime'」

- [ ] **Step 3: 实现**

`lib/runtime.ts`:

```typescript
import { bus } from "./bus";
import { logger } from "./logger";
import type { AppConfig } from "./config-store";
import type { Repo } from "./db/repo";

export type RuntimeState = "stopped" | "starting" | "running" | "error";

export interface RuntimeStatus {
  state: RuntimeState;
  wsConnected: boolean;
  sessionCount: number;
  handoffQueue: number;
  lastError?: string;
  bootedAt?: number;
}

interface RuntimeClient {
  start(): void;
  stop(): void;
  isConnected(): boolean;
}

export interface RuntimeBuilders {
  openDb: (path: string) => unknown;
  makeRepo: (db: unknown) => Repo;
  makeAgent: (cfg: AppConfig) => unknown;
  assemble: (args: {
    repo: Repo;
    botQQ: number;
    adminGroupId: number;
    timeoutMin: number;
    agent: unknown;
  }) => void;
  makeClient: (
    url: string,
    token: string | undefined,
    onStatus: (c: boolean) => void
  ) => RuntimeClient;
}

async function defaultBuilders(): Promise<RuntimeBuilders> {
  const { openDb } = await import("./db/index");
  const { Repo } = await import("./db/repo");
  const { Agent } = await import("./agent/agent");
  const { buildToolServer } = await import("./tools/index");
  const { assemble } = await import("./assemble");
  const { OneBotClient } = await import("./onebot/client");
  return {
    openDb: (p) => openDb(p),
    makeRepo: (db) => new Repo(db as never),
    makeAgent: (cfg) => {
      // repo 在 start 内构造,agent 需要 toolServer(repo);见 start 组装
      return { __cfg: cfg }; // 占位,start 内用真实 repo 重建
    },
    assemble,
    makeClient: (url, token, onStatus) => new OneBotClient(url, token, onStatus),
  };
}

export class RuntimeManager {
  private state: RuntimeState = "stopped";
  private lastError?: string;
  private bootedAt?: number;
  private repo?: Repo;
  private client?: RuntimeClient;
  private wsConnected = false;

  getStatus(): RuntimeStatus {
    return {
      state: this.state,
      wsConnected: this.wsConnected,
      sessionCount: this.repo ? this.repo.countSessions() : 0,
      handoffQueue: this.repo ? this.repo.openTickets().length : 0,
      lastError: this.lastError,
      bootedAt: this.bootedAt,
    };
  }

  start(cfg: AppConfig, builders: RuntimeBuilders): void {
    this.state = "starting";
    this.lastError = undefined;
    try {
      process.env.CLAUDE_CONFIG_DIR = cfg.claudeConfigDir;
      const db = builders.openDb(cfg.dbPath);
      const repo = builders.makeRepo(db);
      const agent = builders.makeAgent(cfg);
      builders.assemble({
        repo,
        botQQ: cfg.botQQ,
        adminGroupId: cfg.adminGroupId,
        timeoutMin: cfg.handoffTimeoutMin,
        agent,
      });
      const client = builders.makeClient(cfg.onebotWsUrl, cfg.onebotAccessToken || undefined, (c) => {
        this.wsConnected = c;
      });
      client.start();
      this.repo = repo;
      this.client = client;
      this.bootedAt = Date.now();
      this.state = "running";
      logger.log("info", "[runtime] started");
    } catch (err) {
      this.state = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.log("error", `[runtime] start failed: ${this.lastError}`);
    }
  }

  stop(): void {
    try {
      this.client?.stop();
    } finally {
      bus.removeAllListeners();
      this.client = undefined;
      this.wsConnected = false;
      this.state = "stopped";
      logger.log("info", "[runtime] stopped");
    }
  }

  reconfigure(cfg: AppConfig, builders: RuntimeBuilders): void {
    this.stop();
    this.start(cfg, builders);
  }
}

const g = globalThis as unknown as { __runtimeMgr?: RuntimeManager };
export function getRuntime(): RuntimeManager {
  return g.__runtimeMgr ?? (g.__runtimeMgr = new RuntimeManager());
}

export { defaultBuilders };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run lib/runtime.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/runtime.ts lib/runtime.test.ts
git commit -m "feat: RuntimeManager 生命周期(start/stop/reconfigure/getStatus)"
```

---

## Task 7: 真实 builders 组装 + instrumentation 瘦身

修正 Task 6 的 `makeAgent` 占位:agent 需要 `buildToolServer(repo)`,而 repo 在 `start` 内才构造。改为在 `assemble` 前用 repo 组装 agent。这里把 agent 构造下沉到一个 `buildAgent(cfg, repo)` builder。

**Files:**
- Modify: `lib/runtime.ts`(defaultBuilders 用 repo 建 agent)
- Modify: `instrumentation.ts`

- [ ] **Step 1: 调整 RuntimeBuilders.makeAgent 签名带 repo**

`lib/runtime.ts` 把 `makeAgent` 改为接收 repo:

```typescript
  makeAgent: (cfg: AppConfig, repo: Repo) => unknown;
```

`start` 内改调用顺序:

```typescript
      const repo = builders.makeRepo(db);
      const agent = builders.makeAgent(cfg, repo);
```

`defaultBuilders` 的 `makeAgent` 实现:

```typescript
    makeAgent: (cfg, repo) =>
      new Agent({
        model: cfg.model,
        systemPrompt: "",
        toolServer: buildToolServer(repo),
      }),
```

并更新 `lib/runtime.test.ts` 中 fakeBuilders 的 `makeAgent: () => ({}) as never` 无需改(忽略第二参)。

- [ ] **Step 2: 跑 runtime 测试确认仍通过**

Run: `pnpm vitest run lib/runtime.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 3: 瘦身 instrumentation.ts**

`instrumentation.ts` 全文替换:

```typescript
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as { __agentBooted?: boolean };
  if (g.__agentBooted) return;
  g.__agentBooted = true;

  const { captureConsole } = await import("./lib/logger");
  const { openDb } = await import("./lib/db/index");
  const { Repo } = await import("./lib/db/repo");
  const { getConfig } = await import("./lib/config-store");
  const { getRuntime, defaultBuilders } = await import("./lib/runtime");

  captureConsole();

  // 读配置(首启从 env 种子入库)
  const seedDb = openDb(process.env.DB_PATH ?? "./data/agent.db");
  const cfg = getConfig(new Repo(seedDb));
  seedDb.close();

  const builders = await defaultBuilders();
  getRuntime().start(cfg, builders);
  console.log("[agent] OneBot 客服 Agent 已启动");
}
```

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 5: 全量测试回归**

Run: `pnpm test`
Expected: 全绿(原 38 + 新增)

- [ ] **Step 6: Commit**

```bash
git add lib/runtime.ts lib/runtime.test.ts instrumentation.ts
git commit -m "feat: 真实 builders 组装 + instrumentation 改用 RuntimeManager"
```

---

## Task 8: ingest 抽出可复用函数

**Files:**
- Modify: `scripts/ingest.ts`
- Test: `scripts/ingest.test.ts`(已存在,追加用例)

- [ ] **Step 1: 追加失败测试**

`scripts/ingest.test.ts` 追加(先看现有 import,复用其风格):

```typescript
import { describe, it, expect, vi } from "vitest";
import { runIngest } from "./ingest";
import { openDb } from "../lib/db/index";
import { Repo } from "../lib/db/repo";

vi.mock("../lib/tools/embed", () => ({
  embed: async () => new Float32Array([0.1, 0.2, 0.3]),
}));

describe("runIngest", () => {
  it("对给定目录切块入库,返回统计", async () => {
    const repo = new Repo(openDb(":memory:", 3));
    const res = await runIngest(repo, "docs/kb");
    expect(Array.isArray(res)).toBe(true);
    // 至少不报错;若 docs/kb 有文件则 chunks>0
    for (const r of res) expect(r.chunks).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run scripts/ingest.test.ts`
Expected: FAIL —「runIngest is not exported」

- [ ] **Step 3: 重构 ingest 抽出 runIngest**

`scripts/ingest.ts` 替换 `main` 部分为:

```typescript
export interface IngestResult {
  file: string;
  chunks: number;
}

export async function runIngest(repo: Repo, dir = "docs/kb"): Promise<IngestResult[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  const out: IngestResult[] = [];
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8");
    const chunks = chunkText(content);
    for (const c of chunks) {
      const id = repo.insertKbChunk(f, c, f);
      repo.insertKbVec(id, await embed(c));
    }
    out.push({ file: f, chunks: chunks.length });
  }
  return out;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const repo = new Repo(db);
  const results = await runIngest(repo, "docs/kb");
  for (const r of results) console.log(`ingested ${r.file}: ${r.chunks} chunks`);
}

if (process.argv[1]?.endsWith("ingest.ts")) main();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run scripts/ingest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest.ts scripts/ingest.test.ts
git commit -m "refactor: ingest 抽出可复用 runIngest(repo, dir)"
```

---

## Task 9: transcript 解析器

**Files:**
- Create: `lib/transcript.ts`
- Test: `lib/transcript.test.ts`

- [ ] **Step 1: 写失败测试**

`lib/transcript.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscript, findTranscript } from "./transcript";

describe("parseTranscript", () => {
  it("解析 user/assistant 文本 + tool_use", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { content: "你好" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "您好,请问" }, { type: "tool_use", name: "kb_search", input: { q: "退款" } }] },
      }),
    ].join("\n");
    const msgs = parseTranscript(jsonl);
    expect(msgs[0]).toEqual({ role: "user", text: "你好", tool: undefined });
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].text).toBe("您好,请问");
    expect(msgs[2].tool).toBe("kb_search");
  });

  it("坏行跳过,未知类型忽略", () => {
    const jsonl = ["{bad json", JSON.stringify({ type: "system", subtype: "init" }), JSON.stringify({ type: "user", message: { content: "hi" } })].join("\n");
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("hi");
  });

  it("空输入返回空数组", () => {
    expect(parseTranscript("")).toEqual([]);
  });
});

describe("findTranscript", () => {
  it("在 configDir/projects 下递归找 <id>.jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const proj = join(dir, "projects", "-some-slug");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "abc-123.jsonl"), "");
    expect(findTranscript(dir, "abc-123")).toBe(join(proj, "abc-123.jsonl"));
    expect(findTranscript(dir, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run lib/transcript.test.ts`
Expected: FAIL —「Cannot find module './transcript'」

- [ ] **Step 3: 实现**

`lib/transcript.ts`:

```typescript
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TranscriptMsg {
  role: "user" | "assistant";
  text: string;
  tool?: string;
}

function extractText(content: unknown): { text: string; tool?: string } {
  if (typeof content === "string") return { text: content };
  if (Array.isArray(content)) {
    let text = "";
    let tool: string | undefined;
    for (const b of content) {
      if (b && typeof b === "object") {
        const block = b as { type?: string; text?: string; name?: string };
        if (block.type === "text" && block.text) text += block.text;
        if (block.type === "tool_use" && block.name) tool = block.name;
      }
    }
    return { text, tool };
  }
  return { text: "" };
}

export function parseTranscript(jsonl: string): TranscriptMsg[] {
  const out: TranscriptMsg[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: { type?: string; message?: { content?: unknown } };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // 坏行跳过
    }
    if (rec.type !== "user" && rec.type !== "assistant") continue; // 未知类型忽略
    const { text, tool } = extractText(rec.message?.content);
    out.push({ role: rec.type, text, tool });
  }
  return out;
}

export function findTranscript(configDir: string, sessionId: string): string | null {
  const root = join(configDir, "projects");
  if (!existsSync(root)) return null;
  const target = `${sessionId}.jsonl`;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === target) return full;
    }
  }
  return null;
}

export function readTranscript(configDir: string, sessionId: string): TranscriptMsg[] {
  const p = findTranscript(configDir, sessionId);
  if (!p) return [];
  return parseTranscript(readFileSync(p, "utf8"));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run lib/transcript.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/transcript.ts lib/transcript.test.ts
git commit -m "feat: SDK transcript JSONL 解析 + 文件定位"
```

---

## Task 10: API 工具 + config/status/runtime 路由

**Files:**
- Create: `lib/api.ts`
- Test: `lib/api.test.ts`
- Create: `app/api/config/route.ts` · `app/api/status/route.ts` · `app/api/runtime/restart/route.ts`

- [ ] **Step 1: 写 api 工具失败测试**

`lib/api.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ok, fail, maskConfig } from "./api";
import type { AppConfig } from "./config-store";

const cfg: AppConfig = {
  onebotWsUrl: "ws://x:1",
  onebotAccessToken: "secret-token-9999",
  botQQ: 1,
  adminGroupId: 2,
  handoffTimeoutMin: 30,
  dbPath: "./data/agent.db",
  claudeConfigDir: "./data/claude-config",
  model: "claude-sonnet-5",
};

describe("api helpers", () => {
  it("ok 包 data", () => expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } }));
  it("fail 包 error", () => expect(fail("boom")).toEqual({ ok: false, error: "boom" }));
  it("maskConfig 掩码 token", () => {
    const m = maskConfig(cfg);
    expect(m.onebotAccessToken).toBe("••••9999");
    expect(m.onebotWsUrl).toBe("ws://x:1"); // 非 secret 不动
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run lib/api.test.ts`
Expected: FAIL —「Cannot find module './api'」

- [ ] **Step 3: 实现 api 工具**

`lib/api.ts`:

```typescript
import type { AppConfig } from "./config-store";
import { maskSecret } from "./settings-writer";

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function maskConfig(cfg: AppConfig): AppConfig {
  return { ...cfg, onebotAccessToken: maskSecret(cfg.onebotAccessToken) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run lib/api.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: 实现 config 路由**

`app/api/config/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig, setConfig, type AppConfig } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { ok, fail, maskConfig } from "@/lib/api";
import { mergeSecret } from "@/lib/settings-writer";

function repo(): Repo {
  return new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db"));
}

const patchSchema = z.object({
  onebotWsUrl: z.string().optional(),
  onebotAccessToken: z.string().optional(),
  botQQ: z.number().optional(),
  adminGroupId: z.number().optional(),
  handoffTimeoutMin: z.number().optional(),
  dbPath: z.string().optional(),
  claudeConfigDir: z.string().optional(),
  model: z.string().optional(),
});

export async function GET(): Promise<NextResponse> {
  const cfg = getConfig(repo());
  return NextResponse.json(ok(maskConfig(cfg)));
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });

  const r = repo();
  const current = getConfig(r);
  const patch = { ...parsed.data } as Partial<AppConfig>;
  // secret 留空则保留
  if ("onebotAccessToken" in patch) {
    patch.onebotAccessToken = mergeSecret(current.onebotAccessToken, patch.onebotAccessToken ?? "");
  }
  const next = setConfig(r, patch);

  const builders = await defaultBuilders();
  getRuntime().reconfigure(next, builders);
  return NextResponse.json(ok(maskConfig(next)));
}
```

- [ ] **Step 6: 实现 status + runtime/restart 路由**

`app/api/status/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import { ok } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(ok(getRuntime().getStatus()));
}
```

`app/api/runtime/restart/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { getRuntime, defaultBuilders } from "@/lib/runtime";
import { ok } from "@/lib/api";

export async function POST(): Promise<NextResponse> {
  const cfg = getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db")));
  const builders = await defaultBuilders();
  getRuntime().reconfigure(cfg, builders);
  return NextResponse.json(ok(getRuntime().getStatus()));
}
```

- [ ] **Step 7: typecheck**

Run: `pnpm typecheck`
Expected: 无错误(确认 `@/*` 别名解析;若无 tsconfig paths,改用相对路径 import)

- [ ] **Step 8: Commit**

```bash
git add lib/api.ts lib/api.test.ts app/api/config app/api/status app/api/runtime
git commit -m "feat: api 工具 + config/status/restart 路由"
```

---

## Task 11: kb + logs + sessions 路由

**Files:**
- Create: `app/api/kb/route.ts` · `app/api/kb/[file]/route.ts` · `app/api/kb/ingest/route.ts` · `app/api/logs/route.ts` · `app/api/sessions/route.ts` · `app/api/sessions/[id]/route.ts`

- [ ] **Step 1: kb 列表/读写路由**

`app/api/kb/route.ts`(列 + 读单文件靠 query,写在 [file]):

```typescript
import { NextResponse } from "next/server";
import { readdirSync } from "node:fs";
import { ok } from "@/lib/api";

const KB_DIR = "docs/kb";

export async function GET(): Promise<NextResponse> {
  let files: string[] = [];
  try {
    files = readdirSync(KB_DIR).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  } catch {
    files = [];
  }
  return NextResponse.json(ok(files));
}
```

`app/api/kb/[file]/route.ts`(读写单文件,防目录穿越):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { z } from "zod";
import { ok, fail } from "@/lib/api";

const KB_DIR = "docs/kb";

function safePath(file: string): string | null {
  const name = basename(file); // 去掉路径分隔,防穿越
  if (!name.endsWith(".md") && !name.endsWith(".txt")) return null;
  return join(KB_DIR, name);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }): Promise<NextResponse> {
  const { file } = await ctx.params;
  const p = safePath(file);
  if (!p || !existsSync(p)) return NextResponse.json(fail("文件不存在"), { status: 404 });
  return NextResponse.json(ok(readFileSync(p, "utf8")));
}

const bodySchema = z.object({ content: z.string() });

export async function PUT(req: NextRequest, ctx: { params: Promise<{ file: string }> }): Promise<NextResponse> {
  const { file } = await ctx.params;
  const p = safePath(file);
  if (!p) return NextResponse.json(fail("文件名非法"), { status: 400 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(fail("参数非法"), { status: 400 });
  writeFileSync(p, parsed.data.content, "utf8");
  return NextResponse.json(ok(true));
}
```

`app/api/kb/ingest/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { runIngest } from "@/scripts/ingest";
import { ok, fail } from "@/lib/api";

export async function POST(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db")));
    const db = openDb(cfg.dbPath);
    const results = await runIngest(new Repo(db), "docs/kb");
    return NextResponse.json(ok(results));
  } catch (err) {
    return NextResponse.json(fail(err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}
```

- [ ] **Step 2: logs 路由**

`app/api/logs/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { ok } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(ok(logger.tail()));
}
```

- [ ] **Step 3: sessions 路由**

`app/api/sessions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { ok } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  const cfg = getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db")));
  const repo = new Repo(openDb(cfg.dbPath));
  return NextResponse.json(ok(repo.listSessions()));
}
```

`app/api/sessions/[id]/route.ts`(id = session_id):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { readTranscript } from "@/lib/transcript";
import { ok } from "@/lib/api";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const cfg = getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db")));
  const msgs = readTranscript(cfg.claudeConfigDir, id);
  return NextResponse.json(ok(msgs));
}
```

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: 无错误(确认 `@/scripts/ingest` 可解析;若 tsconfig paths 未含 scripts,用相对路径 `../../../../scripts/ingest`)

- [ ] **Step 5: Commit**

```bash
git add app/api/kb app/api/logs app/api/sessions
git commit -m "feat: kb/logs/sessions API 路由"
```

---

## Task 12: 装依赖 + shadcn 组件 + admin 布局

**Files:**
- Create: `app/admin/layout.tsx`
- Modify: package(经 pnpm add / shadcn CLI)

- [ ] **Step 1: 装前端依赖**

```bash
pnpm add react-hook-form @hookform/resolvers
```

- [ ] **Step 2: 装 shadcn 组件**

```bash
pnpm dlx shadcn@latest add input card table tabs badge textarea label sonner
```

预期:组件写入 `components/ui/`。若交互式提示,接受默认。

- [ ] **Step 3: next.config 标记原生/重型包为 server external**

route handler 会 import better-sqlite3(原生)、sqlite-vec、@huggingface/transformers(经 ingest)。Next 打包这些会炸,须声明 external。`next.config.ts` 替换:

```typescript
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sqlite-vec", "@huggingface/transformers"],
}

export default nextConfig
```

- [ ] **Step 4: 写 admin 布局 + 导航**

`app/admin/layout.tsx`:

```tsx
import Link from "next/link";

const nav = [
  { href: "/admin", label: "状态" },
  { href: "/admin/config", label: "配置" },
  { href: "/admin/kb", label: "知识库" },
  { href: "/admin/sessions", label: "会话/日志" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <aside className="w-48 border-r p-4">
        <h2 className="mb-4 font-semibold">客服 Agent 管理</h2>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="rounded px-2 py-1 text-sm hover:bg-muted">
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5: typecheck + build 冒烟**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml components/ui app/admin/layout.tsx next.config.ts
git commit -m "feat: admin 布局 + 前端依赖/shadcn 组件 + serverExternalPackages"
```

---

## Task 13: 状态页 /admin

**Files:**
- Create: `app/admin/page.tsx`

- [ ] **Step 1: 写状态页(client component,3s 轮询)**

`app/admin/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Status {
  state: string;
  wsConnected: boolean;
  sessionCount: number;
  handoffQueue: number;
  lastError?: string;
  bootedAt?: number;
}

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/status").then((x) => x.json());
    if (r.ok) setS(r.data);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  async function restart() {
    setBusy(true);
    await fetch("/api/runtime/restart", { method: "POST" });
    await load();
    setBusy(false);
  }

  const stateColor = s?.state === "running" ? "default" : s?.state === "error" ? "destructive" : "secondary";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">运行状态</h1>
        <Button onClick={restart} disabled={busy}>{busy ? "重启中…" : "重启 Agent"}</Button>
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">状态</div>
            <Badge variant={stateColor}>{s.state}</Badge>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">WS 连接</div>
            <Badge variant={s.wsConnected ? "default" : "secondary"}>{s.wsConnected ? "已连接" : "断开"}</Badge>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">会话数</div>
            <div className="text-2xl font-semibold">{s.sessionCount}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">转人工队列</div>
            <div className="text-2xl font-semibold">{s.handoffQueue}</div>
          </Card>
        </div>
      )}
      {s?.lastError && (
        <Card className="border-destructive p-4">
          <div className="text-sm font-medium text-destructive">最近错误</div>
          <pre className="mt-1 text-xs whitespace-pre-wrap">{s.lastError}</pre>
        </Card>
      )}
      {s?.bootedAt && (
        <div className="text-xs text-muted-foreground">启动于 {new Date(s.bootedAt).toLocaleString()}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: 状态/健康页(轮询 + 重启按钮)"
```

---

## Task 14: 配置页 /admin/config

**Files:**
- Create: `app/admin/config/page.tsx`

- [ ] **Step 1: 写配置页(表单 → PUT /api/config)**

`app/admin/config/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface Cfg {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  model: string;
}

const NUM_KEYS: (keyof Cfg)[] = ["botQQ", "adminGroupId", "handoffTimeoutMin"];

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/config").then((x) => x.json()).then((r) => { if (r.ok) setCfg(r.data); });
  }, []);

  function upd(k: keyof Cfg, v: string) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: NUM_KEYS.includes(k) ? Number(v) : v });
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setMsg("");
    // token 若仍是掩码(含 •)则不提交该字段
    const payload: Partial<Cfg> = { ...cfg };
    if (typeof payload.onebotAccessToken === "string" && payload.onebotAccessToken.includes("•")) {
      delete payload.onebotAccessToken;
    }
    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((x) => x.json());
    setMsg(r.ok ? "已保存并热重载" : `失败:${r.error}`);
    if (r.ok) setCfg(r.data);
    setBusy(false);
  }

  if (!cfg) return <div>加载中…</div>;

  const fields: { k: keyof Cfg; label: string; secret?: boolean }[] = [
    { k: "onebotWsUrl", label: "OneBot WS 地址" },
    { k: "onebotAccessToken", label: "OneBot Access Token", secret: true },
    { k: "botQQ", label: "Bot QQ" },
    { k: "adminGroupId", label: "管理群号" },
    { k: "handoffTimeoutMin", label: "转人工超时(分钟)" },
    { k: "model", label: "模型" },
    { k: "claudeConfigDir", label: "CLAUDE_CONFIG_DIR" },
    { k: "dbPath", label: "数据库路径" },
  ];

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold">配置</h1>
      <Card className="flex flex-col gap-3 p-4">
        {fields.map((f) => (
          <div key={f.k} className="flex flex-col gap-1">
            <Label htmlFor={f.k}>{f.label}</Label>
            <Input
              id={f.k}
              value={String(cfg[f.k])}
              placeholder={f.secret ? "留空不修改" : ""}
              onChange={(e) => upd(f.k, e.target.value)}
            />
          </div>
        ))}
      </Card>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>{busy ? "保存中…" : "保存并热重载"}</Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        提示:SDK 认证经 CLAUDE_CONFIG_DIR/settings.json 配置。当前 MVP 表单管连接参数;settings.json 高级编辑见后续迭代。
      </p>
    </div>
  );
}
```

> 说明:spec 提到 settings.json 结构化字段 + raw JSON 编辑器。本 MVP 任务先落连接配置 + `claudeConfigDir` 路径;settings.json 的 raw 编辑器作为 Task 17(可选增强)。若需一并做,见 Task 17。

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add app/admin/config/page.tsx
git commit -m "feat: 配置页(热重载 + secret 掩码保留)"
```

---

## Task 15: 知识库页 /admin/kb

**Files:**
- Create: `app/admin/kb/page.tsx`

- [ ] **Step 1: 写知识库页**

`app/admin/kb/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function KbPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadFiles() {
    const r = await fetch("/api/kb").then((x) => x.json());
    if (r.ok) setFiles(r.data);
  }
  useEffect(() => { loadFiles(); }, []);

  async function open(f: string) {
    setActive(f);
    const r = await fetch(`/api/kb/${encodeURIComponent(f)}`).then((x) => x.json());
    if (r.ok) setContent(r.data);
  }

  async function save() {
    if (!active) return;
    setBusy(true);
    const r = await fetch(`/api/kb/${encodeURIComponent(active)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }).then((x) => x.json());
    setMsg(r.ok ? "已保存" : `失败:${r.error}`);
    setBusy(false);
  }

  async function ingest() {
    setBusy(true);
    setMsg("重建中…");
    const r = await fetch("/api/kb/ingest", { method: "POST" }).then((x) => x.json());
    setMsg(r.ok ? `完成:${r.data.map((x: { file: string; chunks: number }) => `${x.file}(${x.chunks})`).join(", ")}` : `失败:${r.error}`);
    setBusy(false);
  }

  return (
    <div className="flex gap-4">
      <Card className="w-56 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">文件</span>
          <Button size="sm" variant="secondary" onClick={ingest} disabled={busy}>重建 embedding</Button>
        </div>
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f}>
              <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${active === f ? "bg-muted" : ""}`} onClick={() => open(f)}>{f}</button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-1 flex-col gap-3">
        {active ? (
          <>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[400px] font-mono text-sm" />
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={busy}>保存</Button>
              {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">选择左侧文件编辑,或点「重建 embedding」。{msg && ` ${msg}`}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add app/admin/kb/page.tsx
git commit -m "feat: 知识库编辑 + 触发 ingest 页"
```

---

## Task 16: 会话/日志页 /admin/sessions

**Files:**
- Create: `app/admin/sessions/page.tsx`

- [ ] **Step 1: 写会话/日志页**

`app/admin/sessions/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

interface Sess { key: string; sessionId: string | null; humanMode: boolean; updatedAt: number; }
interface Msg { role: string; text: string; tool?: string; }
interface Log { ts: number; level: string; msg: string; }

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [active, setActive] = useState<string | null>(null);

  async function loadSessions() {
    const r = await fetch("/api/sessions").then((x) => x.json());
    if (r.ok) setSessions(r.data);
  }
  async function loadLogs() {
    const r = await fetch("/api/logs").then((x) => x.json());
    if (r.ok) setLogs(r.data);
  }
  useEffect(() => {
    loadSessions();
    loadLogs();
    const t = setInterval(loadLogs, 3000);
    return () => clearInterval(t);
  }, []);

  async function open(s: Sess) {
    if (!s.sessionId) return;
    setActive(s.key);
    const r = await fetch(`/api/sessions/${encodeURIComponent(s.sessionId)}`).then((x) => x.json());
    if (r.ok) setMsgs(r.data);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4">
        <Card className="w-64 p-4">
          <div className="mb-2 font-medium">会话</div>
          <ul className="flex flex-col gap-1">
            {sessions.map((s) => (
              <li key={s.key}>
                <button className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${active === s.key ? "bg-muted" : ""}`} onClick={() => open(s)}>
                  {s.key}{s.humanMode ? " 🧑‍💼" : ""}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex-1 p-4">
          <div className="mb-2 font-medium">消息</div>
          <div className="flex flex-col gap-2">
            {msgs.map((m, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium">{m.role}:</span> {m.text}
                {m.tool && <span className="ml-2 text-xs text-muted-foreground">[工具: {m.tool}]</span>}
              </div>
            ))}
            {active && msgs.length === 0 && <div className="text-sm text-muted-foreground">无 transcript(或 session 文件未找到)</div>}
          </div>
        </Card>
      </div>
      <Card className="p-4">
        <div className="mb-2 font-medium">运行时日志</div>
        <pre className="max-h-64 overflow-auto text-xs">
          {logs.map((l, i) => `${new Date(l.ts).toLocaleTimeString()} [${l.level}] ${l.msg}`).join("\n")}
        </pre>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 全量测试 + build 冒烟**

Run: `pnpm test && pnpm build`
Expected: 测试全绿;build 成功(App Router 编译通过)

- [ ] **Step 4: Commit**

```bash
git add app/admin/sessions/page.tsx
git commit -m "feat: 会话/日志查看页(transcript + ring buffer 日志)"
```

---

## Task 17(可选增强): settings.json raw 编辑器

spec 要求配置页含 SDK settings.json 结构化字段 + raw JSON 编辑器。Task 14 已落连接配置 + `claudeConfigDir`。本任务补 settings.json 编辑,写入 `claudeConfigDir/settings.json`。

**Files:**
- Create: `app/api/settings/route.ts`
- Modify: `app/admin/config/page.tsx`(加 settings.json textarea)

- [ ] **Step 1: settings 路由(读/写 raw JSON)**

`app/api/settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { getConfig } from "@/lib/config-store";
import { readSettings, writeSettingsRaw } from "@/lib/settings-writer";
import { ok, fail } from "@/lib/api";

function cfgDir(): string {
  return getConfig(new Repo(openDb(process.env.DB_PATH ?? "./data/agent.db"))).claudeConfigDir;
}

export async function GET(): Promise<NextResponse> {
  const s = readSettings(cfgDir());
  return NextResponse.json(ok(s ? JSON.stringify(s, null, 2) : "{\n  \"env\": {}\n}"));
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.raw !== "string") return NextResponse.json(fail("参数非法"), { status: 400 });
  try {
    writeSettingsRaw(cfgDir(), body.raw);
    return NextResponse.json(ok(true));
  } catch {
    return NextResponse.json(fail("非法 JSON"), { status: 400 });
  }
}
```

- [ ] **Step 2: 配置页加 settings.json 编辑块**

`app/admin/config/page.tsx` 在保存按钮下方追加(新增独立 state + 保存):

```tsx
// 组件顶部 state 追加:
const [settings, setSettings] = useState("");
const [sMsg, setSMsg] = useState("");

// useEffect 内追加:
useEffect(() => {
  fetch("/api/settings").then((x) => x.json()).then((r) => { if (r.ok) setSettings(r.data); });
}, []);

async function saveSettings() {
  const r = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: settings }),
  }).then((x) => x.json());
  setSMsg(r.ok ? "settings.json 已保存(下次重启/热重载生效)" : `失败:${r.error}`);
}
```

JSX 追加(在根 div 末尾,`Textarea` 已在 kb 页引入,这里 import):

```tsx
<Card className="flex flex-col gap-3 p-4">
  <Label>SDK settings.json(高级)</Label>
  <Textarea value={settings} onChange={(e) => setSettings(e.target.value)} className="min-h-[240px] font-mono text-xs" />
  <div className="flex items-center gap-3">
    <Button variant="secondary" onClick={saveSettings}>保存 settings.json</Button>
    {sMsg && <span className="text-sm text-muted-foreground">{sMsg}</span>}
  </div>
</Card>
```

顶部 import 追加:`import { Textarea } from "@/components/ui/textarea";`

- [ ] **Step 3: agent.run 传 settingSources**

`lib/agent/agent.ts` 的 query options 追加 `settingSources: ["user"]`,让 SDK 加载 `CLAUDE_CONFIG_DIR/settings.json`:

```typescript
      options: {
        model: this.deps.model,
        systemPrompt: this.deps.systemPrompt || DEFAULT_SYSTEM,
        mcpServers: { cs: this.deps.toolServer as any },
        allowedTools: TOOL_NAMES,
        resume: resumeId,
        maxTurns: 8,
        settingSources: ["user"],
      } as any,
```

- [ ] **Step 4: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: 无错误,build 成功

- [ ] **Step 5: Commit**

```bash
git add app/api/settings app/admin/config/page.tsx lib/agent/agent.ts
git commit -m "feat: settings.json raw 编辑器 + query 传 settingSources"
```

---

## 验收(部署冒烟 — 需真实 NapCat + PackyAPI/claude)

1. 填 `docs/kb` 内容 → `/admin/kb` 点「重建 embedding」(或 `pnpm ingest`)。
2. `/admin/config` 填 OneBot WS/Token/BOT_QQ/管理群,保存热重载。
3. `/admin/config` settings.json 填 SDK env(ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL 或指向已 `claude login` 的 CONFIG_DIR)。
4. NapCat 正向 WS 指向本机;群内 @bot;`/admin` 看 WS 已连接、会话数增长;`/admin/sessions` 看 transcript 与日志。
5. 核对 spec「待冒烟核对项」:transcript JSONL 字段结构、settingSources 加载、projects slug 路径 —— 若与解析器假设不符,调 `lib/transcript.ts`。

## 待冒烟核对项(源自 spec)
- SDK transcript JSONL 真实字段(user/assistant/tool 块格式)。
- `settingSources: ["user"]` + `CLAUDE_CONFIG_DIR` 是否正确加载 settings.json。
- transcript 在 `CLAUDE_CONFIG_DIR/projects/` 下的真实 slug 路径规则。
