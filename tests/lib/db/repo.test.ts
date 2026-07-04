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
  it("upsert 后能读回 session_id", () => {
    repo.setSessionId("g:u", "sid-1");
    expect(repo.getSessionId("g:u")).toBe("sid-1");
  });

  it("setSessionId 同步写 session_id 与 resume_id;clearResumeId 只清续接、保留展示", () => {
    repo.setSessionId("g:u", "sid-1");
    expect(repo.getResumeId("g:u")).toBe("sid-1");
    repo.clearResumeId("g:u");
    expect(repo.getResumeId("g:u")).toBeUndefined(); // 续接指针清空
    expect(repo.getSessionId("g:u")).toBe("sid-1"); // 展示指针保留
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

  it("kbTotals / kbDocStats / kbChunksByDoc 供向量库预览", () => {
    const a = repo.insertKbChunk("faq/退款.md", "退款要 7 天", "faq/退款.md");
    repo.insertKbVec(a, new Float32Array([1, 0, 0]));
    const b = repo.insertKbChunk("faq/退款.md", "整单退", "faq/退款.md");
    repo.insertKbVec(b, new Float32Array([0, 1, 0]));
    repo.insertKbChunk("intro.md", "简介", "intro.md"); // 只 chunk 无向量

    expect(repo.kbTotals()).toEqual({ chunks: 3, vecs: 2 });
    expect(repo.kbDocStats()).toEqual([
      { doc: "faq/退款.md", chunks: 2 },
      { doc: "intro.md", chunks: 1 },
    ]);
    const chunks = repo.kbChunksByDoc("faq/退款.md");
    expect(chunks.map((c) => c.content)).toEqual(["退款要 7 天", "整单退"]);
    expect(chunks[0].id).toBe(a);
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

  it("groupsWithAdminMessagesUpTo 返 until 前有管理发言的群;hasAdminMessageBetween 判 band 内", () => {
    const now = Date.now();
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(100, 201, "admin", "客服", now - 100);
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(101, 202, "member", "用户", now - 100); // 非管理
    expect(repo.groupsWithAdminMessagesUpTo(now)).toEqual([100]);
    expect(repo.groupsWithAdminMessagesUpTo(now - 1000)).toEqual([]); // 太新未达上界
    expect(repo.hasAdminMessageBetween(100, now - 1000, now)).toBe(true);
    expect(repo.hasAdminMessageBetween(100, now - 50, now)).toBe(false); // band 内无(发言在 now-100)
    expect(repo.hasAdminMessageBetween(101, now - 1000, now)).toBe(false); // 非管理
  });

  it("pruneGroupMessages 删早于阈值的行", () => {
    const now = Date.now();
    db.prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
      .run(100, 200, "member", "旧", now - 10000);
    repo.bufferGroupMessage(100, 200, "member", "新");
    repo.pruneGroupMessages(now - 5000);
    expect(repo.groupMessageWindow(100, 0, 10).map((m) => m.text)).toEqual(["新"]);
  });

  it("groupReflectCursor 缺省 0,按群独立读写 round-trip", () => {
    expect(repo.groupReflectCursor(100)).toBe(0);
    repo.setGroupReflectCursor(100, 123456);
    expect(repo.groupReflectCursor(100)).toBe(123456);
    expect(repo.groupReflectCursor(200)).toBe(0); // 群隔离
  });
});
