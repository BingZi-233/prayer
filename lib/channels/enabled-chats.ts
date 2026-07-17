import type { ChannelId } from "./types"
import type { AppConfig, GroupPolicy } from "../config-store"

/** policy / 游标 key：`${channel}:${chatId}` */
export function policyKey(channel: ChannelId, chatId: string): string {
  return `${channel}:${chatId}`
}

/** 汇总各通道已生效会话（QQ 群 + TG chat） */
export function listEnabledChats(
  cfg: AppConfig
): { channel: ChannelId; chatId: string }[] {
  const out: { channel: ChannelId; chatId: string }[] = []
  for (const gid of cfg.enabledGroups) {
    out.push({ channel: "qq", chatId: String(gid) })
  }
  for (const chatId of cfg.telegramEnabledChats) {
    out.push({ channel: "tg", chatId })
  }
  return out
}

/** 某通道会话是否在白名单 */
export function isChatEnabled(
  cfg: AppConfig,
  channel: ChannelId,
  chatId: string
): boolean {
  if (channel === "qq") {
    return cfg.enabledGroups.some((g) => String(g) === chatId)
  }
  if (channel === "tg") {
    return cfg.telegramEnabledChats.includes(chatId)
  }
  return false
}

/**
 * 读群/会话策略：优先 `channel:chatId`，
 * QQ 兼容旧库裸 chatId（群号字符串）键。
 */
export function getGroupPolicy(
  cfg: AppConfig,
  channel: ChannelId,
  chatId: string
): GroupPolicy | undefined {
  const keyed = cfg.groupPolicies[policyKey(channel, chatId)]
  if (keyed !== undefined) return keyed
  if (channel === "qq") return cfg.groupPolicies[chatId]
  return undefined
}
