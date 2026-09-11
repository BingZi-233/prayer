import type Database from "better-sqlite3"

export type MigrationContext = Readonly<{ dim: number }>

export type MigrationStep = Readonly<{
  version: number
  name: string
  up: (db: Database.Database, context: MigrationContext) => void
  /** 已升级的数据库重开时执行，用于补齐早期版本留下的缺失结构。 */
  repair?: (db: Database.Database, context: MigrationContext) => void
}>

export function readUserVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true }) ?? 0)
}

function writeUserVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`)
}

function validatePlan(steps: readonly MigrationStep[]): void {
  let previous = 0
  for (const step of steps) {
    if (!Number.isInteger(step.version) || step.version <= previous) {
      throw new Error("数据库迁移版本必须为严格递增的正整数")
    }
    previous = step.version
  }
}

/**
 * 每个版本独立提交：迁移内容与 user_version 同处一个事务。
 * 某一步失败时，之前成功的版本保留，失败版本不会留下半成品。
 */
export function runMigrationPlan(
  db: Database.Database,
  steps: readonly MigrationStep[],
  context: MigrationContext,
  targetVersion = steps.at(-1)?.version ?? 0
): void {
  validatePlan(steps)
  let current = readUserVersion(db)
  const latest = steps.at(-1)?.version ?? 0

  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`数据库 user_version 非法：${current}`)
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new Error(`目标数据库版本非法：${targetVersion}`)
  }
  if (current > latest) {
    throw new Error(
      `数据库版本 ${current} 高于当前程序支持的版本 ${latest}，拒绝以旧程序打开`
    )
  }
  if (targetVersion > latest) {
    throw new Error(`目标数据库版本 ${targetVersion} 不在迁移注册表中`)
  }
  if (current > targetVersion) {
    throw new Error(`数据库不支持从版本 ${current} 降级到 ${targetVersion}`)
  }

  for (const step of steps) {
    if (step.version > targetVersion) break

    if (step.version <= current) {
      if (step.repair) db.transaction(() => step.repair?.(db, context))()
      continue
    }

    // 历史库没有 v1 标记，v2 迁移同时接收 user_version 0/1。
    const followsCurrent =
      step.version === current + 1 || (current === 0 && step.version === 2)
    if (!followsCurrent) {
      throw new Error(
        `数据库迁移缺少从版本 ${current} 到 ${step.version} 的连续步骤`
      )
    }

    db.transaction(() => {
      step.up(db, context)
      writeUserVersion(db, step.version)
    })()
    current = step.version
  }

  if (current !== targetVersion) {
    throw new Error(
      `数据库迁移停在版本 ${current}，目标版本为 ${targetVersion}`
    )
  }
}
