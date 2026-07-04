import { bus } from "../bus";
import type { Repo } from "../db/repo";

export interface HandoffDeps {
  repo: Repo;
  adminGroupId: number;
  timeoutMin: number;
  scanMs?: number;
}

export function registerHandoffHandler(deps: HandoffDeps): () => void {
  const { repo, adminGroupId, timeoutMin, scanMs = 60000 } = deps;

  const onRequested = (e: { sessionKey: string; lastQuestion: string }) => {
    repo.setHumanMode(e.sessionKey, true);
    repo.setHandoffQuestion(e.sessionKey, e.lastQuestion); // 存问题,供人工回复后反思配对
    bus.emit("action.send", {
      action: "send_group_msg",
      groupId: adminGroupId,
      text: `【转人工】会话 ${e.sessionKey} 需人工介入。最后问题:${e.lastQuestion}\n回复 !resume ${e.sessionKey} 结束接管。`,
    });
  };

  const onResumed = (e: { sessionKey: string }) => {
    repo.setHumanMode(e.sessionKey, false);
  };

  bus.on("handoff.requested", onRequested);
  bus.on("handoff.resumed", onResumed);

  const timer = setInterval(() => {
    for (const key of repo.staleHumanSessions(timeoutMin)) {
      bus.emit("handoff.resumed", { sessionKey: key });
    }
  }, scanMs);

  return () => {
    bus.off("handoff.requested", onRequested);
    bus.off("handoff.resumed", onResumed);
    clearInterval(timer);
  };
}
