import { execFile } from "node:child_process";
import { resolve } from "node:path";

export interface PluginInfo {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
  mcpServers?: Record<string, unknown>;
}

// 插件引用 name@marketplace / 单名:仅允许安全字符,杜绝命令注入
// 注:execFile 不经 shell,本身已无注入面;此校验为纵深防御 + 早失败
export function isValidPluginRef(ref: string): boolean {
  return /^[A-Za-z0-9._@/-]+$/.test(ref) && ref.length > 0 && ref.length < 256;
}

export interface CliResult {
  ok: boolean;
  stdout?: string;
  error?: string;
}

export class PluginManager {
  constructor(private configDir: string) {}

  private run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((res, rej) => {
      execFile(
        "claude",
        args,
        { env: { ...process.env, CLAUDE_CONFIG_DIR: resolve(this.configDir) }, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) rej(new Error(stderr?.toString().trim() || err.message));
          else res({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      );
    });
  }

  async list(): Promise<PluginInfo[]> {
    const { stdout } = await this.run(["plugin", "list", "--json"]);
    return JSON.parse(stdout) as PluginInfo[];
  }

  private async mutate(args: string[]): Promise<CliResult> {
    try {
      const { stdout } = await this.run(args);
      return { ok: true, stdout: stdout.trim() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private assertRef(ref: string): void {
    if (!isValidPluginRef(ref)) throw new Error(`非法插件引用: ${ref}`);
  }

  async install(name: string, marketplace: string): Promise<CliResult> {
    this.assertRef(name);
    this.assertRef(marketplace);
    return this.mutate(["plugin", "install", `${name}@${marketplace}`, "--scope", "user"]);
  }

  async uninstall(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "uninstall", id, "--scope", "user"]);
  }

  async enable(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "enable", id, "--scope", "user"]);
  }

  async disable(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "disable", id, "--scope", "user"]);
  }

  async update(id: string): Promise<CliResult> {
    this.assertRef(id);
    return this.mutate(["plugin", "update", id, "--scope", "user"]);
  }

  // github: "owner/repo";directory: 绝对路径。两者都只允许安全字符 + 绝对路径校验
  async addMarketplace(source: string): Promise<CliResult> {
    const isAbs = source.startsWith("/");
    if (!isAbs && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(source)) {
      throw new Error(`非法 marketplace 源: ${source}`);
    }
    if (isAbs && /[;&|`$\n\r><]/.test(source)) throw new Error(`非法路径: ${source}`);
    return this.mutate(["plugin", "marketplace", "add", source]);
  }
}
