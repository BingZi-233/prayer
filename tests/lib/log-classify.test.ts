import { describe, it, expect } from "vitest";
import {
  classifyError,
  errorMessage,
  groupIdFromSession,
  chatRefFromSession,
  CATEGORY_LABELS,
} from "@/lib/log-classify";

describe("classifyError", () => {
  it("1026 new_sensitive → content_safety.input 不可重试", () => {
    const c = classifyError(
      "API Error: 500 input new_sensitive (1026). This is a server-side issue, usually temporary"
    );
    expect(c.code).toBe("content_safety.input");
    expect(c.category).toBe("content_safety");
    expect(c.title).toContain("输入");
    expect(c.retryable).toBe(false);
    expect(c.hint).toMatch(/游标|敏感/);
  });

  it("图片敏感 → content_safety.image", () => {
    const c = classifyError(
      "messages[1]'s content[8] image is sensitive, please check your input (1026)"
    );
    expect(c.code).toBe("content_safety.image");
    expect(c.category).toBe("content_safety");
  });

  it("1027 输出敏感", () => {
    const c = classifyError("output sensitive (1027)");
    expect(c.code).toBe("content_safety.output");
  });

  it("max turns", () => {
    const c = classifyError("Claude Code returned an error result: Reached maximum number of turns (1)");
    expect(c.code).toBe("model.max_turns");
    expect(c.category).toBe("model");
    expect(c.retryable).toBe(true);
  });

  it("429 限流", () => {
    const c = classifyError("API Error: 429 rate limit exceeded");
    expect(c.code).toBe("api.rate_limit");
    expect(c.category).toBe("rate_limit");
  });

  it("鉴权", () => {
    const c = classifyError("401 Unauthorized: invalid api key");
    expect(c.code).toBe("api.auth");
    expect(c.category).toBe("auth");
    expect(c.retryable).toBe(false);
  });

  it("LLM 校验失败", () => {
    const c = classifyError("LLM 产出未过安全校验,保留旧库:非 JSON 数组");
    expect(c.code).toBe("llm.validation");
    expect(c.category).toBe("validation");
  });

  it("主题归类解析失败 → topic.parse_fail", () => {
    const c = classifyError("LLM 归类输出解析失败");
    expect(c.code).toBe("topic.parse_fail");
    expect(c.category).toBe("validation");
    expect(c.title).toContain("主题归类");
    expect(c.retryable).toBe(true);
  });

  it("数据库连接", () => {
    const c = classifyError("The database connection is not open");
    expect(c.code).toBe("infra.db");
    expect(c.category).toBe("infra");
  });

  it("意图拦截", () => {
    const c = classifyError("blocked intent=extract(套取) session=1:2");
    expect(c.code).toBe("business.intent_block");
    expect(c.category).toBe("business");
  });

  it("网络错误", () => {
    const c = classifyError("fetch failed: ECONNREFUSED");
    expect(c.code).toBe("infra.network");
  });

  it("未知 → unknown", () => {
    const c = classifyError("something weird happened");
    expect(c.code).toBe("unknown");
    expect(c.category).toBe("unknown");
    expect(c.retryable).toBe(true);
  });

  it("CATEGORY_LABELS 覆盖全部类别", () => {
    expect(CATEGORY_LABELS.content_safety).toBe("内容安全");
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(8);
  });
});

describe("errorMessage / chatRefFromSession", () => {
  it("errorMessage", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("y")).toBe("y");
    expect(errorMessage({ a: 1 })).toBe('{"a":1}');
  });

  it("chatRefFromSession 规范键与历史两段键", () => {
    expect(chatRefFromSession("qq:42:9")).toEqual({
      channel: "qq",
      chatId: "42",
    });
    expect(chatRefFromSession("tg:-1001:7")).toEqual({
      channel: "tg",
      chatId: "-1001",
    });
    expect(chatRefFromSession("42:9")).toEqual({
      channel: "qq",
      chatId: "42",
    });
    expect(chatRefFromSession(undefined)).toBeUndefined();
    expect(chatRefFromSession("abc")).toBeUndefined();
  });

  it("groupIdFromSession 仍兼容 QQ 数字", () => {
    expect(groupIdFromSession("42:9")).toBe(42);
    expect(groupIdFromSession("tg:-1001:7")).toBeUndefined();
    expect(groupIdFromSession(undefined)).toBeUndefined();
  });
});
