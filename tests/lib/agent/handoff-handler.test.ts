import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerHandoffHandler } from "@/lib/agent/handoff-handler";

let repo: Repo;

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:"));
  registerHandoffHandler({
    repo,
    adminGroupId: 999,
    handoffTimeoutMin: 30,
    scanMs: 60_000,
  });
});

describe("handoff handler", () => {
  it("handoff.requested → human_mode + 通知,不建工单", async () => {
    const sends: any[] = [];
    bus.on("action.send", (a) => sends.push(a));
    bus.emit("handoff.requested", {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
      lastQuestion: "退款",
      reason: "user",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(repo.isHumanMode("1:2")).toBe(true);
    expect(repo.openTickets().length).toBe(0);
    expect(sends.some((s) => s.groupId === 1 && s.text.includes("转接"))).toBe(true);
    expect(sends.some((s) => s.groupId === 999 && s.text.includes("转人工"))).toBe(true);
    expect(sends.some((s) => String(s.text).includes("工单"))).toBe(false);
  });

  it("handoff.resumed → 清 human_mode", async () => {
    bus.emit("handoff.requested", {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
      lastQuestion: "退款",
    });
    await new Promise((r) => setTimeout(r, 10));
    bus.emit("handoff.resumed", { sessionKey: "1:2", by: "admin" });
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.isHumanMode("1:2")).toBe(false);
  });
});
