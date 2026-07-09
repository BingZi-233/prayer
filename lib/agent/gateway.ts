import { bus } from "../bus";
import type { Repo } from "../db/repo";
import type { IncomingMessage } from "../events";

export interface GatewayDeps {
  repo: Repo;
  botQQ: number;
  adminGroupId: number;
  enabledGroups: number[];
  /** 固定支持链接,办不了/人工时附带 */
  supportUrl?: string;
}

// 用户自助重置对话的关键词(整条消息精确匹配,避免误触)
const RESET_KEYWORDS = /^\s*(重新开始|重置对话|重置会话|重置|\/new|\/reset|\/clear)\s*$/i;

// 转人工关键词(整条消息)
const HANDOFF_KEYWORDS = /^\s*(人工|转人工|人工客服|转接人工|客服)\s*$/i;

// 用法说明
const HELP_KEYWORDS = /^\s*(帮助|怎么用|使用说明|\/help|help)\s*$/i;

function helpText(supportUrl?: string): string {
  const link = supportUrl ? `\n官网/工单:${supportUrl}` : "";
  return `用法说明:问我请 @我;重置对话发「重置」;需要人工发「人工」。${link}`;
}

export function registerGateway(deps: GatewayDeps): () => void {
  const { repo, botQQ, adminGroupId, enabledGroups, supportUrl } = deps;
  const enabled = new Set(enabledGroups);

  const onReceived = (msg: IncomingMessage) => {
    // 生效群门:非生效群且非管理群 → 完全忽略
    if (msg.groupId !== adminGroupId && !enabled.has(msg.groupId)) return;

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
      const mResume = msg.rawText.match(/^!resume\s+(\S+)/);
      if (mResume) {
        bus.emit("handoff.resumed", { sessionKey: mResume[1], by: "admin" });
        return;
      }
    }

    if (!msg.atList.includes(botQQ)) return; // 仅 @bot
    if (repo.seenMessage(msg.messageId)) return; // 去重
    const sessionKey = `${msg.groupId}:${msg.userId}`;
    if (!msg.rawText && !msg.images?.length) return; // 纯图消息也放行

    // human-mode:已转人工 → 丢弃(不抢答)
    if (repo.isHumanMode(sessionKey)) {
      // 允许用户在人工模式发「重置」清上下文,但不自动答
      if (RESET_KEYWORDS.test(msg.rawText)) {
        repo.clearResumeId(sessionKey);
        bus.emit("action.send", {
          action: "send_group_msg",
          groupId: msg.groupId,
          text: "已重置对话上下文。当前仍在人工接待中;管理恢复后我会再自动答。",
          replyToId: msg.messageId,
        });
      }
      return;
    }

    // 用户自助重置:清 resumeId,不转 Agent
    if (RESET_KEYWORDS.test(msg.rawText)) {
      repo.clearResumeId(sessionKey);
      bus.emit("action.send", {
        action: "send_group_msg",
        groupId: msg.groupId,
        text: "已重置对话,我们重新开始吧~",
        replyToId: msg.messageId,
      });
      bus.emit("resolution.recorded", { kind: "reset", sessionKey, groupId: msg.groupId, userId: msg.userId });
      return;
    }

    // 用法说明
    if (HELP_KEYWORDS.test(msg.rawText)) {
      bus.emit("action.send", {
        action: "send_group_msg",
        groupId: msg.groupId,
        text: helpText(supportUrl),
        replyToId: msg.messageId,
      });
      return;
    }

    // 转人工
    if (HANDOFF_KEYWORDS.test(msg.rawText)) {
      const lastQ = repo.listSessions().find((s) => s.key === sessionKey)?.lastQuestion ?? msg.rawText;
      bus.emit("handoff.requested", {
        sessionKey,
        groupId: msg.groupId,
        userId: msg.userId,
        lastQuestion: lastQ || "用户请求转人工",
        reason: "user",
      });
      return;
    }

    // 记录最近问题,供列表预览 / 转人工摘要
    if (msg.rawText.trim()) {
      repo.setLastQuestion(sessionKey, msg.rawText.trim());
    }

    bus.emit("message.qualified", {
      sessionKey,
      groupId: msg.groupId,
      userId: msg.userId,
      messageId: msg.messageId,
      text: msg.rawText,
      images: msg.images,
      quoted: msg.quoted,
      forwarded: msg.forwarded,
    });
  };

  bus.on("message.received", onReceived);
  return () => bus.off("message.received", onReceived);
}
