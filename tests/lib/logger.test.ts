import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    expect(lines[0].lastTs).toBe(lines[0].ts);
  });

  it("超过上限截断保留最新", () => {
    for (let i = 0; i < 600; i++) logger.log("info", `m${i}`);
    const lines = logger.tail();
    expect(lines).toHaveLength(500);
    expect(lines[0].msg).toBe("m100");
    expect(lines[499].msg).toBe("m599");
  });

  it("error 自动分类 content_safety", () => {
    logger.error("API Error: 500 input new_sensitive (1026). temporary");
    const e = logger.tail()[0];
    expect(e.level).toBe("error");
    expect(e.code).toBe("content_safety.input");
    expect(e.category).toBe("content_safety");
    expect(e.title).toContain("输入");
    expect(e.retryable).toBe(false);
    expect(e.hint).toBeTruthy();
  });

  it("同 fingerprint 去重累加 count", () => {
    const raw = "API Error: 500 input new_sensitive (1026)";
    for (let i = 0; i < 5; i++) {
      logger.error("输入被内容安全拦截", {
        scope: "reflection",
        groupId: 100,
        code: "content_safety.input",
        category: "content_safety",
        title: "输入被内容安全拦截",
        hint: "x",
        retryable: false,
        raw,
        skipClassify: true,
      });
    }
    const lines = logger.tail();
    expect(lines).toHaveLength(1);
    expect(lines[0].count).toBe(5);
    expect(lines[0].groupId).toBe(100);
    expect(lines[0].scope).toBe("reflection");
  });

  it("不同群不合并", () => {
    logger.error("输入被内容安全拦截", {
      scope: "reflection",
      groupId: 1,
      code: "content_safety.input",
      skipClassify: true,
    });
    logger.error("输入被内容安全拦截", {
      scope: "reflection",
      groupId: 2,
      code: "content_safety.input",
      skipClassify: true,
    });
    expect(logger.tail()).toHaveLength(2);
  });

  it("info 不去 classify", () => {
    logger.info("normal");
    const e = logger.tail()[0];
    expect(e.code).toBeUndefined();
    expect(e.msg).toBe("normal");
  });
});

describe("captureConsole", () => {
  // captureConsole 全局一次性;测分类与进 ring
  it("captureConsole 捕获 Error 的 message(非 {})", () => {
    captureConsole();
    logger.clear();
    console.error(new Error("boom-unique-xyz"));
    const joined = logger.tail().map((l) => l.msg + (l.raw ?? "")).join("\n");
    expect(joined).toContain("boom-unique-xyz");
    expect(joined).not.toBe("{}");
  });

  it("captureConsole 对 new_sensitive 分类", () => {
    captureConsole();
    logger.clear();
    console.error("API Error: 500 input new_sensitive (1026)");
    const e = logger.tail().find((l) => l.code === "content_safety.input");
    expect(e).toBeTruthy();
    expect(e!.category).toBe("content_safety");
  });
});
