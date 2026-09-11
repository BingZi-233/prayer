// claude CLI 的 plugin 生命周期管理(安装/启停/状态),即「模型能用哪些工具」的来源。
// 注意与仓库顶层的 plugins/ 区分:那个是插件本体(cs / packyapi 两个本地 MCP server),
// 本模块管的是怎么把它们挂给模型。
import { execFile } from "node:child_process"
import { resolve } from "node:path"

export interface PluginInfo {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
  mcpServers?: Record<string, unknown>
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

export class PluginManager {
  constructor(private configDir: string) {}

  private run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((res, rej) => {
      execFile(
        "claude",
        args,
        {
          env: { ...process.env, CLAUDE_CONFIG_DIR: resolve(this.configDir) },
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

  private async mutate(args: string[]): Promise<CliResult> {
    try {
      const { stdout } = await this.run(args)
      return { ok: true, stdout: stdout.trim() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
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
