import { bus } from "../bus";
import type { Agent } from "./agent";
import type { SessionStore } from "./session";
import type { QualifiedMessage } from "../events";
import { BLOCKED_INTENTS, type IntentClassifier } from "./intent";

export interface OrchestratorDeps {
  agent: Agent;
  store: SessionStore;
  // 前置意图门:命中「套取类」滥用则静默丢弃,不进 agent。缺省 → 不设门(向后兼容)
  classify?: IntentClassifier;
}

export function registerOrchestrator(deps: OrchestratorDeps): () => void {
  const { agent, store, classify } = deps;
  // 每个 sessionKey 一条 Promise 链,保证串行
  const chains = new Map<string, Promise<void>>();

  async function handle(q: QualifiedMessage): Promise<void> {
    if (classify) {
      // 引用/转发正文一并送分类:注入常藏在被引/转发内容里
      const probe = [q.text, q.quoted, q.forwarded].filter(Boolean).join("\n");
      const intent = await classify(probe);
      if (BLOCKED_INTENTS.has(intent)) {
        // 静默:不跑 agent、不回复用户。记日志(不带 sessionKey → error-handler 不向用户发消息)
        bus.emit("error.occurred", {
          scope: "intent",
          err: `blocked intent=${intent} session=${q.sessionKey}`,
        });
        return;
      }
    }
    const resumeId = store.resumeId(q.sessionKey);
    const result = await agent.run(
      q.text,
      resumeId,
      {
        sessionKey: q.sessionKey,
        groupId: q.groupId,
        userId: q.userId,
      },
      { images: q.images, quoted: q.quoted, forwarded: q.forwarded }
    );
    if (result.sessionId) store.remember(q.sessionKey, result.sessionId);
    if (result.text) bus.emit("reply.ready", { groupId: q.groupId, text: result.text });
  }

  const onQualified = (q: QualifiedMessage) => {
    const prev = chains.get(q.sessionKey) ?? Promise.resolve();
    const next = prev.then(() => handle(q)).catch((err) => {
      bus.emit("error.occurred", { scope: "orchestrator", err, sessionKey: q.sessionKey });
    });
    chains.set(q.sessionKey, next);
  };

  bus.on("message.qualified", onQualified);
  return () => bus.off("message.qualified", onQualified);
}
