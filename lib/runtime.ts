import { resolve } from "path";
import { bus } from "./bus";
import { logger } from "./logger";
import type { AppConfig } from "./config-store";
import type { Repo } from "./db/repo";
import type { Agent } from "./agent/agent";
import type { AssembleDeps } from "./assemble";

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
  getGroupList?(): Promise<unknown[] | undefined>;
}

export interface RuntimeBuilders {
  openDb: (path: string) => unknown;
  makeRepo: (db: unknown) => Repo;
  makeAgent: (cfg: AppConfig, repo: Repo) => Agent;
  assemble: (args: AssembleDeps) => () => void;
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
    makeAgent: (cfg, repo) =>
      new Agent({
        model: cfg.model,
        systemPrompt: "",
        makeToolServer: (ctx) => buildToolServer(repo, ctx),
        // 本仓库 local plugin 目录(源码,非 cache),绝对化后交给 SDK 显式加载
        pluginPaths: [resolve(process.cwd(), "plugins/packyapi")],
      }),
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
  private db?: { close?: () => void };
  private teardown?: () => void;
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

  async getGroups(): Promise<unknown[] | undefined> {
    return this.client?.getGroupList?.();
  }

  start(cfg: AppConfig, builders: RuntimeBuilders): void {
    this.state = "starting";
    this.lastError = undefined;
    try {
      process.env.CLAUDE_CONFIG_DIR = cfg.claudeConfigDir;
      const db = builders.openDb(cfg.dbPath);
      const repo = builders.makeRepo(db);
      const agent = builders.makeAgent(cfg, repo);
      this.teardown = builders.assemble({
        repo,
        botQQ: cfg.botQQ,
        adminGroupId: cfg.adminGroupId,
        enabledGroups: cfg.enabledGroups,
        agent,
        reflectScanMs: cfg.reflectScanMs,
        reflectLookbackMs: cfg.reflectLookbackMs,
        reflectSettleMs: cfg.reflectSettleMs,
        reflectWindowMax: cfg.reflectWindowMax,
      });
      const client = builders.makeClient(cfg.onebotWsUrl, cfg.onebotAccessToken || undefined, (c) => {
        this.wsConnected = c;
      });
      client.start();
      this.repo = repo;
      this.db = db as { close?: () => void };
      this.client = client;
      this.bootedAt = Date.now();
      this.state = "running";
      logger.log("info", "[runtime] started");
    } catch (err) {
      // 回收可能已半装配的资源(定时器/监听器/DB 连接),避免失败 start 泄漏
      this.teardownAll();
      this.state = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.log("error", `[runtime] start failed: ${this.lastError}`);
    }
  }

  /** 卸载管线拥有的所有资源:teardown(监听器+定时器)、WS 客户端、DB 连接 */
  private teardownAll(): void {
    try {
      this.teardown?.();
    } catch (e) {
      logger.log("warn", `[runtime] teardown error: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      this.client?.stop();
    } catch {
      /* ignore */
    }
    try {
      this.db?.close?.();
    } catch {
      /* ignore */
    }
    bus.removeAllListeners(); // 兜底:清任何遗漏的监听器
    this.teardown = undefined;
    this.client = undefined;
    this.db = undefined;
    this.repo = undefined;
    this.wsConnected = false;
  }

  stop(): void {
    this.teardownAll();
    this.state = "stopped";
    logger.log("info", "[runtime] stopped");
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
