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

  it("clearAllResumeIds 清所有续接、保留展示,返回受影响数", () => {
    repo.setSessionId("g:u1", "sid-1");
    repo.setSessionId("g:u2", "sid-2");
    repo.clearResumeId("g:u2"); // u2 已无 resume_id → 不计入
    const n = repo.clearAllResumeIds();
    expect(n).toBe(1); // 仅 u1 此前仍有 resume_id
    expect(repo.getResumeId("g:u1")).toBeUndefined();
    expect(repo.getResumeId("g:u2")).toBeUndefined();
    expect(repo.getSessionId("g:u1")).toBe("sid-1"); // 展示指针保留
    expect(repo.getSessionId("g:u2")).toBe("sid-2");
  });

  it("listSessions 返回 humanSince/lastQuestion", () => {
    repo.setSessionId("g:u", "sid-1");
    db.prepare("UPDATE sessions SET human_mode=1, human_since=1700, last_question='退款吗' WHERE key='g:u'").run();
    const s = repo.listSessions()[0];
    expect(s.humanMode).toBe(true);
    expect(s.humanSince).toBe(1700);
    expect(s.lastQuestion).toBe("退款吗");
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

describe("Repo tickets", () => {
  it("listTickets 含 open 与 closed,按创建时间降序", () => {
    const a = repo.createTicket("g:1", "问题A");
    const b = repo.createTicket("g:2", "问题B");
    db.prepare("UPDATE tickets SET status='closed', created_at=? WHERE id=?").run(1000, a);
    db.prepare("UPDATE tickets SET created_at=? WHERE id=?").run(2000, b);
    const list = repo.listTickets();
    expect(list.length).toBe(2);
    expect(list.map((t) => t.status).sort()).toEqual(["closed", "open"]);
    expect(list.find((t) => t.id === b)!.status).toBe("open");
    expect(list[0].id).toBe(b); // 降序:后创建的(created_at 更大)排首
    expect(list[1].id).toBe(a);
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

describe("Repo reflection stats", () => {
  it("reflectCursors 解析 reflect_cursor:{gid} 配置", () => {
    repo.setGroupReflectCursor(100, 1700);
    repo.setGroupReflectCursor(200, 1800);
    repo.setConfigRow("app", "{}");
    const cur = repo.reflectCursors().sort((a, b) => a.groupId - b.groupId);
    expect(cur).toEqual([
      { groupId: 100, cursor: 1700 },
      { groupId: 200, cursor: 1800 },
    ]);
  });

  it("groupMessageStats 按群分组计数并取最近时间", () => {
    repo.bufferGroupMessage(100, 1, "member", "a");
    repo.bufferGroupMessage(100, 2, "admin", "b");
    repo.bufferGroupMessage(200, 3, "member", "c");
    const stats = repo.groupMessageStats().sort((x, y) => x.groupId - y.groupId);
    expect(stats.map((s) => ({ g: s.groupId, n: s.count }))).toEqual([
      { g: 100, n: 2 },
      { g: 200, n: 1 },
    ]);
    expect(stats[0].lastTs).toBeGreaterThan(0);
  });

  it("reflectionEntries 解析 human-reflection 条目的来源群与时间,畸形回退 null", () => {
    const good = repo.insertKbChunk("human-reflection", "退款 7 天到账", "human-reflection:100:1700");
    const bad = repo.insertKbChunk("human-reflection", "无来源格式", "human-reflection");
    repo.insertKbChunk("faq/x.md", "普通文档", "faq/x.md");
    const es = repo.reflectionEntries();
    expect(es.length).toBe(2);
    const g = es.find((e) => e.id === good)!;
    expect(g.groupId).toBe(100);
    expect(g.ts).toBe(1700);
    const b = es.find((e) => e.id === bad)!;
    expect(b.groupId).toBeNull();
    expect(b.ts).toBeNull();
  });
});

describe("searchBaseKb", () => {
  it("只返回非 human-reflection 条目", () => {
    repo.insertKbEntry("faq/x.md", "基础文档内容", "faq/x.md", new Float32Array([1, 0, 0]));
    repo.insertKbEntry("human-reflection", "反思内容", "human-reflection:100:1", new Float32Array([1, 0, 0]));
    const hits = repo.searchBaseKb(new Float32Array([1, 0, 0]), 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toBe("基础文档内容");
  });

  it("反思聚集也能凑够 k 条基础条目", () => {
    // 同一向量下 5 条反思 + 3 条基础;plain k=3 会被反思占满返回 0 条基础
    const vec = () => new Float32Array([1, 0, 0]);
    for (let i = 0; i < 5; i++) repo.insertKbEntry("human-reflection", `反思${i}`, `human-reflection:1:${i}`, vec());
    for (let i = 0; i < 3; i++) repo.insertKbEntry("faq/f.md", `基础${i}`, "faq/f.md", vec());
    const hits = repo.searchBaseKb(vec(), 3);
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.content.startsWith("基础"))).toBe(true);
  });
});

describe("repo 主动兜底支持", () => {
  const mk = () => new Repo(openDb(":memory:"));

  it("sessionUpdatedAt:无会话→undefined,写入后→数值", () => {
    const repo = mk();
    expect(repo.sessionUpdatedAt("1:2")).toBeUndefined();
    repo.setSessionId("1:2", "sess-a");
    expect(typeof repo.sessionUpdatedAt("1:2")).toBe("number");
  });

  it("groupProactiveCursor:默认0,可设可读", () => {
    const repo = mk();
    expect(repo.groupProactiveCursor(100)).toBe(0);
    repo.setGroupProactiveCursor(100, 12345);
    expect(repo.groupProactiveCursor(100)).toBe(12345);
  });

  it("groupMemberMessagesBetween:只取(after,until]内非管理发言,升序", () => {
    const repo = mk();
    const seed = (uid: number, role: string | null, text: string, at: number) =>
      (repo as any).db
        .prepare("INSERT INTO group_messages (group_id,user_id,sender_role,text,created_at) VALUES (?,?,?,?,?)")
        .run(100, uid, role, text, at);
    seed(200, "member", "太早", 100);        // <= after,排除
    seed(200, "member", "问题A", 200);
    seed(201, null, "问题B", 300);
    seed(202, "admin", "管理发言", 400);      // 管理,排除
    seed(203, "owner", "群主发言", 450);      // 群主,排除
    seed(200, "member", "太新", 900);         // > until,排除
    const rows = repo.groupMemberMessagesBetween(100, 100, 500);
    expect(rows.map((r) => r.text)).toEqual(["问题A", "问题B"]);
    expect(rows[0]).toMatchObject({ userId: 200, createdAt: 200 });
  });
});
