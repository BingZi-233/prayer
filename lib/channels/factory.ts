import type { AppConfig } from "../core/config-store"
import type { Repo } from "../core/db/repo"
import type { Channel, ChannelId } from "./types"
import { QqChannel } from "./qq"
import { TelegramChannel } from "./tg/client"

/**
 * 通道工厂上下文：配置 + 可选依赖注入（offset 持久化、状态回调、测试替身）。
 */
export interface ChannelFactoryContext {
  cfg: AppConfig
  repo: Repo
  /** 各通道 connected 回调（qq → runtime.wsConnected 等） */
  onStatus?: Partial<Record<ChannelId, (connected: boolean) => void>>
  /**
   * 单测 / RuntimeBuilders 覆盖：按 id 替换默认构造。
   * 返回 null = 该通道不注册（与「配置缺失」同语义）。
   */
  overrides?: Partial<
    Record<ChannelId, (ctx: ChannelFactoryContext) => Channel | null>
  >
}

export interface ChannelFactoryEntry {
  id: ChannelId
  /**
   * 根据配置决定是否创建通道。
   * null = 本通道未配置 / 不启用，不 register。
   */
  create: (ctx: ChannelFactoryContext) => Channel | null
}

/** 默认工厂表：加通道 = 加一行 + 实现 adapter */
export const DEFAULT_CHANNEL_FACTORIES: ChannelFactoryEntry[] = [
  {
    id: "qq",
    create(ctx) {
      if (ctx.overrides?.qq) return ctx.overrides.qq(ctx)
      const url = ctx.cfg.onebotWsUrl?.trim()
      if (!url) return null
      return new QqChannel(
        url,
        ctx.cfg.onebotAccessToken || undefined,
        ctx.onStatus?.qq
      )
    },
  },
  {
    id: "tg",
    create(ctx) {
      if (ctx.overrides?.tg) return ctx.overrides.tg(ctx)
      const token = ctx.cfg.telegramBotToken?.trim()
      if (!token) return null
      const { repo } = ctx
      return new TelegramChannel(token, {
        getOffset: () => Number(repo.getConfigRow("tg:update_offset") ?? "0"),
        setOffset: (n) => repo.setConfigRow("tg:update_offset", String(n)),
        onStatus: ctx.onStatus?.tg,
      })
    },
  },
  // discord: 类型预留，无 factory 实现（二期）
]

/**
 * 按工厂表创建已配置通道列表。
 * 顺序稳定；仅返回非 null 的 Channel。
 */
export function createChannels(
  ctx: ChannelFactoryContext,
  factories: ChannelFactoryEntry[] = DEFAULT_CHANNEL_FACTORIES
): Channel[] {
  const out: Channel[] = []
  for (const entry of factories) {
    try {
      const ch = entry.create(ctx)
      if (ch) out.push(ch)
    } catch (err) {
      // 构造失败向上抛，由 runtime start 捕获并 teardown
      throw err
    }
  }
  return out
}
