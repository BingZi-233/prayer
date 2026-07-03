import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "./db/index";
import { Repo } from "./db/repo";
import { bus } from "./bus";
import { assemble } from "./assemble";

beforeEach(() => bus.removeAllListeners());

describe("assemble e2e(总线级)", () => {
  it("@bot 群消息 → 经全链路 → 发出 send_group_msg", async () => {
    const repo = new Repo(openDb(":memory:"));
    const fakeAgent = { run: vi.fn(async () => ({ text: "已收到您的问题", sessionId: "s1" })) };
    assemble({
      repo,
      botQQ: 555,
      adminGroupId: 999,
      timeoutMin: 30,
      agent: fakeAgent as any,
    });

    const sent = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 1, rawText: "退货", atList: [555] });
    const a = await sent;
    expect(a.action).toBe("send_group_msg");
    expect(a.groupId).toBe(1);
    expect(a.text).toBe("已收到您的问题");
  });
});
