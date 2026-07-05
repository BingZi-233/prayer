import type { Repo } from "./db/repo";
import type { Agent } from "./agent/agent";
import { SessionStore } from "./agent/session";
import { registerGateway } from "./agent/gateway";
import { registerOrchestrator } from "./agent/orchestrator";
import { makeIntentClassifier } from "./agent/intent";
import { registerReplyMapper } from "./agent/reply-mapper";
import { registerMessageBuffer } from "./agent/message-buffer";
import { registerReflectionPoller } from "./agent/reflection-poller";
import { registerErrorHandler } from "./agent/error-handler";

export interface AssembleDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  enabledGroups: number[];
  agent: Agent;
  reflectScanMs?: number;
  reflectLookbackMs?: number;
  reflectSettleMs?: number;
  reflectWindowMax?: number;
  // 会话空闲超时(ms):超时则下条消息开全新对话,不 resume 旧会话。缺省 5 分钟
  resumeTtlMs?: number;
}

// 会话空闲 TTL 默认值:5 分钟无活动 → 新开对话
const DEFAULT_RESUME_TTL_MS = 300_000;

/** 装配全链路,返回 teardown 用于热重载时卸载监听器与定时器 */
export function assemble(deps: AssembleDeps): () => void {
  const { repo, botQQ, adminGroupId, enabledGroups, agent } = deps;
  const cleanups = [
    registerErrorHandler(),
    registerGateway({ repo, botQQ, adminGroupId, enabledGroups }),
    registerOrchestrator({
      agent,
      store: new SessionStore(repo, deps.resumeTtlMs ?? DEFAULT_RESUME_TTL_MS),
      classify: makeIntentClassifier(),
    }),
    registerReplyMapper(),
    registerMessageBuffer({ repo, botQQ, adminGroupId, enabledGroups }),
    registerReflectionPoller({
      repo,
      adminGroupId,
      enabledGroups,
      scanMs: deps.reflectScanMs,
      lookbackMs: deps.reflectLookbackMs,
      settleMs: deps.reflectSettleMs,
      windowMax: deps.reflectWindowMax,
    }),
  ];
  return () => cleanups.forEach((c) => c());
}
