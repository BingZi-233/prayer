import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db/index";
import { Repo } from "@/lib/db/repo";
import { bus } from "@/lib/bus";
import { registerMessageBuffer } from "@/lib/agent/message-buffer";
import type { IncomingMessage } from "@/lib/events";

let repo: Repo;

function msg(over: Partial<IncomingMessage>): IncomingMessage {
  return { groupId: 100, userId: 200, messageId: 1, rawText: "hi", atList: [], ...over };
}

beforeEach(() => {
  bus.removeAllListeners();
  repo = new Repo(openDb(":memory:", 3));
});

describe("message-buffer", () => {
  it("普通用户群消息落库(含 senderRole)", () => {
    const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999, enabledGroups: [100] });
    bus.emit("message.received", msg({ senderRole: "admin", rawText: "答案" }));
    const win = repo.groupMessageWindow(100, 0, 10);
    expect(win).toHaveLength(1);
    expect(win[0].senderRole).toBe("admin");
    stop();
  });

  it("排除管理群 / bot 自己 / 空文本", () => {
    const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999, enabledGroups: [100] });
    bus.emit("message.received", msg({ groupId: 999, rawText: "管理群" }));
    bus.emit("message.received", msg({ userId: 1, rawText: "bot 自己" }));
    bus.emit("message.received", msg({ rawText: "   " }));
    expect(repo.groupMessageWindow(100, 0, 10)).toHaveLength(0);
    expect(repo.groupMessageWindow(999, 0, 10)).toHaveLength(0);
    stop();
  });

  it("teardown 后不再落库", () => {
    const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999, enabledGroups: [100] });
    stop();
    bus.emit("message.received", msg({ rawText: "之后" }));
    expect(repo.groupMessageWindow(100, 0, 10)).toHaveLength(0);
  });

  it("非生效群消息不落库", () => {
    const stop = registerMessageBuffer({ repo, botQQ: 1, adminGroupId: 999, enabledGroups: [100] });
    bus.emit("message.received", msg({ groupId: 888, rawText: "非生效群" }));
    expect(repo.groupMessageWindow(888, 0, 10)).toHaveLength(0);
    stop();
  });
});
