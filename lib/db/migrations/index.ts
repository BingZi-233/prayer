import type Database from "better-sqlite3"
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "./registry.ts"
import { runMigrationPlan } from "./runner.ts"

export function migrateDatabase(
  db: Database.Database,
  dim: number,
  targetVersion = CURRENT_SCHEMA_VERSION
): void {
  runMigrationPlan(db, MIGRATIONS, { dim }, targetVersion)
}

export { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "./registry.ts"
export { readUserVersion, runMigrationPlan } from "./runner.ts"
export type { MigrationContext, MigrationStep } from "./runner.ts"
export {
  ensurePerfIndexes,
  ensureQuestionTopicUnique,
  ensureSeenMessagesCreatedIndex,
  migrateLegacySessionKeys,
} from "./schema.ts"
