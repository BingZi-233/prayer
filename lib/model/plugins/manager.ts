// claude CLI 的 plugin 生命周期管理(安装/启停/状态),即「模型能用哪些工具」的来源。
// 注意与仓库顶层的 plugins/ 区分:那个是插件本体(cs / packyapi 两个本地 MCP server),
// 本模块管的是怎么把它们挂给模型。
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { logger } from "../../core/logger"

export interface PluginInfo {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  mcpServers?: Record<string, unknown>
}

/** Minimal shape emitted by `claude plugin marketplace list --json`. */
export interface MarketplaceInfo {
  name: string
  source?: string
  repo?: string
  path?: string
  url?: string
  installLocation?: string
}

// 插件引用 name@marketplace / 单名:仅允许安全字符,杜绝命令注入
// 注:execFile 不经 shell,本身已无注入面;此校验为纵深防御 + 早失败
export function isValidPluginRef(ref: string): boolean {
  return /^[A-Za-z0-9._@/-]+$/.test(ref) && ref.length > 0 && ref.length < 256
}

export interface CliResult {
  ok: boolean
  stdout?: string
  error?: string
}

export type PluginRollback = () => Promise<CliResult>

// Plugin hooks are third-party code.  Give the management CLI only the small
// set of process values it needs for locating the executable, config and temp
// directory.  In particular, a denylist is not enough here: cloud SDKs also
// use names such as AWS_ACCESS_KEY_ID and GOOGLE_APPLICATION_CREDENTIALS.
// Claude's own auth/model settings are loaded from CLAUDE_CONFIG_DIR below.
const SAFE_PLUGIN_ENV_KEYS = new Set([
  "APPDATA",
  "CI",
  "COLORTERM",
  "ComSpec",
  "FORCE_COLOR",
  "HOME",
  "INIT_CWD",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "LOCALAPPDATA",
  "NO_COLOR",
  "NODE_ENV",
  "OLDPWD",
  "PATH",
  "PATHEXT",
  "PWD",
  "SHELL",
  "SystemRoot",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TMP",
  "TEMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
])

export function pluginCliEnv(configDir: string): NodeJS.ProcessEnv {
  // Next's ambient ProcessEnv declaration requires NODE_ENV even though the
  // value may be absent at runtime. Seed it from the parent environment so the
  // returned map remains type-safe without widening the allowlist.
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV }
  for (const key of Object.keys(process.env)) {
    if (SAFE_PLUGIN_ENV_KEYS.has(key) || key.startsWith("LC_"))
      env[key] = process.env[key]
  }
  env.CLAUDE_CONFIG_DIR = resolve(configDir)
  return env
}

/** Run an inverse CLI action without masking the original reconfigure failure. */
export async function bestEffortPluginRollback(
  rollback?: PluginRollback
): Promise<CliResult | undefined> {
  if (!rollback) return undefined
  try {
    return await rollback()
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export class PluginManager {
  constructor(private configDir: string) {}

  private run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((res, rej) => {
      execFile(
        "claude",
        args,
        {
          env: pluginCliEnv(this.configDir),
          maxBuffer: 10 * 1024 * 1024,
          // CLI 卡住(网络拉 marketplace 元数据/配置目录锁)时整个插件管理 API
          // 不能无限期悬挂;30s 足够覆盖正常 CLI 操作
          timeout: 30_000,
          killSignal: "SIGKILL",
        },
        (err, stdout, stderr) => {
          if (err) {
            const tail = stdout?.toString().slice(-500).trim()
            // execFile 超时走 kill 信号:err.killed=true(signal=SIGKILL),code 为空
            const reason = (err as { killed?: boolean }).killed
              ? "超时(30s)被杀"
              : stderr?.toString().trim() || err.message
            rej(new Error(tail ? `${reason}\nstdout 尾部: ${tail}` : reason))
          } else res({ stdout: stdout.toString(), stderr: stderr.toString() })
        }
      )
    })
  }

  async list(): Promise<PluginInfo[]> {
    const { stdout } = await this.run(["plugin", "list", "--json"])
    try {
      return JSON.parse(stdout) as PluginInfo[]
    } catch {
      throw new Error(
        `plugin list 输出非 JSON(可能混入了 CLI 前景日志): ${stdout.slice(0, 200)}`
      )
    }
  }

  async find(id: string): Promise<PluginInfo | undefined> {
    this.assertRef(id)
    return (await this.list()).find((plugin) => plugin.id === id)
  }

  async listMarketplaces(): Promise<MarketplaceInfo[]> {
    const { stdout } = await this.run(["plugin", "marketplace", "list", "--json"])
    try {
      const parsed: unknown = JSON.parse(stdout)
      if (!Array.isArray(parsed)) throw new Error("不是数组")
      return parsed as MarketplaceInfo[]
    } catch {
      throw new Error(
        `marketplace list 输出非 JSON(可能混入了 CLI 前景日志): ${stdout.slice(
          0,
          200
        )}`
      )
    }
  }

  private async mutate(args: string[]): Promise<CliResult> {
    const action = args[1] ?? "unknown"
    const target = args[2] ?? ""
    try {
      const { stdout } = await this.run(args)
      logger.info(`[plugin] ${action} ${target}`.trim(), {
        scope: "plugin.audit",
      })
      return { ok: true, stdout: stdout.trim() }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      logger.error(`[plugin] ${action} ${target} failed`, {
        scope: "plugin.audit",
        raw: error.slice(0, 500),
      })
      return { ok: false, error }
    }
  }

  private assertRef(ref: string): void {
    if (!isValidPluginRef(ref)) throw new Error(`非法插件引用: ${ref}`)
  }

  async install(name: string, marketplace: string): Promise<CliResult> {
    this.assertRef(name)
    this.assertRef(marketplace)
    return this.mutate([
      "plugin",
      "install",
      `${name}@${marketplace}`,
      "--scope",
      "user",
    ])
  }

  /** Remove a marketplace only when the caller knows it was added by this operation. */
  async removeMarketplace(name: string): Promise<CliResult> {
    this.assertRef(name)
    return this.mutate(["plugin", "marketplace", "remove", name])
  }

  /**
   * Restore only an enable/disable transition captured immediately before it.
   * Refuse if the plugin disappeared or its version/scope changed meanwhile.
   */
  async restoreEnabled(snapshot: PluginInfo): Promise<CliResult> {
    this.assertRef(snapshot.id)
    const current = await this.find(snapshot.id)
    if (!current)
      return { ok: false, error: "插件已不存在，拒绝自动恢复启停状态" }
    if (current.version !== snapshot.version || current.scope !== snapshot.scope)
      return { ok: false, error: "插件版本或 scope 已变化，拒绝自动恢复启停状态" }
    if (current.enabled === snapshot.enabled)
      return { ok: true, stdout: "插件启停状态已恢复" }
    return snapshot.enabled ? this.enable(snapshot.id) : this.disable(snapshot.id)
  }

  async uninstall(id: string): Promise<CliResult> {
    this.assertRef(id)
    return this.mutate(["plugin", "uninstall", id, "--scope", "user"])
  }

  async enable(id: string): Promise<CliResult> {
    this.assertRef(id)
    return this.mutate(["plugin", "enable", id, "--scope", "user"])
  }

  async disable(id: string): Promise<CliResult> {
    this.assertRef(id)
    return this.mutate(["plugin", "disable", id, "--scope", "user"])
  }

  async update(id: string): Promise<CliResult> {
    this.assertRef(id)
    return this.mutate(["plugin", "update", id, "--scope", "user"])
  }

  // github: "owner/repo";directory: 绝对路径。两者都只允许安全字符 + 绝对路径校验
  async addMarketplace(source: string): Promise<CliResult> {
    const isAbs = source.startsWith("/")
    if (!isAbs && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(source)) {
      throw new Error(`非法 marketplace 源: ${source}`)
    }
    if (isAbs && /[;&|`$\n\r><]/.test(source))
      throw new Error(`非法路径: ${source}`)
    return this.mutate(["plugin", "marketplace", "add", source])
  }
}
