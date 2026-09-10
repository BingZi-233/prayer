// 密钥掩码 / 合并助手:用于 OneBot access token 等 AppConfig 内的敏感字段。
// SDK 凭证(ANTHROPIC_*)不由本程序读写,由用户手动维护 CLAUDE_CONFIG_DIR/settings.json。

export function maskSecret(v: string): string {
  if (!v) return ""
  if (v.length <= 4) return "••••"
  return "••••" + v.slice(-4)
}

export function mergeSecret(existing: string, incoming: string): string {
  // 空值或仍是掩码(含 • U+2022)→ 保留旧值,防止把掩码串当真值写回
  if (!incoming || incoming.includes("•")) return existing
  return incoming
}
