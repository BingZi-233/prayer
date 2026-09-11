import type { ChannelId } from "./types"

/**
 * 渠道的短显示名(徽标/状态栏用)。全仓唯一出处 —— 曾散在四处
 * (sessions / groups / channel-dot / header-status),且 discord 那条只有
 * groups 一处缺。
 *
 * 注意**不是**所有出现渠道名的地方都该用它:管理面通道的下拉选项用的是
 * 长名(见 `components/admin/config/admin-settings.tsx` 的 "Telegram"),
 * 与短名是两个用途,不合并。
 */
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
