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

  it("proactiveEnabled 开关控制 poller 定时器:开启比关闭多挂一个,teardown 均清干净", () => {
    vi.useFakeTimers();
    try {
      const repo = new Repo(openDb(":memory:"));
      const fakeAgent = { run: vi.fn(async () => ({ text: "x", sessionId: "s" })) };
      const mk = (extra: Record<string, unknown> = {}) =>
        assemble({
          repo, botQQ: 555, adminGroupId: 999, enabledGroups: [1],
          agent: fakeAgent as any,
          ...extra,
        });

      const baseline = vi.getTimerCount();

      // 关闭(默认):reflection-poller 挂若干定时器,proactive 不额外多挂
      const off = mk();
      const disabledCount = vi.getTimerCount() - baseline;
      off();
      expect(vi.getTimerCount()).toBe(baseline); // teardown 清干净

      // 开启:比关闭恰好多一个 poller 定时器
      const on = mk({ proactiveEnabled: true, proactiveScanMs: 999999 });
      const enabledCount = vi.getTimerCount() - baseline;
      expect(enabledCount).toBe(disabledCount + 1);
      on();
      expect(vi.getTimerCount()).toBe(baseline); // teardown 全清
    } finally {
      vi.useRealTimers();
    }
  });
});
