/**
 * system prompt 离线回放:同一批历史问题 × 多个 prompt 变体,产出对比报告。
 *
 * dev-only 工具,不进运行时。只读 DB(不写库)、不落任何凭据。
 *
 * 为什么需要沙箱 CLAUDE_CONFIG_DIR:
 *   生产 config 目录里有 caveman SessionStart hook 与 codegraph UserPromptSubmit hook,
 *   会给会话注入风格规则与仓库源码,污染对比结果。沙箱只保留 extraKnownMarketplaces
 *   与 packyapi/cs 两个业务插件,去掉全部 hooks;凭据只经 Options.env 进程内传递。
 *
 * 用法:
 *   pnpm prompt:replay --limit 3 --variants old,clite          # 冒烟
 *   pnpm prompt:replay --limit 20 --variants old,clite,a       # 正式对比
 *   pnpm prompt:replay --variants clite --dry-run              # 只打印渲染后的正文
 *
 * 变体文本默认取自 scripts/fixtures/prompt-replay/(已跟踪,见该目录 README);
 * 换用别处的文本目录传 --variants-dir <path>。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { register } from "node:module"
import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { query as sdkQuery, type Options } from "@anthropic-ai/claude-agent-sdk"
// 纯类型导入在擦除后不留运行时说明符,不受下方模块解析限制
import type { AssistantTextState } from "../lib/model/final-text.ts"
import type { Repo } from "../lib/core/db/repo.ts"

/**
 * Node 原生 TS 运行时垫片。
 *
 * 本仓库 tsconfig 用 moduleResolution: "bundler",lib/** 内部大量使用无扩展名相对
 * 导入(如 `../core/brand`、`./prompt`)。`node --experimental-transform-types` 只做
 * 类型擦除、不做模块解析,这些说明符会直接 ERR_MODULE_NOT_FOUND。这里注册一个
 * resolve 钩子为无扩展名相对说明符补 `.ts` / `/index.ts`,让本脚本能以单文件跑在
 * 原生 Node 上,不额外引入 tsx / ts-node 依赖。
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

// 钩子必须先于这些导入注册,故一律用动态导入(静态导入会在钩子生效前解析)
const { resolveBrand } = await import("../lib/core/brand.ts")
const { databaseOpenPath } = await import("../lib/core/db/path.ts")
const { Repo: RepoClass } = await import("../lib/core/db/repo.ts")
const { embed } = await import("../lib/model/embed.ts")
const { sdkEnv } = await import("../lib/model/sdk-env.ts")
const { buildDefaultSystem } = await import("../lib/model/system-prompt.ts")
const { agentQueryOptions } = await import("../lib/model/query-options.ts")
const {
  buildPrompt,
  KB_CANDIDATES_BEGIN,
  KB_CANDIDATES_END,
  USER_MESSAGE_BEGIN,
  USER_MESSAGE_END,
} = await import("../lib/model/prompt.ts")
const { formatKbBlock, DEFAULT_KB_PREFETCH_MAX_DISTANCE } =
  await import("../lib/knowledge/kb-prefetch.ts")
const { consumeAssistantContent, finalAssistantText } =
  await import("../lib/model/final-text.ts")
const { isToolAllowed, denyMessage } =
  await import("../lib/model/tool-policy.ts")

const PROD_CONFIG_DIR = resolve("./data/claude-config")
const ARTIFACT_DIR = resolve(".kb-artifacts/prompt-replay")
const SANDBOX_CONFIG_DIR = join(ARTIFACT_DIR, "claude-config")
/**
 * 历史/对照变体文本的默认目录。已跟踪的 fixture(见该目录 README),不是 .kb-artifacts
 * 里的临时产物 —— 基准文本必须随仓库走,否则回放报告无法复现。
 */
const DEFAULT_VARIANTS_DIR = resolve("scripts/fixtures/prompt-replay")
/** 允许回放的插件:只用业务插件,排除 caveman 等风格插件 */
const KEEP_PLUGINS = ["packyapi@prayer-local", "cs@prayer-local"]
const RUN_TIMEOUT_MS = 120_000
/** 与生产预检索同源的距离阈值(sqlite-vec L2,越小越近) */
const KB_MAX_DISTANCE = DEFAULT_KB_PREFETCH_MAX_DISTANCE

interface Args {
  limit: number
  variants: string[]
  variantsDir: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    limit: Number(get("limit") ?? 20),
    variants: (get("variants") ?? "old,clite").split(",").filter(Boolean),
    variantsDir: resolve(get("variants-dir") ?? DEFAULT_VARIANTS_DIR),
    dryRun: argv.includes("--dry-run"),
  }
}

/** 读取生产 config 的 env / marketplaces / enabledPlugins,不落盘、不打印 */
function readProdSettings(): {
  env: Record<string, string>
  marketplaces: unknown
  plugins: Record<string, boolean>
} {
  const raw = JSON.parse(
    readFileSync(join(PROD_CONFIG_DIR, "settings.json"), "utf8")
  ) as {
    env?: Record<string, string>
    extraKnownMarketplaces?: unknown
    enabledPlugins?: Record<string, boolean>
  }
  const plugins: Record<string, boolean> = {}
  const keepMarketplaces = new Set<string>()
  for (const name of KEEP_PLUGINS) {
    if (raw.enabledPlugins?.[name]) {
      plugins[name] = true
      // 插件全名 <plugin>@<marketplace>,据此只带业务插件所属的 marketplace。
      // 原样照搬会把 caveman(github 源)一起带进沙箱 —— 它既被排除,又会引入
      // 网络依赖,让回放结果不可复现。
      const at = name.indexOf("@")
      if (at > 0) keepMarketplaces.add(name.slice(at + 1))
    }
  }
  const all = raw.extraKnownMarketplaces as Record<string, unknown> | undefined
  const marketplaces: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(all ?? {})) {
    if (keepMarketplaces.has(name)) marketplaces[name] = value
  }
  return {
    env: raw.env ?? {},
    marketplaces,
    plugins,
  }
}

/**
 * 生成无 hooks 沙箱配置。刻意不含 env:凭据只在进程内存里经 Options.env 传给 CLI,
 * 绝不写进这个文件。permissions 也显式钉 default,不继承生产的 bypassPermissions
 * (生产那样会让 canUseTool 白名单形同虚设)。
 */
function writeSandboxConfig(
  marketplaces: unknown,
  plugins: Record<string, boolean>
): void {
  mkdirSync(SANDBOX_CONFIG_DIR, { recursive: true })
  writeFileSync(
    join(SANDBOX_CONFIG_DIR, "settings.json"),
    JSON.stringify(
      {
        extraKnownMarketplaces: marketplaces,
        enabledPlugins: plugins,
        permissions: { defaultMode: "default" },
      },
      null,
      2
    ),
    "utf8"
  )
}

function renderVariant(
  text: string,
  brand: { name: string; description: string },
  supportUrl: string
): string {
  const hint = supportUrl
    ? `这类事务可引导用户访问 ${supportUrl} 自助查看或办理,或在本群 @我 后发送「人工」转接群管。`
    : "这类事务无法由自动客服办理,应如实说明并引导用户在本群 @我 后发送「人工」联系群管。"
  return text
    .split("${BRAND}")
    .join(brand.name)
    .split("${DESC}")
    .join(brand.description)
    .split("${HINT}")
    .join(hint)
    .split("${KB_CANDIDATES_BEGIN}")
    .join(KB_CANDIDATES_BEGIN)
    .split("${KB_CANDIDATES_END}")
    .join(KB_CANDIDATES_END)
    .split("${USER_MESSAGE_BEGIN}")
    .join(USER_MESSAGE_BEGIN)
    .split("${USER_MESSAGE_END}")
    .join(USER_MESSAGE_END)
}

/** 确定性抽样:按 id 升序等距取 limit 条,保证多变体跑同一批题 */
function sampleQuestions(repo: Repo, limit: number): string[] {
  const rows = repo.proactive.listQuestions()
  if (rows.length <= limit) return rows
  const step = Math.floor(rows.length / limit)
  return Array.from({ length: limit }, (_, i) => rows[i * step])
}

async function runOnce(
  systemPrompt: string,
  question: string,
  kbBlock: string,
  env: Record<string, string>
): Promise<{ text: string; tools: string[]; error?: string }> {
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), RUN_TIMEOUT_MS)
  const state: AssistantTextState = { text: "" }
  const tools: string[] = []
  try {
    const iter = sdkQuery({
      prompt: buildPrompt(question, undefined, kbBlock),
      options: agentQueryOptions({
        abortController,
        systemPrompt,
        maxTurns: 6,
        // 凭据在这里进程内传给 CLI 子进程。agentQueryOptions 默认把 env 设成 sdkEnv()
        // —— 它会主动剥掉全部 ANTHROPIC_*(让 CLI 去读 settings.json 的 env 块),沙箱
        // settings.json 刻意不含 env,所以必须在此覆盖回来,否则必然认证失败。
        // Options.env 是整体替换而非合并,故先铺 sdkEnv() 保住 PATH/HOME/CLAUDE_CONFIG_DIR。
        env: { ...sdkEnv(), ...env },
        canUseTool: async (
          toolName: string,
          input: Record<string, unknown>
        ) => {
          if (isToolAllowed(toolName, input)) {
            return { behavior: "allow" as const, updatedInput: input }
          }
          return { behavior: "deny" as const, message: denyMessage(toolName) }
        },
      }) as Options,
    })
    for await (const msg of iter) {
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        consumeAssistantContent(state, msg.message.content)
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            tools.push(String((block as { name?: unknown }).name ?? ""))
          }
        }
      }
    }
    return { text: finalAssistantText(state).trim(), tools }
  } catch (e) {
    return {
      text: finalAssistantText(state).trim(),
      tools,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const prod = readProdSettings()
  writeSandboxConfig(prod.marketplaces, prod.plugins)
  // 沙箱 config 目录:CLI 据此加载插件并(在其内部)读 settings.json
  process.env.CLAUDE_CONFIG_DIR = SANDBOX_CONFIG_DIR

  // 只读打开:不跑 openDb()——它会 pragma WAL + 迁移,对库有写副作用(同
  // scripts/check-kb-freshness.ts 的取舍)。回放是审计动作,不能改生产库。
  const dbPath = databaseOpenPath(process.env.DB_PATH ?? "./data/agent.db")
  const db = new Database(dbPath, { fileMustExist: true, readonly: true })
  try {
    sqliteVec.load(db)
    const repo = new RepoClass(db)
    const cfg = JSON.parse(repo.getConfigRow("app") ?? "{}") as {
      brandName?: string
      brandDescription?: string
      supportUrl?: string
    }
    // 与生产 agent.ts 同源:走 resolveBrand,不在这里另立默认值
    const brand = resolveBrand({
      name: cfg.brandName,
      description: cfg.brandDescription,
    })
    const supportUrl = cfg.supportUrl ?? ""

    const variants = new Map<string, string>()
    for (const name of args.variants) {
      if (name === "clite") {
        variants.set(name, buildDefaultSystem({ brand, supportUrl }))
        continue
      }
      const file = join(args.variantsDir, `${name}.txt`)
      variants.set(
        name,
        renderVariant(readFileSync(file, "utf8"), brand, supportUrl)
      )
    }

    if (args.dryRun) {
      for (const [name, text] of variants) {
        console.log(`\n===== ${name} (chars=${text.length}) =====\n${text}`)
      }
      return
    }

    const questions = sampleQuestions(repo, args.limit)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const outDir = join(ARTIFACT_DIR, stamp)
    mkdirSync(outDir, { recursive: true })

    const lines: string[] = [
      `# prompt 回放报告 ${stamp}`,
      "",
      `- 变体: ${args.variants.join(", ")}`,
      `- 题目数: ${questions.length}`,
      `- 沙箱 config: ${SANDBOX_CONFIG_DIR}(无 hooks;插件: ${KEEP_PLUGINS.join(", ")})`,
      "",
    ]
    for (const q of questions) {
      const vec = await embed(q)
      const hits = repo
        .searchKb(vec, 5)
        .filter((h) => h.distance <= KB_MAX_DISTANCE)
      const kbBlock = formatKbBlock(hits.map((h) => ({ content: h.content })))
      for (const [name, systemPrompt] of variants) {
        const r = await runOnce(systemPrompt, q, kbBlock, prod.env)
        lines.push(
          `## ${name} | ${q.slice(0, 60)}`,
          "",
          `- kb 命中: ${hits.length};工具: ${
            r.tools.join(", ") || "无"
          };chars: ${r.text.length}${r.error ? `;错误: ${r.error}` : ""}`,
          "",
          "```text",
          r.text.slice(0, 1200),
          "```",
          "",
          "- 判定: [ ]无依据断言 [ ]漏工具 [ ]越界泄密 [ ]答非所问",
          ""
        )
        console.log(`[${name}] ${q.slice(0, 40)} → ${r.text.length} chars`)
      }
    }
    writeFileSync(join(outDir, "report.md"), lines.join("\n"), "utf8")
    console.log(`报告: ${join(outDir, "report.md")}`)
  } finally {
    db.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
