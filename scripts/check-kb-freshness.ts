import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { Repo } from "../lib/core/db/repo.ts"
import {
  canonicalDbPath,
  databaseOpenPath,
} from "../lib/core/db/path.ts"
import { checkKbFreshness } from "../lib/knowledge/kb-freshness.ts"

async function main(): Promise<void> {
  const [rootArg] = process.argv.slice(2)
  const root = rootArg ?? "docs/kb"
  const dbPath = canonicalDbPath(process.env.DB_PATH ?? "./data/agent.db")
  // Freshness is an audit only: do not run openDb(), which enables WAL and
  // migrations through a writable connection before the comparison starts.
  const db = new Database(databaseOpenPath(dbPath), {
    fileMustExist: true,
    readonly: true,
  })
  try {
    sqliteVec.load(db)
    const report = checkKbFreshness(new Repo(db), root)
    console.log(JSON.stringify(report, null, 2))
    if (report.status !== "PASS") process.exitCode = 1
  } finally {
    db.close()
  }
}

if (process.argv[1]?.endsWith("check-kb-freshness.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
