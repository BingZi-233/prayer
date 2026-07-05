import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { SessionStore } from "@/lib/agent/session";

let db: ReturnType<typeof openDb>;
let repo: Repo;
let store: SessionStore;

beforeEach(() => {
  db = openDb(":memory:");
  repo = new Repo(db);
  store = new SessionStore(repo);
});

// 把某会话的 updated_at 改为若干毫秒前,模拟空闲
function ageSession(key: string, ms: number) {
  db.prepare("UPDATE sessions SET updated_at = unixepoch('subsec') * 1000 - ? WHERE key = ?").run(ms, key);
}

describe("SessionStore", () => {
  it("初次无 session_id", () => {
    expect(store.resumeId("a:b")).toBeUndefined();
  });
  it("记录后可取回用于 resume", () => {
    store.remember("a:b", "sid-9");
    expect(store.resumeId("a:b")).toBe("sid-9");
  });

  it("TTL=0(默认):不过期,陈旧会话仍 resume", () => {
    store.remember("a:b", "sid-9");
    ageSession("a:b", 3_600_000);
    expect(store.resumeId("a:b")).toBe("sid-9");
  });

  it("TTL 内:仍 resume", () => {
    const ttl = new SessionStore(repo, 300_000);
    store.remember("a:b", "sid-9");
    ageSession("a:b", 60_000); // 1 分钟前 < 5 分钟
    expect(ttl.resumeId("a:b")).toBe("sid-9");
  });

  it("超 TTL:不 resume(开新对话),但 session_id 仍在供网页查历史", () => {
    const ttl = new SessionStore(repo, 300_000);
    store.remember("a:b", "sid-9");
    ageSession("a:b", 360_000); // 6 分钟前 > 5 分钟
    expect(ttl.resumeId("a:b")).toBeUndefined();
    expect(repo.getSessionId("a:b")).toBe("sid-9");
  });
});
