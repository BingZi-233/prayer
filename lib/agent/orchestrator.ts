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
