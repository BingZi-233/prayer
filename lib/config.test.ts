import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("从 env 读取并转型", () => {
    const c = loadConfig({
      ONEBOT_WS_URL: "ws://x:1",
      BOT_QQ: "123",
      ADMIN_GROUP_ID: "456",
      HANDOFF_TIMEOUT_MIN: "15",
    });
    expect(c.botQQ).toBe(123);
    expect(c.adminGroupId).toBe(456);
    expect(c.handoffTimeoutMin).toBe(15);
    expect(c.onebotWsUrl).toBe("ws://x:1");
  });

  it("缺必填项抛错", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("HANDOFF_TIMEOUT_MIN 缺省为 30", () => {
    const c = loadConfig({ ONEBOT_WS_URL: "ws://x:1", BOT_QQ: "1", ADMIN_GROUP_ID: "2" });
    expect(c.handoffTimeoutMin).toBe(30);
  });
});
