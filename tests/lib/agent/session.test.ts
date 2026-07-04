import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { SessionStore } from "@/lib/agent/session";

let store: SessionStore;

beforeEach(() => {
  store = new SessionStore(new Repo(openDb(":memory:")));
});

describe("SessionStore", () => {
  it("初次无 session_id", () => {
    expect(store.resumeId("a:b")).toBeUndefined();
  });
  it("记录后可取回用于 resume", () => {
    store.remember("a:b", "sid-9");
    expect(store.resumeId("a:b")).toBe("sid-9");
  });
});
