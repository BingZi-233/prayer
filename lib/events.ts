export interface ImageInput {
  data: string; // base64
  mediaType: string; // 如 image/jpeg
}

export interface IncomingMessage {
  groupId: number;
  userId: number;
  messageId: number;
  rawText: string;
  atList: number[]; // 被 @ 的 QQ 列表
  senderRole?: string; // OneBot 群角色:owner / admin / member(反思识别人工回复用)
  images?: ImageInput[]; // 顶层 + 引用/转发内嵌的图片(已下载 base64)
  quoted?: string; // 引用回复:被引消息的文本(get_msg 回查)
  forwarded?: string; // 合并转发:展开后的文本(get_forward_msg 回查)
}

export interface QualifiedMessage {
  sessionKey: string;
  groupId: number;
  userId: number;
  messageId: number; // 触发消息 id,回复时引用它(readers 分辨回谁)
  text: string;
  images?: ImageInput[];
  quoted?: string;
  forwarded?: string;
}

export interface ReplyReady {
  groupId: number;
  text: string;
  replyToId?: number; // 被引用消息 id;缺省 → 不引用(纯文本)
}

export interface ActionSend {
  action: "send_group_msg";
  groupId: number;
  text: string;
  replyToId?: number; // 被引用消息 id;缺省 → 纯文本发送
}

export interface ErrorOccurred {
  scope: string;
  err: unknown;
  sessionKey?: string;
  groupId?: number;
}

export interface HandoffRequested {
  sessionKey: string;
  groupId: number;
  userId: number;
  lastQuestion: string;
  // 触发来源:用户关键词 / 管理群命令 / 系统(错误兜底)
  reason?: "user" | "admin" | "system";
}

export interface HandoffResumed {
  sessionKey: string;
  // 谁恢复:超时 / 管理群 !resume / 后台关工单
  by?: "timeout" | "admin" | "ticket";
}

export type ResolutionKind =
  | "auto" // 主链路自动答复
  | "ack" // 即时 ACK(不计入解决率分母)
  | "blocked" // 意图拦截
  | "error" // 错误兜底
  | "proactive" // 主动补位
  | "proactive_silent" // 主动路径沉默
  | "handoff" // 转人工
  | "reset"; // 用户重置

export interface ResolutionRecorded {
  kind: ResolutionKind;
  sessionKey?: string;
  groupId?: number;
  userId?: number;
  detail?: string;
}

export interface EventMap {
  "message.received": IncomingMessage;
  "message.qualified": QualifiedMessage;
  "reply.ready": ReplyReady;
  "action.send": ActionSend;
  "error.occurred": ErrorOccurred;
  "handoff.requested": HandoffRequested;
  "handoff.resumed": HandoffResumed;
  "resolution.recorded": ResolutionRecorded;
}
