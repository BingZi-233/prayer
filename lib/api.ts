import type { AppConfig } from "./config-store";
import { maskSecret } from "./settings-writer";

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function maskConfig(cfg: AppConfig): AppConfig {
  return { ...cfg, onebotAccessToken: maskSecret(cfg.onebotAccessToken) };
}
