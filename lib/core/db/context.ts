import type Database from "better-sqlite3"

/** 同一 Repo 的领域仓储共用连接、预编译缓存和事务入口。 */
export class SqliteContext {
  private readonly statements = new Map<string, Database.Statement>()

  constructor(private readonly db: Database.Database) {}

  /**
   * 语句与连接绑定，只在当前上下文内缓存。
   * Row 描述 SQL 的返回列；此处只桥接驱动类型，不做运行时字段转换。
   */
  prepare<Row = unknown>(sql: string): Database.Statement<unknown[], Row> {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement as Database.Statement<unknown[], Row>
  }

  /**
   * 抛错时回滚；嵌套调用由 better-sqlite3 使用 SAVEPOINT 处理。
   * 回调只执行同步数据库操作，不能返回 Promise 或包含 await。
   * 该事务不覆盖文件写入、网络请求等外部副作用。
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
}
