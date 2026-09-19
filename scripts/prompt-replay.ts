/**
 * system prompt 离线回放:同一批历史问题 × 多个 prompt 变体,产出对比报告。
 *
 * dev-only 工具,不进运行时。只读 DB(不写库)、不落任何凭据。
 *
 * 为什么需要沙箱 CLAUDE_CONFIG_DIR:
 *   生产 config 目录里有 caveman SessionStart hook 与 codegraph UserPromptSubmit hook,
 *   会给会话注入风格规则与仓库源码,污染对比结果。沙箱只保留会影响模型行为的
 *   allowlist 设置项、extraKnownMarketplaces 与业务插件,去掉全部 hooks;
 *   凭据只经 Options.env 进程内传递。
 *
 * 预算与生产对齐:maxTurns 与单题超时照抄 lib/conversation/agent.ts 的主客服路径。
 *   预算偏小会截断「有没有调工具」这个被测指标本身,系统性偏袒本来就不爱调工具的变体。
 *
 * 用法:
 *   pnpm prompt:replay --limit 3 --variants old,clite          # 冒烟
 *   pnpm prompt:replay --limit 20 --variants old,clite,a       # 正式对比
 *   pnpm prompt:replay --variants clite --dry-run              # 只打印渲染后的正文
 *
 * 变体文本默认取自 scripts/fixtures/prompt-replay/(已跟踪,见该目录 README);
 * 换用别处的文本目录传 --variants-dir <path>。
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
const { sanitizeForModel } = await import("../lib/model/sanitize-input.ts")
const { DEFAULT_RUN_TIMEOUT_MS } = await import("../lib/conversation/agent.ts")
const {
  buildPrompt,
  KB_CANDIDATES_BEGIN,
  KB_CANDIDATES_END,
  USER_MESSAGE_BEGIN,
  USER_MESSAGE_END,
} = await import("../lib/model/prompt.ts")
const {
  formatKbBlock,
  DEFAULT_KB_PREFETCH_MAX_CHARS,
  DEFAULT_KB_PREFETCH_MAX_DISTANCE,
  DEFAULT_KB_PREFETCH_TOP_K,
} = await import("../lib/knowledge/kb-prefetch.ts")
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
/**
 * 沙箱按 allowlist 保留的生产设置项。只放影响模型行为的键:hooks / skills /
 * statusLine 之类一律不带(它们会污染或干扰回放)。
 */
const SANDBOX_SETTING_KEYS = [
  "alwaysThinkingEnabled",
  "language",
  "model",
] as const
/** 与 agent.ts run() 的 maxTurns 对齐(该值是字面量,无处可导入) */
const MAX_TURNS = 20
/** 单题超时:直接复用主客服路径的常量,避免两处漂移 */
const RUN_TIMEOUT_MS = DEFAULT_RUN_TIMEOUT_MS
/** 样本取数口径:与报告头写的是同一组常量 */
const MIN_QUESTION_CHARS = 8
const MAX_QUESTION_CHARS = 200
/** 报告里单条文本(错误串 / 片段)的落盘上限 */
const MAX_ERROR_CHARS = 300
const MAX_KB_PREVIEW_CHARS = 200

/** 用法错误:打印用法后 exit 1,不产生任何副作用 */
class UsageError extends Error {}

const USAGE = `用法:
  pnpm prompt:replay --limit 3 --variants old,clite           冒烟
  pnpm prompt:replay --limit 20 --variants old,clite,a        正式对比
  pnpm prompt:replay --variants clite --dry-run               只打印渲染后的正文

  --limit <n>        正整数,默认 20
  --variants <a,b>   逗号分隔;clite = 当前 buildDefaultSystem,其余读
                     <variants-dir>/<name>.txt,默认 old,clite
  --variants-dir <p> 变体文本目录,默认 scripts/fixtures/prompt-replay
  --dry-run          只渲染并打印,不调用模型`

interface Args {
  limit: number
  variants: string[]
  variantsDir: string
  dryRun: boolean
}

/**
 * 严格逐 token 解析:任何不认识、或把「标志 + 取值」挤成一个 token 的参数都当场报错。
 * 宽松匹配(在 argv 里 indexOf("--limit"))会让 `--limit 0` 被引号包成一个 token 时
 * 静默失效、退回默认 20 题 —— 对要烧真实 API 额度的回放来说是不可接受的静默降级。
 */
const VALUE_FLAGS = ["limit", "variants", "variants-dir"] as const

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>()
  let dryRun = false
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const name = token.startsWith("--") ? token.slice(2) : ""
    if (name === "dry-run") {
      dryRun = true
      continue
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(name)) {
      throw new UsageError(`未知参数: ${JSON.stringify(token)}`)
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`--${name} 缺少取值`)
    }
    values.set(name, value)
    i += 1
  }
  const limitRaw = values.get("limit")
  const limit = Number(limitRaw ?? 20)
  if (!Number.isInteger(limit) || limit < 1) {
    throw new UsageError(
      `--limit 必须是正整数,收到 ${JSON.stringify(limitRaw ?? "")}`
    )
  }
  const variants = (values.get("variants") ?? "old,clite")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
  if (!variants.length) throw new UsageError("--variants 不能为空")
  return {
    limit,
    variants,
    variantsDir: resolve(values.get("variants-dir") ?? DEFAULT_VARIANTS_DIR),
    dryRun,
  }
}

/**
 * 先把变体文本读进来(不渲染):此步不碰 DB / 网络,未知变体名当场 fail loud,
 * 保证错用法不会留下半份报告。
 */
function readVariantTemplates(args: Args): Map<string, string> {
  const out = new Map<string, string>()
  for (const name of args.variants) {
    // clite 由 buildDefaultSystem 现场渲染,不需要模板文件
    if (name === "clite") continue
    const file = join(args.variantsDir, `${name}.txt`)
    if (!existsSync(file)) {
      throw new UsageError(
        `未知变体 ${name}:找不到 ${file}\n可用变体:clite,或 ${args.variantsDir} 下的 <name>.txt`
      )
    }
    out.set(name, readFileSync(file, "utf8"))
  }
  return out
}

/**
 * 读取生产 config 的 env / marketplaces / enabledPlugins / 行为开关,不落盘、不打印。
 * 业务插件必须全部在场:缺任何一个都会让工具白名单与生产不一致,回放测的就不是同一个东西。
 */
function readProdSettings(): {
  env: Record<string, string>
  marketplaces: Record<string, unknown>
  plugins: Record<string, boolean>
  settings: Record<string, unknown>
} {
  const raw = JSON.parse(
    readFileSync(join(PROD_CONFIG_DIR, "settings.json"), "utf8")
  ) as Record<string, unknown> & {
    env?: Record<string, string>
    extraKnownMarketplaces?: Record<string, unknown>
    enabledPlugins?: Record<string, boolean>
  }
  const plugins: Record<string, boolean> = {}
  const keepMarketplaces = new Set<string>()
  const missing: string[] = []
  for (const name of KEEP_PLUGINS) {
    if (!raw.enabledPlugins?.[name]) {
      missing.push(name)
      continue
    }
    plugins[name] = true
    // 插件全名 <plugin>@<marketplace>,据此只带业务插件所属的 marketplace。
    // 原样照搬会把 caveman(github 源)一起带进沙箱 —— 它既被排除,又会引入
    // 网络依赖,让回放结果不可复现。
    const at = name.indexOf("@")
    if (at > 0) keepMarketplaces.add(name.slice(at + 1))
  }
  if (missing.length) {
    throw new Error(
      `生产 settings.json 未启用回放所需的业务插件: ${missing.join(", ")}\n` +
        `回放要求插件集合与生产一致,否则工具是否可用与被测行为都不对。`
    )
  }
  const marketplaces: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(
    raw.extraKnownMarketplaces ?? {}
  )) {
    if (keepMarketplaces.has(name)) marketplaces[name] = value
  }
  const settings: Record<string, unknown> = {}
  for (const key of SANDBOX_SETTING_KEYS) {
    if (raw[key] !== undefined) settings[key] = raw[key]
  }
  return { env: raw.env ?? {}, marketplaces, plugins, settings }
}

/**
 * 生成无 hooks 沙箱配置。刻意不含 env:凭据只在进程内存里经 Options.env 传给 CLI,
 * 绝不写进这个文件。permissions 也显式钉 default,不继承生产的 bypassPermissions
 * (生产那样会让 canUseTool 白名单形同虚设)。
 */
function writeSandboxConfig(
  marketplaces: Record<string, unknown>,
  plugins: Record<string, boolean>,
  settings: Record<string, unknown>
): void {
  mkdirSync(SANDBOX_CONFIG_DIR, { recursive: true })
  writeFileSync(
    join(SANDBOX_CONFIG_DIR, "settings.json"),
    JSON.stringify(
      {
        ...settings,
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/** 供报告写 provenance:提交 SHA 与是否干净 */
function gitProvenance(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim()
    const dirty = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim()
    return dirty ? `${sha}(工作区有未提交改动)` : sha
  } catch {
    return "unknown(非 git 工作区)"
  }
}

/**
 * 落盘前脱敏。relay 可能把凭据回显进错误串或模型正文(用户也可能把 token 贴进问题),
 * 报告是磁盘产物,不能持久化凭据。中文不受影响(不在 token 字符集里)。
 */
const REDACT_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /[A-Za-z0-9_-]{32,}/g,
]

function redactForReport(value: string, maxChars = MAX_ERROR_CHARS): string {
  let out = value.slice(0, maxChars)
  for (const re of REDACT_PATTERNS) out = out.replace(re, "<redacted>")
  return out
}

interface QuestionSample {
  /** 库内问题总行数(过滤前) */
  total: number
  /** 通过长度过滤的条数 */
  eligible: number
  picked: string[]
}

/** 确定性抽样:按 id 升序等距取 limit 条,保证多变体跑同一批题 */
function sampleQuestions(repo: Repo, limit: number): QuestionSample {
  const all = repo.proactive.listQuestions()
  const eligible = all.filter(
    (q) => q.length >= MIN_QUESTION_CHARS && q.length <= MAX_QUESTION_CHARS
  )
  if (eligible.length <= limit) {
    return { total: all.length, eligible: eligible.length, picked: eligible }
  }
  const step = Math.floor(eligible.length / limit)
  return {
    total: all.length,
    eligible: eligible.length,
    picked: Array.from({ length: limit }, (_, i) => eligible[i * step]),
  }
}

/** KB top-1 距离分桶阈值:≤ 记为「有据可依」,> 或无命中记为「无据需兜底」 */
const KB_BUCKET_THRESHOLD = 0.8

interface PreparedQuestion {
  question: string
  /** 已按 maxDistance 过滤的候选,searchKb 已 ORDER BY distance(近→远) */
  hits: { distance: number; content: string }[]
  kbBlock: string
  /** 检索失败的原因;失败时退化为不注入候选,该题照跑 */
  error?: string
}

/**
 * 先把全部样本的 KB 候选算出来(本地嵌入,不烧 API),再写报告头 ——
 * 头部要给出本次样本的分桶摘要,判读时才知道哪几题本身就没有依据可用。
 */
async function prepareQuestions(
  repo: Repo,
  questions: string[],
  topK: number,
  maxDistance: number
): Promise<PreparedQuestion[]> {
  const out: PreparedQuestion[] = []
  for (const question of questions) {
    try {
      const vec = await embed(question)
      const hits = repo
        .searchKb(vec, topK)
        .filter((h) => h.distance <= maxDistance)
      // 与 makeKbPrefetch 对齐:先清洗再截断(预检索每轮注入,不清洗可能整请求 500)
      const contents = hits.map((h) =>
        sanitizeForModel(h.content).slice(0, DEFAULT_KB_PREFETCH_MAX_CHARS)
      )
      out.push({
        question,
        hits,
        kbBlock: formatKbBlock(contents.map((content) => ({ content }))),
      })
    } catch (e) {
      // 单题检索失败不该毁掉整轮回放:记下来,该题退回纯工具路径继续跑
      out.push({
        question,
        hits: [],
        kbBlock: "",
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return out
}

/** 本次样本按 KB top-1 距离分桶,写进报告头供判读直接分组 */
function bucketSummary(prepared: PreparedQuestion[]): string {
  let grounded = 0
  let weak = 0
  let none = 0
  for (const p of prepared) {
    const top1 = p.hits[0]?.distance
    if (top1 === undefined) none += 1
    else if (top1 <= KB_BUCKET_THRESHOLD) grounded += 1
    else weak += 1
  }
  return `≤${KB_BUCKET_THRESHOLD} 有据可依 ${grounded} 题;>${KB_BUCKET_THRESHOLD} 弱相关 ${weak} 题;无命中 ${none} 题`
}

interface ToolRecord {
  name: string
  decision: "allow" | "deny"
  count: number
}

interface RunResult {
  text: string
  tools: ToolRecord[]
  /** 模型消息里观察到、但没经过 canUseTool 的工具名(正常应为空) */
  undecided: string[]
  error?: string
}

/**
 * 工具记录以 canUseTool 为唯一真源:被拒的调用也是「调用了」,不能只记消息里出现的
 * tool_use —— 那会把「尝试越界但被拦」记成干净,直接翻转「越界泄密」的判定。
 * 消息侧只用来兜底核对有没有漏过判定的调用。
 */
function bumpTool(
  records: ToolRecord[],
  name: string,
  decision: ToolRecord["decision"]
): void {
  if (!name) return
  const hit = records.find((r) => r.name === name && r.decision === decision)
  if (hit) hit.count += 1
  else records.push({ name, decision, count: 1 })
}

async function runOnce(
  systemPrompt: string,
  question: string,
  kbBlock: string,
  env: Record<string, string>
): Promise<RunResult> {
  const abortController = new AbortController()
  const records: ToolRecord[] = []
  const observed = new Set<string>()
  const state: AssistantTextState = { text: "" }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const iter = sdkQuery({
      prompt: buildPrompt(question, undefined, kbBlock),
      options: agentQueryOptions({
        abortController,
        systemPrompt,
        maxTurns: MAX_TURNS,
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
            bumpTool(records, toolName, "allow")
            return { behavior: "allow" as const, updatedInput: input }
          }
          bumpTool(records, toolName, "deny")
          return { behavior: "deny" as const, message: denyMessage(toolName) }
        },
      }) as Options,
    })
    // 迭代累积独立成 promise,供超时计时器竞速;超时胜出时仍能返回已累积文本。
    // relay 挂死时 for await 可能永不结束,光 abort 不够(同 agent.ts 的取舍)。
    const drain = (async () => {
      for await (const msg of iter) {
        if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
          consumeAssistantContent(state, msg.message.content)
          for (const block of msg.message.content) {
            if (block.type === "tool_use") {
              observed.add(String((block as { name?: unknown }).name ?? ""))
            }
          }
        }
      }
    })()
    // 超时胜出后 drain 常因 abort 迟到 reject:挂一个吞噬 handler 防 unhandledRejection
    drain.catch(() => {})
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abortController.abort()
        reject(new Error(`回放单题超时(${RUN_TIMEOUT_MS}ms)`))
      }, RUN_TIMEOUT_MS)
    })
    await Promise.race([drain, timeout])
    return {
      text: finalAssistantText(state).trim(),
      tools: records,
      undecided: [...observed].filter(
        (name) => name && !records.some((r) => r.name === name)
      ),
    }
  } catch (e) {
    return {
      text: finalAssistantText(state).trim(),
      tools: records,
      undecided: [...observed].filter(
        (name) => name && !records.some((r) => r.name === name)
      ),
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

function toolSummary(
  records: ToolRecord[],
  decision: ToolRecord["decision"]
): string {
  const hit = records.filter((r) => r.decision === decision)
  if (!hit.length) return "无"
  return hit
    .map((r) => (r.count > 1 ? `${r.name} ×${r.count}` : r.name))
    .join(", ")
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const templates = readVariantTemplates(args)

  const prod = readProdSettings()
  writeSandboxConfig(prod.marketplaces, prod.plugins, prod.settings)
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
      kbPrefetchTopK?: number
      kbPrefetchMaxDistance?: number
    }
    // 与生产 agent.ts 同源:走 resolveBrand,不在这里另立默认值
    const brand = resolveBrand({
      name: cfg.brandName,
      description: cfg.brandDescription,
    })
    const supportUrl = cfg.supportUrl?.trim() ?? ""
    const topK = cfg.kbPrefetchTopK ?? DEFAULT_KB_PREFETCH_TOP_K
    const maxDistance =
      cfg.kbPrefetchMaxDistance ?? DEFAULT_KB_PREFETCH_MAX_DISTANCE

    const variants = new Map<string, string>()
    for (const name of args.variants) {
      variants.set(
        name,
        name === "clite"
          ? buildDefaultSystem({ brand, supportUrl })
          : renderVariant(templates.get(name) ?? "", brand, supportUrl)
      )
    }

    if (args.dryRun) {
      for (const [name, text] of variants) {
        console.log(
          `\n===== ${name} (chars=${text.length} sha256=${sha256(text)}) =====\n${text}`
        )
      }
      return
    }

    const sample = sampleQuestions(repo, args.limit)
    if (sample.picked.length === 0) {
      throw new Error(
        `样本为空:proactive_replies 共 ${sample.total} 行,` +
          `通过长度过滤(${MIN_QUESTION_CHARS}~${MAX_QUESTION_CHARS} 字符)的有 ${sample.eligible} 条。` +
          `\n--limit=${args.limit} 没有可跑的题,拒绝写空报告。`
      )
    }

    const prepared = await prepareQuestions(
      repo,
      sample.picked,
      topK,
      maxDistance
    )

    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const outDir = join(ARTIFACT_DIR, stamp)
    const renderedDir = join(outDir, "variants")
    mkdirSync(renderedDir, { recursive: true })
    // 渲染后的正文落盘:报告里的判定要对得上确切输入,光有 sha256 不够复核
    for (const [name, text] of variants) {
      writeFileSync(join(renderedDir, `${name}.txt`), text, "utf8")
    }
    const reportPath = join(outDir, "report.md")
    const lines: string[] = [
      `# prompt 回放报告 ${stamp}`,
      "",
      "## 运行环境",
      "",
      `- git: ${gitProvenance()}`,
      `- 变体: ${args.variants.join(", ")}`,
      `- 题目数: ${sample.picked.length}(--limit ${args.limit})`,
      `- 样本来源: proactive_replies 共 ${sample.total} 行,按长度 ${MIN_QUESTION_CHARS}~${MAX_QUESTION_CHARS} 字符(JS 长度)过滤得 ${sample.eligible} 条,按 id 升序等距抽样`,
      "  - 有偏:只含主动补位链路记录过的问题,且仅限生效群白名单,不代表真实提问分布",
      "- 判读口径: 单题结果受采样随机性支配(实测同题同 prompt 三次运行,old 的工具调用数为 0/3/0),不得按单题判读;",
      "  必须按批次聚合,并按每题 KB top-1 距离分桶看(有据可依 / 无据需兜底)。",
      `- 样本分桶(KB top-1 距离): ${bucketSummary(prepared)}`,
      `- 模型: ANTHROPIC_MODEL=${prod.env.ANTHROPIC_MODEL ?? "(未设置)"};settings.model=${JSON.stringify(prod.settings.model ?? null)}`,
      `- 预算: maxTurns=${MAX_TURNS};单题超时=${RUN_TIMEOUT_MS}ms(对齐 agent.ts)`,
      `- KB: topK=${topK};maxDistance=${maxDistance};每片截断=${DEFAULT_KB_PREFETCH_MAX_CHARS} 字符(对齐 makeKbPrefetch)`,
      `- 沙箱 config: ${SANDBOX_CONFIG_DIR}(无 hooks;插件: ${Object.keys(prod.plugins).join(", ")})`,
      `- 沙箱行为开关: ${SANDBOX_SETTING_KEYS.map((k) => `${k}=${JSON.stringify(prod.settings[k] ?? null)}`).join(";")}`,
      `- 渲染后正文: ${args.variants.map((n) => `variants/${n}.txt`).join(", ")}`,
    ]
    for (const [name, text] of variants) {
      lines.push(`  - ${name}: ${text.length} chars, sha256=${sha256(text)}`)
    }
    lines.push("")
    const flush = (): void => {
      writeFileSync(reportPath, lines.join("\n"), "utf8")
    }
    // 先落一份头,之后每个变体跑完都重写一次:任何中断都保住已完成结果
    flush()

    for (const item of prepared) {
      const q = item.question
      const top1 = item.hits[0]
      lines.push(
        `---`,
        "",
        `## ${redactForReport(q, 200)}`,
        "",
        `- KB top-1 距离: ${top1 ? top1.distance.toFixed(4) : "无命中"}`
      )
      if (item.error) {
        lines.push(
          `- KB 检索失败,本题不注入候选: ${redactForReport(item.error)}`
        )
      }
      lines.push(`- KB 命中 ${item.hits.length} 条:`)
      if (!item.hits.length) lines.push("  - (无)")
      item.hits.forEach((h, i) => {
        lines.push(
          `  - [${i + 1}] distance=${h.distance.toFixed(4)} | ${redactForReport(h.content, MAX_KB_PREVIEW_CHARS)}`
        )
      })
      lines.push("")

      for (const [name, systemPrompt] of variants) {
        const r = await runOnce(systemPrompt, q, item.kbBlock, prod.env)
        lines.push(
          `### ${name}`,
          "",
          `- 工具调用: ${toolSummary(r.tools, "allow")}`,
          `- 工具被拒: ${toolSummary(r.tools, "deny")}`,
          `- 结果: ${r.text.length} chars${r.error ? `;错误: ${redactForReport(r.error)}` : ""}`
        )
        if (r.undecided.length) {
          lines.push(`- 未经判定的工具(异常,请排查): ${r.undecided.join(", ")}`)
        }
        lines.push(
          "",
          "```text",
          redactForReport(r.text, 1200),
          "```",
          "",
          "- 判定: [ ]无依据断言 [ ]漏工具 [ ]越界泄密 [ ]答非所问",
          ""
        )
        flush()
        console.log(`[${name}] ${q.slice(0, 40)} → ${r.text.length} chars`)
      }
    }
    console.log(`报告: ${reportPath}`)
  } finally {
    db.close()
  }
}

main().catch((e: unknown) => {
  if (e instanceof UsageError) {
    console.error(e.message)
    console.error(USAGE)
  } else {
    console.error(e instanceof Error ? e.message : e)
  }
  process.exit(1)
})
