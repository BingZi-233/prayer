import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maskSecret, mergeSecret, writeSettings, readSettings } from "@/lib/settings-writer";

describe("maskSecret", () => {
  it("空值返回空", () => expect(maskSecret("")).toBe(""));
  it("短值全掩码", () => expect(maskSecret("abc")).toBe("••••"));
  it("留后4位", () => expect(maskSecret("sk-12345678")).toBe("••••5678"));
});

describe("mergeSecret", () => {
  it("incoming 空则保留 existing", () => expect(mergeSecret("old", "")).toBe("old"));
  it("incoming 非空则覆盖", () => expect(mergeSecret("old", "new")).toBe("new"));
  it("incoming 是掩码串(含•)则保留 existing", () =>
    expect(mergeSecret("real-token", "•••• oken")).toBe("real-token"));
});

describe("settings.json 读写", () => {
  it("写入合法 JSON 再读回", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    writeSettings(dir, { env: { ANTHROPIC_MODEL: "claude-sonnet-5" } });
    const raw = readFileSync(join(dir, "settings.json"), "utf8");
    expect(JSON.parse(raw).env.ANTHROPIC_MODEL).toBe("claude-sonnet-5");
    expect(readSettings(dir)?.env?.ANTHROPIC_MODEL).toBe("claude-sonnet-5");
  });

  it("目录不存在时自动创建", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "cfg-")), "nested");
    writeSettings(dir, { model: "x" });
    expect(readSettings(dir)?.model).toBe("x");
  });

  it("读不存在的 settings 返回 null", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    expect(readSettings(dir)).toBeNull();
  });

  it("writeSettingsRaw 拒绝非法 JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    expect(() => writeSettingsRaw(dir, "{not json")).toThrow();
  });

  it("readSettings 遇损坏 JSON 返回 null", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    writeFileSync(join(dir, "settings.json"), "{broken", "utf8");
    expect(readSettings(dir)).toBeNull();
  });
});

import { writeSettingsRaw } from "@/lib/settings-writer";
