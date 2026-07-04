import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";

function mkRepo(): Repo {
  return new Repo(openDb(":memory:", 3));
}

describe("Repo 统计/列表", () => {
  it("countSessions 计数", () => {
    const repo = mkRepo();
    expect(repo.countSessions()).toBe(0);
    repo.setSessionId("g1:u1", "s1");
    repo.setSessionId("g1:u2", "s2");
    expect(repo.countSessions()).toBe(2);
  });

  it("listSessions 返回 key/session_id/human_mode/updated_at", () => {
    const repo = mkRepo();
    repo.setSessionId("g1:u1", "s1");
    const list = repo.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe("g1:u1");
    expect(list[0].sessionId).toBe("s1");
    expect(list[0].humanMode).toBe(false);
  });

  it("openTickets 只返回 open", () => {
    const repo = mkRepo();
    repo.createTicket("g1:u1", "退款问题");
    const t = repo.openTickets();
    expect(t).toHaveLength(1);
    expect(t[0].sessionKey).toBe("g1:u1");
    expect(t[0].summary).toBe("退款问题");
  });
});
