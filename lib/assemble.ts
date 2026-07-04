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
