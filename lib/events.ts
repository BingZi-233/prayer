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

export interface EventMap {
  "message.received": IncomingMessage;
  "message.qualified": QualifiedMessage;
  "reply.ready": ReplyReady;
  "action.send": ActionSend;
  "error.occurred": ErrorOccurred;
}
