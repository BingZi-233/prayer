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
  getGroupMemberInfo?(groupId: number, userId: number): Promise<{ card?: string; nickname?: string } | undefined>;
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
  const { sharedDb } = await import("./db/shared");
  const { Repo } = await import("./db/repo");
  const { Agent } = await import("./agent/agent");
  const { assemble } = await import("./assemble");
  const { OneBotClient } = await import("./onebot/client");
  return {
    // 复用 API 路由的进程级共享连接:reconfigure 不关它,in-flight 的
    // 异步 scanOnce(await agent.run 期间)不会撞到 "database connection is not open"
    openDb: (p) => sharedDb(p),
    makeRepo: (db) => new Repo(db as never),
    makeAgent: (_cfg, _repo) =>
      new Agent({
        systemPrompt: "",
        // 不显式传 pluginPaths:插件(cs / packyapi)及其 MCP server 唯一由 CLAUDE_CONFIG_DIR/settings.json
        // 的 enabledPlugins(settingSources:["user"])加载,避免与显式 plugins 双加载/冲突。
        // web 插件管理器通过 claude plugin CLI 管理 enabledPlugins + cache。
        // 知识库检索由 cs 插件的 MCP server 承载,其子进程经 env DB_PATH(见 start)打开 DB。
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

  async getMemberInfo(groupId: number, userId: number): Promise<{ card?: string; nickname?: string } | undefined> {
    return this.client?.getGroupMemberInfo?.(groupId, userId);
  }

  start(cfg: AppConfig, builders: RuntimeBuilders): void {
    this.state = "starting";
    this.lastError = undefined;
    try {
      // 绝对化:CLI 子进程可能以不同 cwd 解析相对路径,绝对路径确保稳定命中配置目录
      process.env.CLAUDE_CONFIG_DIR = resolve(cfg.claudeConfigDir);
      // DB_PATH 供 cs 插件 MCP 子进程(plugins/cs/scripts/cs-mcp.ts)继承打开知识库(只读)
      process.env.DB_PATH = resolve(cfg.dbPath);
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
        reflectCompactMs: cfg.reflectCompactMs,
        reflectCompactMinEntries: cfg.reflectCompactMinEntries,
        proactiveEnabled: cfg.proactiveEnabled,
        proactiveScanMs: cfg.proactiveScanMs,
        proactiveSilenceMs: cfg.proactiveSilenceMs,
        proactiveMaxPerScan: cfg.proactiveMaxPerScan,
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
      // 回收可能已半装配的资源(定时器/监听器/DB 连接),避免失败 start 泄漏
      this.teardownAll();
      this.state = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.log("error", `[runtime] start failed: ${this.lastError}`);
    }
  }

  /** 卸载管线拥有的所有资源:teardown(监听器+定时器)、WS 客户端。
   *  DB 连接由 sharedDb 进程级缓存持有,不在此关闭:否则会切断 API 路由
   *  与仍在 await agent.run 的 in-flight scanOnce,触发 "database connection is not open"。 */
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
    bus.removeAllListeners(); // 兜底:清任何遗漏的监听器
    this.teardown = undefined;
    this.client = undefined;
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
