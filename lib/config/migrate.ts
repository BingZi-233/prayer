import type { ChatRef } from "../channels/types"
import { normalizeStoredConfig, type AppConfig } from "./schema"
import {
  normalizeChatRefs,
  normalizeAdminSurface,
  enabledChatsFromLegacy,
  excludeAdminSurface,
} from "./chats"

/** 磁盘 JSON 上可能残留的 legacy 字段（读路径 migrate 用，不进 AppConfig） */
type LegacyRaw = {
  adminGroupId?: unknown
  enabledGroups?: unknown
  telegramEnabledChats?: unknown
  adminSurface?: unknown
  enabledChats?: unknown
}

/**
 * 一次性迁移：legacy 双字段 → enabledChats / adminSurface，并剥掉旧键。
 * 返回是否需要写回磁盘。
 */
export function migrateConfigShape(
  raw: Record<string, unknown>,
  seed: AppConfig
): { cfg: AppConfig; migrated: boolean } {
  const legacy = raw as LegacyRaw
  let migrated = false

  let enabledChats: ChatRef[]
  if (Array.isArray(legacy.enabledChats)) {
    enabledChats = normalizeChatRefs(legacy.enabledChats)
  } else {
    const groups = Array.isArray(legacy.enabledGroups)
      ? (legacy.enabledGroups as unknown[])
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)
      : []
    const tg = Array.isArray(legacy.telegramEnabledChats)
      ? (legacy.telegramEnabledChats as unknown[]).map(String)
      : []
    enabledChats =
      "enabledGroups" in raw || "telegramEnabledChats" in raw
        ? enabledChatsFromLegacy(groups, tg)
        : seed.enabledChats
    // 仅当确有 legacy 键时才算迁移（避免空库每次写回）
    if ("enabledGroups" in raw || "telegramEnabledChats" in raw) {
      migrated = true
    }
  }

  let adminSurface: ChatRef | null
  if ("adminSurface" in raw) {
    adminSurface = normalizeAdminSurface(legacy.adminSurface)
  } else if ("adminGroupId" in raw) {
    const gid = Number(legacy.adminGroupId)
    adminSurface =
      Number.isFinite(gid) && gid > 0
        ? { channel: "qq", chatId: String(gid) }
        : null
    migrated = true
  } else {
    adminSurface = seed.adminSurface
  }

  // 剥掉 legacy 键 + 用规范化后的 SOT 覆盖
  const rest = { ...raw } as Record<string, unknown>
  if ("adminGroupId" in rest) {
    delete rest.adminGroupId
    migrated = true
  }
  if ("enabledGroups" in rest) {
    delete rest.enabledGroups
    migrated = true
  }
  if ("telegramEnabledChats" in rest) {
    delete rest.telegramEnabledChats
    migrated = true
  }

  const merged = normalizeStoredConfig(
    { ...rest, enabledChats, adminSurface },
    seed
  )
  // 再规范化一次，防止 rest 里脏 chat-ref
  merged.enabledChats = normalizeChatRefs(merged.enabledChats)
  merged.adminSurface = normalizeAdminSurface(merged.adminSurface)
  // 管理群若残留在白名单里 → 剔除并写回
  const withoutAdmin = excludeAdminSurface(
    merged.enabledChats,
    merged.adminSurface
  )
  if (withoutAdmin.length !== merged.enabledChats.length) {
    merged.enabledChats = withoutAdmin
    migrated = true
  }

  return { cfg: merged, migrated }
}
