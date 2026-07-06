import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { assemble } from "@/lib/assemble";

beforeEach(() => bus.removeAllListeners());

describe("assemble e2e(总线级)", () => {
  it("@bot 群消息 → 经全链路 → 发出 send_group_msg", async () => {
    const repo = new Repo(openDb(":memory:"));
    const fakeAgent = { run: vi.fn(async () => ({ text: "已收到您的问题", sessionId: "s1" })) };
    assemble({
      repo,
      botQQ: 555,
      adminGroupId: 999,
      enabledGroups: [1],
      agent: fakeAgent as any,
    });

    const sent = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 1, rawText: "退货", atList: [555] });
    const a = await sent;
    expect(a.action).toBe("send_group_msg");
    expect(a.groupId).toBe(1);
    expect(a.text).toBe("已收到您的问题");
  });

  it("proactiveEnabled=false(默认) → 不挂 poller(agent 不被主动调用)", async () => {
    const repo = new Repo(openDb(":memory:"));
    const fakeAgent = { run: vi.fn(async () => ({ text: "x", sessionId: "s" })) };
    const teardown = assemble({
      repo, botQQ: 555, adminGroupId: 999, enabledGroups: [1],
      agent: fakeAgent as any,
    });
    // 无主动路径:非 @bot 的普通消息不应触发 agent
    bus.emit("message.received", { groupId: 1, userId: 2, messageId: 9, rawText: "普通消息", atList: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(fakeAgent.run).not.toHaveBeenCalled();
    teardown();
  });

  it("proactiveEnabled=true → 挂 poller(装配不报错,teardown 可清定时器)", async () => {
    const repo = new Repo(openDb(":memory:"));
    const fakeAgent = { run: vi.fn(async () => ({ text: "x", sessionId: "s" })) };
    const teardown = assemble({
      repo, botQQ: 555, adminGroupId: 999, enabledGroups: [1],
      agent: fakeAgent as any,
      proactiveEnabled: true, proactiveScanMs: 999999,
    });
    expect(typeof teardown).toBe("function");
    teardown(); // 清定时器
  });
});
