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

  it("列出超时的 human 会话", () => {
    repo.setHumanMode("g:old", true);
    db.prepare("UPDATE sessions SET human_since = ? WHERE key = ?").run(Date.now() - 60 * 60 * 1000, "g:old");
    const stale = repo.staleHumanSessions(30);
    expect(stale).toContain("g:old");
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
