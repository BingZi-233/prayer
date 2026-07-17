import { describe, it, expect, beforeEach } from "vitest";
import { logger, captureConsole, consoleLine } from "@/lib/logger";

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
        channel: "qq",
        chatId: "100",
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
    expect(lines[0].channel).toBe("qq");
    expect(lines[0].chatId).toBe("100");
    expect(lines[0].scope).toBe("reflection");
  });

  it("不同会话不合并", () => {
    logger.error("输入被内容安全拦截", {
      scope: "reflection",
      channel: "qq",
      chatId: "1",
      code: "content_safety.input",
      skipClassify: true,
    });
    logger.error("输入被内容安全拦截", {
      scope: "reflection",
      channel: "tg",
      chatId: "-1001",
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

  it("unknown 不同 raw 不合并", () => {
    logger.error("boom-a", {
      scope: "topic",
      channel: "qq",
      chatId: "1",
      code: "unknown",
      title: "未分类错误",
      raw: "first root cause alpha",
      skipClassify: true,
    });
    logger.error("boom-b", {
      scope: "topic",
      channel: "qq",
      chatId: "1",
      code: "unknown",
      title: "未分类错误",
      raw: "second root cause beta",
      skipClassify: true,
    });
    expect(logger.tail()).toHaveLength(2);
  });

  it("consoleLine unknown 优先 raw 首行", () => {
    const line = consoleLine({
      ts: 0,
      lastTs: 0,
      level: "error",
      msg: "未分类错误",
      scope: "topic",
      channel: "qq",
      chatId: "42",
      code: "unknown",
      title: "未分类错误",
      raw: "LLM 归类输出解析失败\nstack here",
      count: 1,
    });
    expect(line).toContain("[topic]");
    expect(line).toContain("会话=qq:42");
    expect(line).toContain("LLM 归类输出解析失败");
    expect(line).not.toMatch(/未分类错误\s*$/);
  });

  it("去重 stdout 仅首次与每 10 次", () => {
    const out: string[] = [];
    logger.setOrigConsole({
      log: (...a) => out.push(String(a[0])),
      warn: (...a) => out.push(String(a[0])),
      error: (...a) => out.push(String(a[0])),
    });
    logger.clear();
    for (let i = 0; i < 10; i++) {
      logger.error("输入被内容安全拦截", {
        scope: "reflection",
        channel: "qq",
        chatId: "100",
        code: "content_safety.input",
        category: "content_safety",
        title: "输入被内容安全拦截",
        hint: "x",
        retryable: false,
        raw: "API Error: 500 input new_sensitive (1026)",
        skipClassify: true,
      });
    }
    // 首次 + count===10 各一行
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("输入被内容安全拦截");
    expect(out[1]).toContain("×10");
    // 清理,避免污染其它用例的 origConsole
    logger.setOrigConsole(null);
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
