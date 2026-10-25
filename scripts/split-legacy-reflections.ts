/**
 * 一次性拆分存量整理块(阶段 1;阶段 2 处置完 legacy 后连同
 * lib/knowledge/reflection/legacy-split.ts 一起删除)。
 *
 * 两步流程:
 *   1. pnpm kb:split-legacy-reflections
 *      dry-run:调模型生成拆分计划,写 <DB 所在目录>/split-legacy-<ts>.json(计划)与
 *      同名 .md(人工审阅报告),不改知识库;模型花费记入 usage_daily 的 legacy-split 站点。
 *   2. pnpm kb:split-legacy-reflections --apply data/split-legacy-<ts>.json
 *      只读回第 1 步的计划逐组替换,绝不调用模型;先自动备份数据库并打印备份路径。
 *      有任一组 refused / errored 时退出码非 0。
 *
 * 前置条件(任一不满足即非 0 退出,且不改库):
 *   - DB_PATH(默认 ./data/agent.db)指向已存在的数据库,且 schema 版本与当前代码一致
 *     (先 pnpm pm:restart 让应用完成迁移);
 *   - 应用配置 reflectPromoteMs 必须为 0(先在管理端停用自动升格);
 *   - 应用配置 claudeConfigDir 下必须有 settings.json——模型凭据只在那里,绝不回落 ~/.claude;
 *   - --apply 时计划的 legacyBefore 必须等于本脚本的 LEGACY_SPLIT_CUTOFF。
 *
 * 注意:
 *   - dry-run 与 apply 之间不要在管理端操作反思、不要跑 pnpm ingest。进程内锁不跨进程,
 *     只靠 apply 时的正文哈希 / 状态核对与 expectedStatus 乐观校验兜底,被改动的组会 refused。
 *   - apply 生成的备份要长期保留:这是撤销本次替换的唯一手段(reflect_compactions 里的
 *     审计记录没有向量、也没有反向工具,且 180 天后会被 retention 清除)。
 */
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { register } from "node:module"
import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
// 纯类型导入在擦除后不留运行时说明符,不受下方模块解析限制
import type { Repo as RepoType } from "../lib/core/db/repo.ts"
import type { SerializedSplitPlan } from "../lib/knowledge/reflection/legacy-split.ts"

/**
 * 存量整理块的截止时间(不含)。生产库里最后一批整理块的 ts 为 1792929187654,取其 + 1:
 * 只选它之前的块。拆分产物同为 chatId=0,固定截止保证重跑不会把新条目再拆一遍;
 * 不能用 Date.now(),否则 dry-run 之后新写入的 chatId=0 条目会被卷进来。
 */
const LEGACY_SPLIT_CUTOFF = 1792929187655

/** 与 lib/core/config/schema.ts 的 claudeConfigDir 默认值一致 */
const DEFAULT_CLAUDE_CONFIG_DIR = "./data/claude-config"

/**
 * Node 原生 TS 运行时垫片,与 scripts/prompt-replay.ts 相同:lib/** 用无扩展名相对导入,
 * `node --experimental-transform-types` 不做模块解析,这里为其补 `.ts` / `/index.ts`。
 */
const RESOLVE_HOOK = `
export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return nextResolve(specifier, context)
  }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    for (const candidate of [specifier + ".ts", specifier + "/index.ts"]) {
      try {
        return await nextResolve(candidate, context)
      } catch {}
    }
    throw error
  }
}
`
register(`data:text/javascript,${encodeURIComponent(RESOLVE_HOOK)}`)

// 钩子必须先于这些导入注册;模型相关模块要等 CLAUDE_CONFIG_DIR 设好后再导入(见 main)
const { canonicalDbPath, databaseOpenPath, filesystemDbPath } =
  await import("../lib/core/db/path.ts")
const { CURRENT_SCHEMA_VERSION, readUserVersion } =
  await import("../lib/core/db/migrations/index.ts")
const { Repo } = await import("../lib/core/db/repo.ts")

type Mode = { apply: false } | { apply: true; planPath: string }

function parseArgs(args: string[]): Mode {
  if (!args.length) return { apply: false }
  if (args[0] === "--apply" && args.length === 2 && !args[1].startsWith("--"))
    return { apply: true, planPath: resolve(args[1]) }
  throw new Error(
    "用法:pnpm kb:split-legacy-reflections            # dry-run,生成计划与报告\n" +
      "      pnpm kb:split-legacy-reflections --apply <计划.json>"
  )
}

/** 只读检查数据库与应用配置;不跑 openDb(它会迁移/建库),全部通过才返回。 */
function preflight(dbPath: string): { claudeConfigDir: string } {
  const file = filesystemDbPath(dbPath)
  if (!file) throw new Error(`DB_PATH 必须是本机数据库文件:${dbPath}`)
  if (!existsSync(file)) throw new Error(`数据库不存在:${file}`)
  const db = new Database(databaseOpenPath(dbPath), {
    fileMustExist: true,
    readonly: true,
  })
  try {
    sqliteVec.load(db)
    const version = readUserVersion(db)
    if (version !== CURRENT_SCHEMA_VERSION)
      throw new Error(
        `数据库 schema 版本为 ${version},当前代码为 ${CURRENT_SCHEMA_VERSION};先部署并重启应用完成迁移`
      )
    const raw = new Repo(db).getConfigRow("app")
    const cfg = (raw ? JSON.parse(raw) : {}) as {
      reflectPromoteMs?: unknown
      claudeConfigDir?: unknown
    }
    if (cfg.reflectPromoteMs !== 0)
      throw new Error(
        `应用配置 reflectPromoteMs 必须为 0(当前 ${String(cfg.reflectPromoteMs ?? "未设置,默认非 0")});先在管理端停用自动升格`
      )
    const dir =
      typeof cfg.claudeConfigDir === "string" && cfg.claudeConfigDir.trim()
        ? cfg.claudeConfigDir
        : DEFAULT_CLAUDE_CONFIG_DIR
    // 与 lib/runtime.ts 相同:按 cwd 绝对化
    const claudeConfigDir = resolve(dir)
    if (!existsSync(join(claudeConfigDir, "settings.json")))
      throw new Error(
        `找不到 ${join(claudeConfigDir, "settings.json")}(claudeConfigDir);拒绝回落 ~/.claude`
      )
    return { claudeConfigDir }
  } finally {
    db.close()
  }
}

/**
 * 仅测试用:NODE_ENV=test 且 PRAYER_SPLIT_FAKE_EMBED=1 时用确定性假嵌入,
 * 让 spawn 冒烟测试不必加载本地嵌入模型。其它环境一律忽略该变量。
 */
async function resolveEmbed(
  dim: number
): Promise<(text: string) => Promise<Float32Array>> {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.PRAYER_SPLIT_FAKE_EMBED === "1"
  ) {
    return async (text) => {
      const v = new Float32Array(dim)
      for (let i = 0; i < text.length; i++)
        v[i % dim] += (text.charCodeAt(i) % 97) + 1
      const norm = Math.hypot(...v) || 1
      return v.map((x) => x / norm)
    }
  }
  return (await import("../lib/model/embed.ts")).embed
}

async function main(): Promise<void> {
  const mode = parseArgs(process.argv.slice(2))
  const dbPath = canonicalDbPath(process.env.DB_PATH ?? "./data/agent.db")
  const { loadSplitPlan } =
    await import("../lib/knowledge/reflection/legacy-split.ts")

  // --apply:先校验计划文件,不合法就不碰数据库
  let plan: SerializedSplitPlan | null = null
  if (mode.apply) {
    plan = loadSplitPlan(await readFile(mode.planPath, "utf8"))
    if (plan.legacyBefore !== LEGACY_SPLIT_CUTOFF)
      throw new Error(
        `计划的 legacyBefore=${plan.legacyBefore} 与脚本截止 ${LEGACY_SPLIT_CUTOFF} 不一致,拒绝执行`
      )
  }

  const { claudeConfigDir } = preflight(dbPath)
  // 必须在导入模型模块之前设置:query-options 按它读模型与凭据
  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir

  const { openDb, DIM } = await import("../lib/core/db/index.ts")
  const db = openDb(dbPath)
  try {
    const repo = new Repo(db)
    const embed = await resolveEmbed(DIM)
    if (plan) await runApply(db, repo, dbPath, plan, embed)
    else await runDryRun(repo, dbPath, embed)
  } finally {
    // 用量经 bindUsagePersistence 同步写入 usage_daily,关库前无需额外 flush
    db.close()
  }
}

async function runDryRun(
  repo: RepoType,
  dbPath: string,
  embed: (text: string) => Promise<Float32Array>
): Promise<void> {
  const { bindUsagePersistence } = await import("../lib/model/stats/usage.ts")
  const { DEFAULT_QUERY_TIMEOUT_MS } = await import("../lib/model/timeout.ts")
  const { planLegacySplit, serializeSplitPlan, renderSplitReport } =
    await import("../lib/knowledge/reflection/legacy-split.ts")

  const unbind = bindUsagePersistence(repo)
  try {
    const plans = await planLegacySplit({
      repo,
      embed,
      queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS,
      legacyBefore: LEGACY_SPLIT_CUTOFF,
    })
    const createdAt = Date.now()
    const serialized = serializeSplitPlan(plans, {
      legacyBefore: LEGACY_SPLIT_CUTOFF,
      createdAt,
    })
    // 与数据库同目录(生产即 data/),计划与报告共用同一时间戳
    const base = join(
      dirname(filesystemDbPath(dbPath)!),
      `split-legacy-${createdAt}`
    )
    await writeFile(`${base}.json`, JSON.stringify(serialized, null, 2), {
      flag: "wx",
    })
    await writeFile(`${base}.md`, renderSplitReport(serialized), { flag: "wx" })
    const counts = new Map<string, number>()
    for (const g of serialized.groups)
      counts.set(g.status, (counts.get(g.status) ?? 0) + 1)
    console.log(`计划:${base}.json`)
    console.log(`报告:${base}.md`)
    console.log(
      `组数 ${serialized.groups.length}:` +
        [...counts].map(([s, n]) => `${s} ${n}`).join(" / ")
    )
    console.log(
      `审阅报告无误后执行:pnpm kb:split-legacy-reflections --apply ${base}.json`
    )
  } finally {
    unbind()
  }
}

async function runApply(
  db: Database.Database,
  repo: RepoType,
  dbPath: string,
  plan: SerializedSplitPlan,
  embed: (text: string) => Promise<Float32Array>
): Promise<void> {
  const { backupDatabase } = await import("../lib/core/db/backup.ts")
  const { defaultBackupPath } = await import("./db-maintenance.ts")
  const { applyLegacySplit } =
    await import("../lib/knowledge/reflection/legacy-split.ts")

  const backup = await backupDatabase(db, defaultBackupPath(dbPath))
  console.log(`已备份:${backup.path}(请长期保留,这是撤销本次替换的唯一手段)`)

  const r = await applyLegacySplit(repo, plan, { embed, now: () => Date.now() })
  console.log(`替换 ${r.replaced} 组,拒绝 ${r.refused} 组,出错 ${r.errored} 组`)
  for (const d of r.details)
    console.log(
      `- [${d.outcome}] 旧块 ${d.chunkIds.join(",")}${d.reason ? `:${d.reason}` : ""}`
    )
  if (r.refused || r.errored) {
    console.error("有组未替换(见上);核对原因后可用新的 dry-run 计划重跑")
    process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
