import { EventEmitter } from "node:events"
import type { EventMap } from "./events"

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
