import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import type Database from "better-sqlite3";

let db: Database.Database;
let repo: Repo;

beforeEach(() => {
  db = openDb(":memory:", 3);
  repo = new Repo(db);
});

describe("Repo sessions", () => {
  it("upsert 后能读回 session_id 与 human_mode", () => {
    repo.setSessionId("g:u", "sid-1");
    expect(repo.getSessionId("g:u")).toBe("sid-1");
    expect(repo.isHumanMode("g:u")).toBe(false);
    repo.setHumanMode("g:u", true);
    expect(repo.isHumanMode("g:u")).toBe(true);
  });

  it("setSessionId 同步写 session_id 与 resume_id;clearResumeId 只清续接、保留展示", () => {
    repo.setSessionId("g:u", "sid-1");
    expect(repo.getResumeId("g:u")).toBe("sid-1");
    repo.clearResumeId("g:u");
    expect(repo.getResumeId("g:u")).toBeUndefined(); // 续接指针清空
    expect(repo.getSessionId("g:u")).toBe("sid-1"); // 展示指针保留
  });

  it("列出超时的 human 会话", () => {
    repo.setHumanMode("g:old", true);
    db.prepare("UPDATE sessions SET human_since = ? WHERE key = ?").run(Date.now() - 60 * 60 * 1000, "g:old");
    const stale = repo.staleHumanSessions(30);
    expect(stale).toContain("g:old");
  });

  it("转人工问题存取 round-trip", () => {
    repo.setHandoffQuestion("100:200", "怎么退款?");
    expect(repo.handoffQuestion("100:200")).toBe("怎么退款?");
    expect(repo.handoffQuestion("无:此")).toBeUndefined();
  });

  it("humanSessionsInGroup 只返本群人工会话并解析 userId", () => {
    repo.setHumanMode("100:200", true);
    repo.setHumanMode("100:201", true);
    repo.setHumanMode("999:300", true); // 别的群
    repo.setHumanMode("100:202", false); // 非人工
    const list = repo.humanSessionsInGroup(100).sort((a, b) => a.userId - b.userId);
    expect(list).toEqual([
      { key: "100:200", userId: 200 },
      { key: "100:201", userId: 201 },
    ]);
  });
});

describe("Repo dedupe", () => {
  it("seenMessage 首次 false,再次 true", () => {
    expect(repo.seenMessage(1001)).toBe(false);
    expect(repo.seenMessage(1001)).toBe(true);
  });
});

describe("Repo kb", () => {
  it("插入 chunk + 向量,可按向量近邻检索", () => {
    const id = repo.insertKbChunk("faq.md", "退货政策 7 天", "faq");
    repo.insertKbVec(id, new Float32Array([1, 0, 0]));
    const id2 = repo.insertKbChunk("faq.md", "无关内容", "faq");
    repo.insertKbVec(id2, new Float32Array([0, 1, 0]));
    const hits = repo.searchKb(new Float32Array([1, 0, 0]), 1);
    expect(hits[0].content).toContain("退货");
  });
});

describe("Repo group_messages buffer", () => {
  it("落库后能按窗口升序取回,并按 limit 截最近", () => {
    repo.bufferGroupMessage(100, 200, "member", "问题一");
    repo.bufferGroupMessage(100, 201, "admin", "回答一");
    repo.bufferGroupMessage(999, 300, "member", "别的群"); // 不同群
    const win = repo.groupMessageWindow(100, 0, 10);
    expect(win.map((m) => m.text)).toEqual(["问题一", "回答一"]);
    expect(win[1].senderRole).toBe("admin");
    expect(win[1].userId).toBe(201);
  });

  it("groupsWithAdminMessagesBetween 只返带 owner/admin 且时间带内的群", () => {
    const now = Date.now();
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(100, 201, "admin", "带内客服", now - 100);
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(101, 202, "member", "带内用户", now - 100); // 非管理
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(102, 203, "owner", "带外客服", now - 99999); // 太早
    const groups = repo.groupsWithAdminMessagesBetween(now - 1000, now);
    expect(groups).toEqual([100]);
  });

  it("pruneGroupMessages 删早于阈值的行", () => {
    const now = Date.now();
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(100, 200, "member", "旧", now - 10000);
    repo.bufferGroupMessage(100, 200, "member", "新");
    repo.pruneGroupMessages(now - 5000);
    expect(repo.groupMessageWindow(100, 0, 10).map((m) => m.text)).toEqual(["新"]);
  });

  it("reflectCursor 缺省 0,可读写 round-trip", () => {
    expect(repo.reflectCursor()).toBe(0);
    repo.setReflectCursor(123456);
    expect(repo.reflectCursor()).toBe(123456);
  });
});
