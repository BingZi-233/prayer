import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerHandoffHandler } from "@/lib/agent/handoff-handler";

let repo: Repo;

beforeEach(() => {
  bus.removeAllListeners();
  vi.useRealTimers();
  repo = new Repo(openDb(":memory:"));
});

describe("handoff handler", () => {
  it("handoff.requested → 置 human_mode + 通知管理群", async () => {
    const stop = registerHandoffHandler({ repo, adminGroupId: 999, timeoutMin: 30 });
    const notice = new Promise<any>((res) => bus.once("action.send", res));
    bus.emit("handoff.requested", { sessionKey: "1:2", groupId: 1, userId: 2, lastQuestion: "退款没到" });
    const a = await notice;
    expect(repo.isHumanMode("1:2")).toBe(true);
    expect(a.groupId).toBe(999);
    expect(a.text).toContain("1:2");
    stop();
  });

  it("handoff.resumed → 复位 human_mode", () => {
    const stop = registerHandoffHandler({ repo, adminGroupId: 999, timeoutMin: 30 });
    repo.setHumanMode("1:2", true);
    bus.emit("handoff.resumed", { sessionKey: "1:2" });
    expect(repo.isHumanMode("1:2")).toBe(false);
    stop();
  });

  it("扫描到超时会话自动 emit handoff.resumed", async () => {
    const stop = registerHandoffHandler({ repo, adminGroupId: 999, timeoutMin: 30, scanMs: 20 });
    repo.setHumanMode("1:2", true);
    (repo as any).db?.prepare?.("UPDATE sessions SET human_since=? WHERE key=?");
    // 直接构造超时:改 human_since 到 1 小时前
    openDb; // no-op
    const p = new Promise<any>((res) => bus.once("handoff.resumed", res));
    // 用 repo 暴露的底层 db 更新时间
    (repo as unknown as { db: any });
    // 通过再次 setHumanMode 后手动回拨
    // 简化:直接调用内部 SQL
    (repo as unknown as { db: any }).db.prepare("UPDATE sessions SET human_since=? WHERE key=?").run(Date.now() - 3600_000, "1:2");
    const r = await p;
    expect(r.sessionKey).toBe("1:2");
    stop();
  });
});
