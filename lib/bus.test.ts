import { describe, it, expect } from "vitest";
import { bus } from "./bus";

describe("bus", () => {
  it("emit/on 传递类型化 payload", () => {
    let got: number | undefined;
    bus.on("message.received", (p) => { got = p.groupId; });
    bus.emit("message.received", { groupId: 42, userId: 1, messageId: 1, rawText: "hi", atList: [] });
    expect(got).toBe(42);
  });

  it("是单例(同一引用)", async () => {
    const again = (await import("./bus")).bus;
    expect(again).toBe(bus);
  });
});
