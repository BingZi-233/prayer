import { describe, it, expect } from "vitest";
import { parseGroupMessage } from "@/lib/onebot/parse";

describe("parseGroupMessage", () => {
  it("解析数组段格式,提取 @ 列表与纯文本", () => {
    const evt = {
      post_type: "message",
      message_type: "group",
      group_id: 100,
      user_id: 200,
      message_id: 9,
      message: [
        { type: "at", data: { qq: "555" } },
        { type: "text", data: { text: " 你好 " } },
      ],
    };
    const m = parseGroupMessage(evt);
    expect(m).toEqual({ groupId: 100, userId: 200, messageId: 9, rawText: "你好", atList: [555] });
  });

  it("解析 CQ 字符串格式", () => {
    const evt = {
      post_type: "message",
      message_type: "group",
      group_id: 1,
      user_id: 2,
      message_id: 3,
      message: "[CQ:at,qq=555] 在吗",
    };
    const m = parseGroupMessage(evt);
    expect(m?.atList).toEqual([555]);
    expect(m?.rawText).toBe("在吗");
  });

  it("非群消息返回 null", () => {
    expect(parseGroupMessage({ post_type: "message", message_type: "private" })).toBeNull();
    expect(parseGroupMessage({ post_type: "meta_event" })).toBeNull();
  });
});
