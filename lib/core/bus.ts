import { EventEmitter } from "node:events"
import type { EventMap } from "./chat/events"
import { logger } from "./logger"

class TypedBus extends EventEmitter {
  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): boolean {
    return super.emit(type, payload)
  }
  on<K extends keyof EventMap>(
    type: K,
    handler: (payload: EventMap[K]) => void
  ): this {
    return super.on(type, handler)
  }
  off<K extends keyof EventMap>(
    type: K,
    handler: (payload: EventMap[K]) => void
  ): this {
    return super.off(type, handler)
  }
}

// 单例守卫:热重载不重复创建
const g = globalThis as unknown as { __prayerBus?: TypedBus }
export const bus: TypedBus = g.__prayerBus ?? (g.__prayerBus = new TypedBus())

/**
 * error.occurred 是旁路观测事件；监听器失败不能反向炸掉定时器/重连链。
 * 记录 observer 自身的故障，但继续吞掉日志故障，保证此 helper 不抛出。
 */
export function emitErrorSafely(event: EventMap["error.occurred"]): void {
  // EventEmitter.emit stops at the first throwing listener. Snapshot raw
  // wrappers so `.once` listeners still remove themselves when invoked.
  for (const listener of bus.rawListeners("error.occurred")) {
    try {
      Reflect.apply(listener, bus, [event])
    } catch (observerError) {
      try {
        logger.error(
          `[bus] error observer failed: ${
            observerError instanceof Error
              ? observerError.message
              : String(observerError)
          }`,
          { scope: "error.observer" }
        )
      } catch {
        // Logging is best effort; the safety boundary must never throw.
      }
    }
  }
}
