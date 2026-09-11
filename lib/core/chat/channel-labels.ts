import type { ChannelId } from "./types"

/**
 * 渠道的短显示名(徽标/状态栏用)。全仓唯一出处 —— 曾散在四处
 * (sessions / groups / channel-dot / header-status),且 discord 那条只有
 * groups 一处缺。
 *
 * 注意**不是**所有出现渠道名的地方都该用它:管理面通道的下拉选项是
 * **表单选项文案**(见 `components/admin/config/admin-settings.tsx`,那里 tg 写
 * 全称 "Telegram"、qq 仍写 "QQ"),与徽标用的短名是两个用途,不合并。
 */
const CHANNEL_LABELS: Record<ChannelId, string> = {
  qq: "QQ",
  tg: "TG",
  discord: "Discord",
}

/** 渠道显示名。ChannelId 闭合,查表必中;保留回退只为防御越界的运行时值。 */
export function channelLabel(channel: ChannelId): string {
  return CHANNEL_LABELS[channel] ?? channel.toUpperCase()
}
