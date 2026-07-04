import { bus } from "../bus";

export interface ErrorHandlerDeps {
  logger?: (scope: string, err: unknown) => void;
}

export function registerErrorHandler(deps: ErrorHandlerDeps = {}): () => void {
  const logger = deps.logger ?? ((scope, err) => console.error(`[${scope}]`, err));

  const onError = (e: { scope: string; err: unknown; sessionKey?: string }) => {
    logger(e.scope, e.err);
    if (e.sessionKey) {
      const groupId = Number(e.sessionKey.split(":")[0]);
      if (!Number.isNaN(groupId)) {
        bus.emit("action.send", {
          action: "send_group_msg",
          groupId,
          text: "系统繁忙,请稍后再试,或回复「人工」转接客服。",
        });
      }
    }
  };

  bus.on("error.occurred", onError);
  return () => bus.off("error.occurred", onError);
}
