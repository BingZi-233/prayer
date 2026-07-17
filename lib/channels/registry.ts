import type { Channel, ChannelId, ChannelStatus } from "./types"
import { logger } from "../logger"

/**
 * 多通道生命周期注册表。
 * startAll 用 allSettled：单通道失败不回滚其它通道，失败记入 channel status。
 */
export class ChannelRegistry {
  private map = new Map<ChannelId, Channel>()

  register(ch: Channel): void {
    this.map.set(ch.id, ch)
  }

  get(id: ChannelId): Channel | undefined {
    return this.map.get(id)
  }

  async startAll(): Promise<PromiseSettledResult<void>[]> {
    const entries = [...this.map.values()]
    const results = await Promise.allSettled(entries.map((c) => c.start()))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "rejected") {
        const ch = entries[i]!
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        logger.log("error", `[registry] channel ${ch.id} start failed: ${msg}`)
        // 把错误挂到 channel 的 status 上（若实现支持 setLastError）
        const withErr = ch as Channel & { setLastError?: (e: string) => void }
        withErr.setLastError?.(msg)
      }
    }
    return results
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.map.values()].map((c) => c.stop()))
    this.map.clear()
  }

  status(): ChannelStatus[] {
    return [...this.map.values()].map((c) => c.status())
  }
}
