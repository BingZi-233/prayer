import { bus } from "../bus";
import type { Repo } from "../db/repo";
import type { IncomingMessage } from "../events";

export interface GatewayDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
}

// 用户自助重置对话的关键词(整条消息精确匹配,避免误触)
const RESET_KEYWORDS = /^\s*(重新开始|重置对话|重置会话|重置|\/new|\/reset|\/clear)\s*$/i;

export function registerGateway(deps: GatewayDeps): () => void {
  const { repo, botQQ, adminGroupId } = deps;

  const onReceived = (msg: IncomingMessage) => {
    // 管理群命令优先
    if (msg.groupId === adminGroupId) {
      const mReset = msg.rawText.match(/^!reset\s+(\S+)/);
      if (mReset) {
        repo.clearResumeId(mReset[1]);
        bus.emit("action.send", {
          action: "send_group_msg",
          groupId: adminGroupId,
          text: `已重置会话 ${mReset[1]} 的对话上下文。`,
        });
        return;
      }
    }

    if (!msg.atList.includes(botQQ)) return;        // 仅 @bot
    if (repo.seenMessage(msg.messageId)) return;    // 去重
    const sessionKey = `${msg.groupId}:${msg.userId}`;
    if (!msg.rawText && !msg.images?.length) return; // 纯图消息也放行

    // 用户自助重置:清 resumeId,不转 Agent
    if (RESET_KEYWORDS.test(msg.rawText)) {
      repo.clearResumeId(sessionKey);
      bus.emit("action.send", {
        action: "send_group_msg",
        groupId: msg.groupId,
        text: "已重置对话,我们重新开始吧~",
      });
      return;
    }

    bus.emit("message.qualified", {
      sessionKey,
      groupId: msg.groupId,
      userId: msg.userId,
      text: msg.rawText,
      images: msg.images,
      quoted: msg.quoted,
      forwarded: msg.forwarded,
    });
  };

  bus.on("message.received", onReceived);
  return () => bus.off("message.received", onReceived);
}
