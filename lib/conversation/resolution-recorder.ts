import { bus } from "../core/bus"
import type { Repo } from "../core/db/repo"
import type { ResolutionRecorded } from "../core/chat/events"

/** 把 resolution.recorded 事件落库,供看板统计 */
export function registerResolutionRecorder(repo: Repo): () => void {
  const onRec = (e: ResolutionRecorded) => {
    try {
      repo.insertResolution(e.kind, {
        sessionKey: e.sessionKey,
        channel: e.channel,
        chatId: e.chatId,
        userId: e.userId,
        detail: e.detail,
        deliveryKey: e.deliveryKey ?? e.resolutionKey,
        deliveryStatus: e.resolutionKey ? "pending" : "sent",
        deliveryExpected: e.deliveryExpected,
      })
    } catch (err) {
      console.error("[resolution]", err)
    }
  }
  bus.on("resolution.recorded", onRec)
  return () => bus.off("resolution.recorded", onRec)
}
