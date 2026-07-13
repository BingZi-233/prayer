import { bus } from "../bus";
import type { ErrorOccurred } from "../events";
import { logger } from "../logger";
import { classifyError, errorMessage, groupIdFromSession } from "../log-classify";

export interface ErrorHandlerDeps {
  /** 自定义记录;缺省走结构化 logger.error(不经 console,避免 ring 双记) */
  logger?: (scope: string, err: unknown) => void;
  /** 兜底文案;缺省引导「人工」+ 支持链接 */
  fallbackText?: string;
  supportUrl?: string;
}

export function defaultFallbackText(supportUrl?: string): string {
  const link = supportUrl ? ` 也可访问 ${supportUrl} 查看官网说明。` : "";
  return `系统繁忙,请稍后再试,或回复「人工」转接客服。${link}`.trim();
}

// 再导出,兼容旧测试/调用方
export { errorMessage, classifyError as explainErrorClassify } from "../log-classify";

/** @deprecated 用 classifyError;保留薄包装兼容旧测试 */
export function explainError(msg: string): string {
  const c = classifyError(msg);
  if (c.code === "unknown") return msg;
  return `【${c.title}】${c.hint} | 原始: ${msg}`;
}

/** @deprecated 结构化日志后由 logger 负责格式;保留兼容旧测试 */
export function formatErrorLine(e: {
  scope: string;
  err: unknown;
  sessionKey?: string;
  groupId?: number;
}): string {
  const raw = errorMessage(e.err);
  const c = classifyError(raw);
  const groupId = e.groupId ?? groupIdFromSession(e.sessionKey);
  const ctx: string[] = [];
  if (groupId != null) ctx.push(`群=${groupId}`);
  if (e.sessionKey) ctx.push(`session=${e.sessionKey}`);
  const head = ctx.length ? `[${e.scope}] (${ctx.join(" ")})` : `[${e.scope}]`;
  if (c.code === "unknown") return `${head} ${raw}`;
  return `${head} 【${c.title}】${c.hint} | 原始: ${raw}`;
}

function defaultLogError(scope: string, err: unknown, e: ErrorOccurred): void {
  const raw = errorMessage(err);
  const c = classifyError(raw);
  const groupId = e.groupId ?? groupIdFromSession(e.sessionKey);
  // unknown:msg 用 raw 首行,避免 ring/stdout 只剩「未分类错误」;已分类用 title
  const msg =
    c.code === "unknown" ? raw.split("\n")[0].slice(0, 300) : c.title;
  logger.error(msg, {
    scope,
    groupId,
    sessionKey: e.sessionKey,
    code: c.code,
    category: c.category,
    title: c.title,
    hint: c.hint,
    retryable: c.retryable,
    raw,
    skipClassify: true,
  });
}

export function registerErrorHandler(deps: ErrorHandlerDeps = {}): () => void {
  const text = deps.fallbackText ?? defaultFallbackText(deps.supportUrl);

  const onError = (e: ErrorOccurred) => {
    if (deps.logger) {
      // 自定义 logger 仍给整行人话,便于单测 spy
      deps.logger(e.scope, formatErrorLine(e));
    } else {
      defaultLogError(e.scope, e.err, e);
    }
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
