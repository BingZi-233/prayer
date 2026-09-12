import type { MigrationStep } from "./runner.ts"
import {
  migrateToVersion2,
  migrateToVersion3,
  migrateToVersion4,
  migrateToVersion5,
  migrateToVersion6,
  migrateToVersion7,
  migrateToVersion8,
  migrateToVersion9,
  repairVersion2,
} from "./schema.ts"

/**
 * 新迁移只追加到此表，版本号必须连续递增。
 * up 负责首次升级；repair 只做幂等结构补齐，不改变业务数据语义。
 */
export const MIGRATIONS: readonly MigrationStep[] = [
  {
    version: 2,
    name: "通道化会话与消息标识",
    up: (db, { dim }) => migrateToVersion2(db, dim),
    repair: (db, { dim }) => repairVersion2(db, dim),
  },
  {
    version: 3,
    name: "会话纪元与消息时间窗索引",
    up: migrateToVersion3,
    repair: migrateToVersion3,
  },
  {
    version: 4,
    name: "机器人提及标记",
    up: migrateToVersion4,
    repair: migrateToVersion4,
  },
  {
    version: 5,
    name: "工具调用统计",
    up: migrateToVersion5,
    repair: migrateToVersion5,
  },
  {
    version: 6,
    name: "查询索引与主题唯一化",
    up: migrateToVersion6,
    repair: migrateToVersion6,
  },
  {
    version: 7,
    name: "入站消息清理索引",
    up: migrateToVersion7,
    repair: migrateToVersion7,
  },
  {
    version: 8,
    name: "热点读取索引",
    up: migrateToVersion8,
    repair: migrateToVersion8,
  },
  { version: 9, name: "可靠出站与投递状态", up: migrateToVersion9, repair: migrateToVersion9 },
]

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0
