import type { ChannelId, ChatRef } from "./types"
import type { AppConfig, GroupPolicy } from "../config-store"

export type { ChatRef }

/** policy / 游标 key：`${channel}:${chatId}` */
export function policyKey(channel: ChannelId, chatId: string): string {
  return `${channel}:${chatId}`
}

/** 生效会话配置源（仅 chat-ref 列表） */
export interface EnablementConfig {
  enabledChats?: ChatRef[]
}

/**
 * 汇总已生效会话。
 * 缺省 / 非数组 → []。
 */
export function listEnabledChats(cfg: EnablementConfig): ChatRef[] {
  return Array.isArray(cfg.enabledChats) ? cfg.enabledChats : []
}

/** 某通道会话是否在白名单 */
export function isChatEnabled(
  cfg: EnablementConfig,
  channel: ChannelId,
  chatId: string
): boolean {
  const list = listEnabledChats(cfg)
  return list.some((c) => c.channel === channel && c.chatId === chatId)
}

/**
 * 解析管理侧通知面（admin surface）。
 * - 显式 `adminSurface`（含 null）直接用
 * - 否则 null
 */
export function resolveAdminSurface(cfg: {
  adminSurface?: ChatRef | null
}): ChatRef | null {
  if (cfg.adminSurface === undefined) return null
  return cfg.adminSurface
}

/** 是否为配置的管理面会话（管理命令 / 跳过缓冲） */
export function isAdminSurface(
  surface: ChatRef | null | undefined,
  channel: ChannelId,
  chatId: string
): boolean {
  return !!surface && surface.channel === channel && surface.chatId === chatId
}

/**
 * 读群/会话策略：优先 `channel:chatId`，
 * QQ 兼容旧库裸 chatId（群号字符串）键。
 */
export function getGroupPolicy(
  cfg:
    | Pick<AppConfig, "groupPolicies">
    | { groupPolicies: Record<string, GroupPolicy> },
  channel: ChannelId,
  chatId: string
): GroupPolicy | undefined {
  const policies = cfg.groupPolicies
  const keyed = policies[policyKey(channel, chatId)]
  if (keyed !== undefined) return keyed
  // legacy：仅 QQ 裸群号键
  if (channel === "qq") return policies[chatId]
  return undefined
}

/** 从完整 AppConfig 一次解析 agent 装配用的生效会话 + 管理面 */
export function resolveRuntimeChatConfig(cfg: AppConfig): {
  enabledChats: ChatRef[]
  adminSurface: ChatRef | null
} {
  return {
    enabledChats: listEnabledChats(cfg),
    adminSurface: resolveAdminSurface(cfg),
  }
}
