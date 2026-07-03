export interface IncomingMessage {
  groupId: number;
  userId: number;
  messageId: number;
  rawText: string;
  atList: number[]; // 被 @ 的 QQ 列表
}

export interface QualifiedMessage {
  sessionKey: string;
  groupId: number;
  userId: number;
  text: string;
}

export interface ReplyReady {
  groupId: number;
  text: string;
}

export interface ActionSend {
  action: "send_group_msg";
  groupId: number;
  text: string;
}

export interface HandoffRequested {
  sessionKey: string;
  groupId: number;
  userId: number;
  lastQuestion: string;
}

export interface HandoffResumed {
  sessionKey: string;
}

export interface ErrorOccurred {
  scope: string;
  err: unknown;
  sessionKey?: string;
}

export interface EventMap {
  "message.received": IncomingMessage;
  "message.qualified": QualifiedMessage;
  "reply.ready": ReplyReady;
  "action.send": ActionSend;
  "handoff.requested": HandoffRequested;
  "handoff.resumed": HandoffResumed;
  "error.occurred": ErrorOccurred;
}
