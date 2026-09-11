import type { ChannelId } from "./types"

/** 渠道的中文显示名。全仓唯一出处 —— 曾散在三处,且 discord 那条只在其中一处有。 */
const CHANNEL_LABELS: Record<ChannelId, string> = {
  qq: "QQ",
  tg: "TG",
  discord: "Discord",
}

/**
 * 渠道显示名;未知渠道回退成大写原值。
 * 入参放 string 是因为 sessionKeyParts().channel 是裸 string,而非闭合的 ChannelId。
 */
export function channelLabel(channel: ChannelId | string): string {
  return CHANNEL_LABELS[channel as ChannelId] ?? String(channel).toUpperCase()
}
