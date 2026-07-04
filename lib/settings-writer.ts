import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Settings = Record<string, unknown> & {
  env?: Record<string, string>;
  model?: string;
};

function settingsPath(configDir: string): string {
  return join(configDir, "settings.json");
}

export function maskSecret(v: string): string {
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return "••••" + v.slice(-4);
}

export function mergeSecret(existing: string, incoming: string): string {
  // 空值或仍是掩码(含 • U+2022)→ 保留旧值,防止把掩码串当真值写回
  if (!incoming || incoming.includes("•")) return existing;
  return incoming;
}

export function writeSettings(configDir: string, settings: Settings): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath(configDir), JSON.stringify(settings, null, 2), "utf8");
}

export function writeSettingsRaw(configDir: string, raw: string): void {
  JSON.parse(raw); // 校验:非法 JSON 抛错
  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath(configDir), raw, "utf8");
}

export function readSettings(configDir: string): Settings | null {
  const p = settingsPath(configDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Settings;
  } catch {
    return null;
  }
}
