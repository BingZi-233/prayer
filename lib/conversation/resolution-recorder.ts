import { bus } from "../core/bus"
import type { Repo } from "../core/db/repo"
import type { ErrorOccurred, ResolutionRecorded } from "../core/chat/events"
import { errorMessage, redactSensitive } from "../core/log-context"
import { logger } from "../core/logger"

/** 把处理结果与 error.occurred 事件落库,供看板统计 */
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
      logger.error(
        `[resolution] 记录结果失败: ${err instanceof Error ? err.message : String(err)}`,
        {
          scope: "resolution.recorder",
          raw: err instanceof Error ? err.stack : String(err),
        }
      )
    }
  }

  // 错误统一从总线旁路记一条 resolution_events,避免各调用点漏记。
  // 后台错误与用户可见兜底分开计数:前者只做运维指标,不污染自动解决率。
  const onError = (e: ErrorOccurred) => {
    try {
      repo.insertResolution(
        e.userVisible === false ? "operational_error" : "error",
        {
          sessionKey: e.sessionKey,
          channel: e.channel,
          chatId: e.chatId,
          detail: redactSensitive(errorMessage(e.err)).slice(0, 300),
        }
      )
    } catch (err) {
      logger.error(
        `[resolution] 记录错误失败: ${err instanceof Error ? err.message : String(err)}`,
        {
          scope: "resolution.recorder",
          raw: err instanceof Error ? err.stack : String(err),
        }
      )
    }
  }

  bus.on("resolution.recorded", onRec)
  bus.on("error.occurred", onError)
  return () => {
    bus.off("resolution.recorded", onRec)
    bus.off("error.occurred", onError)
  }
}
