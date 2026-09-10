import type { SqliteContext } from "../context.ts"

/** 配置键值存储；游标沿用原有键名，保持旧库兼容。 */
export class ConfigRepository {
  constructor(private readonly sql: SqliteContext) {}

  getConfigRow(key: string): string | undefined {
    const row = this.sql
      .prepare<{ value: string }>("SELECT value FROM config WHERE key = ?")
      .get(key)
    return row?.value
  }

  setConfigRow(key: string, value: string): void {
    this.sql
      .prepare(
        `INSERT INTO config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch('subsec')*1000`
      )
      .run(key, value)
  }
}
