import { bus } from "../bus";
import type { Repo } from "../db/repo";
import type { ResolutionRecorded } from "../events";

/** 把 resolution.recorded 事件落库,供看板统计 */
export function registerResolutionRecorder(repo: Repo): () => void {
  const onRec = (e: ResolutionRecorded) => {
    try {
      repo.insertResolution(e.kind, {
        sessionKey: e.sessionKey,
        groupId: e.groupId,
        userId: e.userId,
        detail: e.detail,
      });
    } catch (err) {
      console.error("[resolution]", err);
    }
  };
  bus.on("resolution.recorded", onRec);
  return () => bus.off("resolution.recorded", onRec);
}
