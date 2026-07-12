import { bus } from "../bus";
import type { ErrorOccurred } from "../events";

export interface ErrorHandlerDeps {
  logger?: (scope: string, err: unknown) => void;
  /** 兜底文案;缺省引导「人工」+ 支持链接 */
  fallbackText?: string;
  supportUrl?: string;
}

export function defaultFallbackText(supportUrl?: string): string {
  const link = supportUrl ? ` 也可访问 ${supportUrl} 查看官网说明。` : "";
  return `系统繁忙,请稍后再试,或回复「人工」转接客服。${link}`.trim();
}

/** 从 unknown 抽出错误文案 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * 对已知上游错误码补人话说明(日志/后台可见)。
 * 保留原始 message,方便对照上游原文。
 */
export function explainError(msg: string): string {
  // MiniMax 等:输入敏感(1026)。SDK 常误标为「server-side temporary」。
  if (/new_sensitive|\b1026\b|input\s+new_sensitive/i.test(msg)) {
    const img = /image is sensitive/i.test(msg);
    return (
      `【内容安全】输入被模型侧判定为敏感(input new_sensitive / 1026)` +
      (img ? "——含敏感图片" : "") +
      `。这不是临时服务故障,相同输入重试通常仍会失败;` +
      `反思路径下该群游标不会推进。` +
      ` | 原始: ${msg}`
    );
  }
  // 输出敏感(1027)
  if (/\b1027\b|output[_\s]?sensitive/i.test(msg)) {
    return `【内容安全】模型输出被判定敏感(1027)。 | 原始: ${msg}`;
  }
  return msg;
}

/** 组装一条带 scope / 群号 / 人话说明的错误日志行 */
export function formatErrorLine(e: {
  scope: string;
  err: unknown;
  sessionKey?: string;
  groupId?: number;
}): string {
  const fromSession = e.sessionKey ? Number(e.sessionKey.split(":")[0]) : NaN;
  const groupId =
    e.groupId != null && Number.isFinite(e.groupId)
      ? e.groupId
      : Number.isFinite(fromSession)
        ? fromSession
        : undefined;
  const ctx: string[] = [];
  if (groupId != null) ctx.push(`群=${groupId}`);
  if (e.sessionKey) ctx.push(`session=${e.sessionKey}`);
  const head = ctx.length ? `[${e.scope}] (${ctx.join(" ")})` : `[${e.scope}]`;
  return `${head} ${explainError(errorMessage(e.err))}`;
}

export function registerErrorHandler(deps: ErrorHandlerDeps = {}): () => void {
  // 默认打整行人话日志;自定义 logger 仍收到 (scope, 已格式化字符串)
  const logger = deps.logger ?? ((_scope, err) => console.error(err));
  const text = deps.fallbackText ?? defaultFallbackText(deps.supportUrl);

  const onError = (e: ErrorOccurred) => {
    logger(e.scope, formatErrorLine(e));
    // intent 拦截已自带回复,不再二次发消息
    if (e.scope === "intent") return;
    if (e.sessionKey) {
      const groupId = Number(e.sessionKey.split(":")[0]);
      if (!Number.isNaN(groupId)) {
        bus.emit("action.send", {
          action: "send_group_msg",
          groupId,
          text,
        });
      }
    }
  };

  bus.on("error.occurred", onError);
  return () => bus.off("error.occurred", onError);
}
