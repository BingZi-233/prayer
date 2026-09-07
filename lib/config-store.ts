import type { ConfigRepository } from "./db/repositories/config"
import { getGroupPolicy } from "./channels/enabled-chats"
import {
  appConfigSchema,
  isConfigRecord,
  type AppConfig,
} from "./config/schema"
import { seedFromEnv } from "./config/env"
import { migrateConfigShape } from "./config/migrate"
import {
  normalizeChatRefs,
  normalizeAdminSurface,
  excludeAdminSurface,
} from "./config/chats"

// 兼容既有导入路径；新模块可直接引用 config 下的纯函数与类型。
export type { AppConfig, GroupPolicy } from "./config/schema"
export { migrateConfigShape } from "./config/migrate"
export {
  parseQQList,
  parseChatIdList,
  enabledChatsFromLegacy,
  normalizeChatRefs,
  normalizeAdminSurface,
  excludeAdminSurface,
} from "./config/chats"

const KEY = "app"
/** 配置存储只依赖键值读写，便于替换数据库实现和隔离测试。 */
type ConfigStorage = Pick<ConfigRepository, "getConfigRow" | "setConfigRow">

export function getConfig(
  repo: ConfigStorage,
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const seed = seedFromEnv(env)
  const raw = repo.getConfigRow(KEY)
  if (!raw) {
    repo.setConfigRow(KEY, JSON.stringify(seed))
    return seed
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    repo.setConfigRow(KEY, JSON.stringify(seed))
    return seed
  }
  // JSON 合法不代表配置合法；null、数组和基本类型不能进入迁移逻辑。
  if (!isConfigRecord(parsed)) {
    repo.setConfigRow(KEY, JSON.stringify(seed))
    return seed
  }
  const { cfg, migrated } = migrateConfigShape(parsed, seed)
  if (migrated) {
    repo.setConfigRow(KEY, JSON.stringify(cfg))
  }
  return cfg
}

export function setConfig(
  repo: ConfigStorage,
  patch: Partial<AppConfig>
): AppConfig {
  const current = getConfig(repo)
  const next: AppConfig = { ...current }
  // undefined 表示未修改，不能把已保存的配置重置为 schema 默认值。
  Object.assign(
    next,
    Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    )
  )
  // 规范化 SOT 字段，避免脏数据落库
  if (patch.enabledChats !== undefined) {
    next.enabledChats = normalizeChatRefs(patch.enabledChats)
  }
  if (patch.adminSurface !== undefined) {
    next.adminSurface = normalizeAdminSurface(patch.adminSurface)
  }
  // 互斥不变式:管理群永不出现在生效会话里(改哪一侧都重算)
  next.enabledChats = excludeAdminSurface(next.enabledChats, next.adminSurface)
  // 所有内部写入也经过同一校验，避免绕过 HTTP 后留下不安全的周期值。
  const validated = appConfigSchema.parse(next)
  repo.setConfigRow(KEY, JSON.stringify(validated))
  return validated
}

/** 解析某群是否启用主动补位(群策略覆盖全局；QQ 群号) */
export function isProactiveEnabledForGroup(
  cfg: AppConfig,
  groupId: number
): boolean {
  const p = getGroupPolicy(cfg, "qq", String(groupId))
  if (p?.proactiveEnabled !== undefined) return p.proactiveEnabled
  return cfg.proactiveEnabled
}

/** 解析某群静默阈值 */
export function silenceMsForGroup(cfg: AppConfig, groupId: number): number {
  const p = getGroupPolicy(cfg, "qq", String(groupId))
  if (p?.proactiveSilenceMs !== undefined) return p.proactiveSilenceMs
  return cfg.proactiveSilenceMs
}
