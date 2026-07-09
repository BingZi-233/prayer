import { bus } from "../bus";
import type { Repo } from "../db/repo";
import type { IncomingMessage } from "../events";

export interface MessageBufferDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  enabledGroups: number[];
}

// 旁路缓冲:每条用户群消息落 group_messages,供反思轮询回看。
// 排除管理群、bot 自己、空文本、非生效群;不做 @bot 过滤(反思要看全量对话上下文)。
export function registerMessageBuffer(deps: MessageBufferDeps): () => void {
  const { repo, botQQ, adminGroupId, enabledGroups } = deps;
  const enabled = new Set(enabledGroups);

  const onReceived = (msg: IncomingMessage) => {
    if (msg.groupId === adminGroupId) return;
    if (msg.userId === botQQ) return;
    if (!msg.rawText?.trim()) return;
    if (!enabled.has(msg.groupId)) return; // 生效群门:非生效群不缓冲
    try {
      repo.bufferGroupMessage(msg.groupId, msg.userId, msg.senderRole ?? null, msg.rawText, msg.messageId);
    } catch (err) {
      bus.emit("error.occurred", { scope: "message-buffer", err });
    }
  };

  bus.on("message.received", onReceived);
  return () => bus.off("message.received", onReceived);
}
