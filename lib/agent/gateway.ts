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
      const mResume = msg.rawText.match(/^!resume\s+(\S+)/);
      if (mResume) { bus.emit("handoff.resumed", { sessionKey: mResume[1] }); return; }
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

    // 人工接管期:群主/群管在用户群的发言视作人工答案,触发反思沉淀(不进 Agent)。
    // 放在 @bot 过滤之前,因为人工回复通常不 @bot。
    if (msg.senderRole === "owner" || msg.senderRole === "admin") {
      if (msg.userId !== botQQ && msg.rawText && !msg.rawText.startsWith("!")) {
        for (const s of repo.humanSessionsInGroup(msg.groupId)) {
          if (s.userId === msg.userId) continue;    // 排除用户本人恰是群主/群管
          bus.emit("handoff.humanReply", {
            sessionKey: s.key,
            question: repo.handoffQuestion(s.key) ?? "",
            answer: msg.rawText,
          });
        }
      }
    }

    if (!msg.atList.includes(botQQ)) return;        // 仅 @bot
    if (repo.seenMessage(msg.messageId)) return;    // 去重
    const sessionKey = `${msg.groupId}:${msg.userId}`;
    if (repo.isHumanMode(sessionKey)) return;       // 人工接管中
    if (!msg.rawText) return;

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
    });
  };

  bus.on("message.received", onReceived);
  return () => bus.off("message.received", onReceived);
}
