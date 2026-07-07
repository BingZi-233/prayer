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
}
