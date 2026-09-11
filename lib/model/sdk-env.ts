// 交给 SDK spawn 的 CLI 子进程环境:剥掉继承自父进程的 ANTHROPIC_*,让
// CLAUDE_CONFIG_DIR 指定目录里 settings.json 的 env 块接管(auth token / base_url / 默认模型)。
// 原因:真实进程环境变量优先级 > settings.json 的 env 块;若不剥,启动 runtime 的
// shell/CC 注入的 ANTHROPIC_BASE_URL/AUTH_TOKEN 会 shadow 掉配置目录的 settings.json。
// 保留 CLAUDE_CONFIG_DIR(非 ANTHROPIC_ 前缀)与 PATH/HOME 等必需变量。
export function sdkEnv(
  base: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.startsWith("ANTHROPIC_")) continue
    out[k] = v
  }
  return out
}
