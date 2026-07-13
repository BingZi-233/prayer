import { bus } from "../bus";
import { logger } from "../logger";
import type { Agent } from "./agent";
import type { SessionStore } from "./session";
import type { QualifiedMessage } from "../events";
import { BLOCKED_INTENTS, BLOCKED_REPLY, INTENT_LABELS, type IntentClassifier } from "./intent";

export interface OrchestratorDeps {
  agent: Agent;
  store: SessionStore;
  // 前置意图门:命中「套取类」滥用则静默丢弃,不进 agent。缺省 → 不设门(向后兼容)
  classify?: IntentClassifier;
  /** @ 后先发 ACK。默认 true */
  ackEnabled?: boolean;
  ackText?: string;
}

const DEFAULT_ACK = "收到,正在查~";

export function registerOrchestrator(deps: OrchestratorDeps): () => void {
  const { agent, store, classify, ackEnabled = true, ackText = DEFAULT_ACK } = deps;
  // 每个 sessionKey 一条 Promise 链,保证串行
  const chains = new Map<string, Promise<void>>();

  async function handle(q: QualifiedMessage): Promise<void> {
    if (ackEnabled) {
      bus.emit("reply.ready", { groupId: q.groupId, text: ackText, replyToId: q.messageId });
      bus.emit("resolution.recorded", {
        kind: "ack",
        sessionKey: q.sessionKey,
        groupId: q.groupId,
        userId: q.userId,
      });
    }

    if (classify) {
      // 引用/转发正文一并送分类:注入常藏在被引/转发内容里
      const probe = [q.text, q.quoted, q.forwarded].filter(Boolean).join("\n");
      const intent = await classify(probe);
      if (BLOCKED_INTENTS.has(intent)) {
        // 拦截:不跑 agent,回模板婉拒。业务审计走 info,不占 error 通道
        logger.info(
          `blocked intent=${intent}(${INTENT_LABELS[intent]}) session=${q.sessionKey}`,
          {
            scope: "intent",
            groupId: q.groupId,
            sessionKey: q.sessionKey,
            code: "business.intent_block",
            category: "business",
            title: "意图拦截",
            hint: "用户触发滥用意图门,已回模板婉拒(非系统故障)。",
            retryable: false,
            skipClassify: true,
          }
        );
        bus.emit("reply.ready", { groupId: q.groupId, text: BLOCKED_REPLY, replyToId: q.messageId });
        bus.emit("resolution.recorded", {
          kind: "blocked",
          sessionKey: q.sessionKey,
          groupId: q.groupId,
          userId: q.userId,
          detail: intent,
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
    if (result.text) {
      bus.emit("reply.ready", { groupId: q.groupId, text: result.text, replyToId: q.messageId });
      bus.emit("resolution.recorded", {
        kind: "auto",
        sessionKey: q.sessionKey,
        groupId: q.groupId,
        userId: q.userId,
      });
    }
  }

  const onQualified = (q: QualifiedMessage) => {
    const prev = chains.get(q.sessionKey) ?? Promise.resolve();
    const next = prev.then(() => handle(q)).catch((err) => {
      bus.emit("error.occurred", { scope: "orchestrator", err, sessionKey: q.sessionKey });
      bus.emit("resolution.recorded", {
        kind: "error",
        sessionKey: q.sessionKey,
        groupId: q.groupId,
        userId: q.userId,
        detail: err instanceof Error ? err.message : String(err),
      });
    });
    chains.set(q.sessionKey, next);
  };

  bus.on("message.qualified", onQualified);
  return () => bus.off("message.qualified", onQualified);
}
