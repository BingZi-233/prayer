import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../db/index";
import { Repo } from "../db/repo";
import { SessionStore } from "./session";

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
