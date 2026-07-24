import { describe, it, expect } from "vitest"
import { parseGroupMessage } from "@/lib/onebot/parse"

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
    }
    const m = parseGroupMessage(evt)
    expect(m).toMatchObject({
      groupId: 100,
      userId: 200,
      messageId: 9,
      rawText: "你好",
      atList: [555],
      imageUrls: [],
    })
    expect(m?.replyId).toBeUndefined()
    expect(m?.forwardId).toBeUndefined()
  })

  it("解析 CQ 字符串格式", () => {
    const evt = {
      post_type: "message",
      message_type: "group",
      group_id: 1,
      user_id: 2,
      message_id: 3,
      message: "[CQ:at,qq=555] 在吗",
    }
    const m = parseGroupMessage(evt)
    expect(m?.atList).toEqual([555])
    expect(m?.rawText).toBe("在吗")
  })

  it("非群消息返回 null", () => {
    expect(
      parseGroupMessage({ post_type: "message", message_type: "private" })
    ).toBeNull()
    expect(parseGroupMessage({ post_type: "meta_event" })).toBeNull()
  })

  it("提取 sender.role(owner/admin/member),缺失为 undefined", () => {
    const base = {
      post_type: "message",
      message_type: "group",
      group_id: 1,
      user_id: 2,
      message_id: 3,
      message: "hi",
    }
    expect(
      parseGroupMessage({ ...base, sender: { role: "owner" } })?.senderRole
    ).toBe("owner")
    expect(
      parseGroupMessage({ ...base, sender: { role: "admin" } })?.senderRole
    ).toBe("admin")
    expect(
      parseGroupMessage({ ...base, sender: { role: "member" } })?.senderRole
    ).toBe("member")
    expect(parseGroupMessage(base)?.senderRole).toBeUndefined()
  })

  it("数组格式抽 image(url 优先 file)/ reply id / forward id,丢未知段", () => {
    const evt = {
      post_type: "message",
      message_type: "group",
      group_id: 1,
      user_id: 2,
      message_id: 5,
      message: [
        { type: "reply", data: { id: "888" } },
        { type: "at", data: { qq: "2" } },
        { type: "text", data: { text: "看这个" } },
        { type: "image", data: { url: "http://a/1.jpg", file: "1.jpg" } },
        { type: "image", data: { file: "2.jpg" } },
        { type: "face", data: { id: "1" } }, // 丢
        { type: "forward", data: { id: "res-x" } },
      ],
    }
    const m = parseGroupMessage(evt)!
    expect(m.rawText).toBe("看这个")
    expect(m.imageUrls).toEqual(["http://a/1.jpg", "2.jpg"])
    expect(m.replyId).toBe("888")
    expect(m.forwardId).toBe("res-x")
  })

  it("CQ 字符串抽 image url 与 reply id", () => {
    const evt = {
      post_type: "message",
      message_type: "group",
      group_id: 1,
      user_id: 2,
      message_id: 6,
      message: "[CQ:reply,id=42][CQ:image,file=x.jpg,url=http://b/x.jpg]帮看看",
    }
    const m = parseGroupMessage(evt)!
    expect(m.replyId).toBe("42")
    expect(m.imageUrls).toEqual(["http://b/x.jpg"])
    expect(m.rawText).toBe("帮看看")
  })
})
