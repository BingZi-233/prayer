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
