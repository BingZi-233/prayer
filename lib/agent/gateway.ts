import { bus } from "../bus";
import type { Repo } from "../db/repo";
import type { IncomingMessage } from "../events";

export interface GatewayDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
}

export function registerGateway(deps: GatewayDeps): () => void {
  const { repo, botQQ, adminGroupId } = deps;

  const onReceived = (msg: IncomingMessage) => {
    // 管理群命令优先
    if (msg.groupId === adminGroupId) {
      const m = msg.rawText.match(/^!resume\s+(\S+)/);
      if (m) { bus.emit("handoff.resumed", { sessionKey: m[1] }); return; }
    }

    if (!msg.atList.includes(botQQ)) return;        // 仅 @bot
    if (repo.seenMessage(msg.messageId)) return;    // 去重
    const sessionKey = `${msg.groupId}:${msg.userId}`;
    if (repo.isHumanMode(sessionKey)) return;       // 人工接管中
    if (!msg.rawText) return;

    bus.emit("message.qualified", {
      sessionKey,
      groupId: msg.groupId,
      userId: msg.userId,
      text: msg.rawText,
    });
  };

  bus.on("message.received", onReceived);
  return () => bus.off("message.received", onReceived);
}
