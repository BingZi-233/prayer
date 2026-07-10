import { bus } from "../bus";

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

export function registerErrorHandler(deps: ErrorHandlerDeps = {}): () => void {
  const logger = deps.logger ?? ((scope, err) => console.error(`[${scope}]`, err));
  const text = deps.fallbackText ?? defaultFallbackText(deps.supportUrl);

  const onError = (e: { scope: string; err: unknown; sessionKey?: string }) => {
    logger(e.scope, e.err);
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
