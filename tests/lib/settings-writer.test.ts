import { describe, it, expect } from "vitest";
import { maskSecret, mergeSecret } from "@/lib/settings-writer";

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
