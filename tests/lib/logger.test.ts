import { describe, it, expect, beforeEach } from "vitest";
import { logger, captureConsole } from "@/lib/logger";

describe("logger ring buffer", () => {
  beforeEach(() => logger.clear());

  it("记录并读回", () => {
    logger.log("info", "hello");
    const lines = logger.tail();
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe("hello");
    expect(lines[0].level).toBe("info");
    expect(typeof lines[0].ts).toBe("number");
  });

  it("超过上限截断保留最新", () => {
    for (let i = 0; i < 600; i++) logger.log("info", `m${i}`);
    const lines = logger.tail();
    expect(lines).toHaveLength(500);
    expect(lines[0].msg).toBe("m100");
    expect(lines[499].msg).toBe("m599");
  });

  it("captureConsole 捕获 Error 的 message/stack(非 {})", () => {
    captureConsole();
    logger.clear();
    console.error(new Error("boom"));
    const joined = logger.tail().map((l) => l.msg).join("\n");
    expect(joined).toContain("boom");
    expect(joined).not.toBe("{}");
  });
});
