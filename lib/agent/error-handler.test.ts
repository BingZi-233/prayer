import { describe, it, expect, beforeEach, vi } from "vitest";
import { bus } from "../bus";
import { registerErrorHandler } from "./error-handler";

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
});
