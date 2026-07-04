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
}

export interface RuntimeBuilders {
  openDb: (path: string) => unknown;
  makeRepo: (db: unknown) => Repo;
  makeAgent: (cfg: AppConfig, repo: Repo) => Agent;
  assemble: (args: AssembleDeps) => void;
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
        toolServer: buildToolServer(repo),
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
      const agent = builders.makeAgent(cfg, repo);
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
