import type { ChannelId } from "@/lib/core/chat/types"

export type Tri = "inherit" | "on" | "off"

export interface GroupPolicy {
  proactiveEnabled?: boolean
  proactiveSilenceMs?: number
  notifyAdminOnHandoff?: boolean
}

export interface Row {
  channel: ChannelId
  chatId: string
  /** 兼容旧字段；勿作主键 */
  groupId: number
  /** 管理群：只跑管理命令，不可勾生效、无策略 */
  isAdmin?: boolean
  enabled: boolean
  messageCount: number
  lastTs: number
  cursor: number
  sedimentedCount: number
  policy: GroupPolicy
  hasOverride: boolean
  policyKey: string
  effective: {
    proactiveEnabled: boolean
    proactiveSilenceMs: number
    notifyAdminOnHandoff: boolean
  }
}

export interface Globals {
  proactiveEnabled: boolean
  proactiveSilenceMs: number
  notifyAdminOnHandoff: true
}

export interface ActivityData {
  groups: Row[]
  globals: Globals
}
