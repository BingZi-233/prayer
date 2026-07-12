import { describe, it, expect, beforeEach, vi } from "vitest";
import { bus } from "@/lib/bus";
import {
  registerErrorHandler,
  explainError,
  formatErrorLine,
  errorMessage,
} from "@/lib/agent/error-handler";

beforeEach(() => bus.removeAllListeners());

describe("error handler", () => {
  it("带 groupId 的错误 → 兜底话术发回群", async () => {
    registerErrorHandler({ logger: () => {} });
    const p = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("error.occurred", { scope: "test", err: new Error("boom"), sessionKey: "7:8" });
    const a = await p;
    expect(a.groupId).toBe(7);
    expect(a.text).toContain("稍后");
  });

  it("调用 logger 记录", () => {
    const logger = vi.fn();
    registerErrorHandler({ logger });
    bus.emit("error.occurred", { scope: "x", err: "e" });
    expect(logger).toHaveBeenCalled();
  });

  it("logger 收到含人话说明的整行(含群号)", () => {
    const logger = vi.fn();
    registerErrorHandler({ logger });
    bus.emit("error.occurred", {
      scope: "reflection",
      groupId: 10086,
      err: new Error(
        "Claude Code returned an error result: API Error: 500 input new_sensitive (1026). This is a server-side issue, usually temporary — try again in a moment. If it persists, check your Microsoft Foundry service status."
      ),
    });
    expect(logger).toHaveBeenCalledTimes(1);
    const line = String(logger.mock.calls[0][1]);
    expect(line).toContain("[reflection]");
    expect(line).toContain("群=10086");
    expect(line).toContain("【内容安全】");
    expect(line).toContain("input new_sensitive");
    expect(line).toContain("不是临时服务故障");
    expect(line).toContain("游标不会推进");
  });
});

describe("explainError / formatErrorLine", () => {
  it("errorMessage 支持 Error / string / 对象", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("y")).toBe("y");
    expect(errorMessage({ a: 1 })).toBe('{"a":1}');
  });

  it("1026 new_sensitive → 内容安全说明", () => {
    const out = explainError("API Error: 500 input new_sensitive (1026). This is a server-side issue");
    expect(out).toMatch(/【内容安全】/);
    expect(out).toMatch(/1026/);
    expect(out).toMatch(/不是临时服务故障/);
    expect(out).toContain("原始:");
  });

  it("图片敏感额外标注", () => {
    const out = explainError("messages[1]'s content[8] image is sensitive, please check your input (1026)");
    expect(out).toContain("含敏感图片");
  });

  it("1027 输出敏感", () => {
    const out = explainError("output sensitive (1027)");
    expect(out).toMatch(/输出被判定敏感/);
  });

  it("未知错误原样返回", () => {
    expect(explainError("boom")).toBe("boom");
  });

  it("formatErrorLine 从 sessionKey 解析群号", () => {
    const line = formatErrorLine({
      scope: "orchestrator",
      sessionKey: "42:9",
      err: "oops",
    });
    expect(line).toBe("[orchestrator] (群=42 session=42:9) oops");
  });
});
