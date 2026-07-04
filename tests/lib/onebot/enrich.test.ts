import { describe, it, expect, vi } from "vitest";
import { enrich } from "@/lib/onebot/enrich";
import type { ParsedMessage } from "@/lib/onebot/parse";

const base: ParsedMessage = {
  groupId: 1,
  userId: 2,
  messageId: 3,
  rawText: "看看",
  atList: [],
  imageUrls: [],
};

// dl 桩:url → {data: url, mediaType}
const dl = async (url: string) => ({ data: `b64(${url})`, mediaType: "image/jpeg" });

describe("enrich", () => {
  it("顶层图片下载为 base64", async () => {
    const call = vi.fn();
    const m = await enrich({ ...base, imageUrls: ["u1", "u2"] }, { call, dl });
    expect(m.images).toEqual([
      { data: "b64(u1)", mediaType: "image/jpeg" },
      { data: "b64(u2)", mediaType: "image/jpeg" },
    ]);
    expect(call).not.toHaveBeenCalled();
  });

  it("引用回复 → get_msg 取文本 + 嵌套图", async () => {
    const call = vi.fn(async (action) =>
      action === "get_msg"
        ? { sender: { nickname: "张三" }, message: [{ type: "text", data: { text: "原始问题" } }, { type: "image", data: { url: "qimg" } }] }
        : undefined
    );
    const m = await enrich({ ...base, replyId: "888" }, { call, dl });
    expect(call).toHaveBeenCalledWith("get_msg", { message_id: "888" });
    expect(m.quoted).toBe("张三: 原始问题");
    expect(m.images).toEqual([{ data: "b64(qimg)", mediaType: "image/jpeg" }]);
  });

  it("合并转发 → get_forward_msg 逐节点拼接 + 嵌套图", async () => {
    const call = vi.fn(async (action) =>
      action === "get_forward_msg"
        ? {
            messages: [
              { sender: { nickname: "A" }, message: [{ type: "text", data: { text: "第一条" } }] },
              { sender: { nickname: "B" }, message: [{ type: "image", data: { file: "img2" } }] },
            ],
          }
        : undefined
    );
    const m = await enrich({ ...base, forwardId: "res-x" }, { call, dl });
    expect(m.forwarded).toBe("A: 第一条\nB: [图片]");
    expect(m.images).toEqual([{ data: "b64(img2)", mediaType: "image/jpeg" }]);
  });

  it("get_msg 抛错 → 降级,quoted 空,主文本仍传", async () => {
    const call = vi.fn(async () => {
      throw new Error("timeout");
    });
    const m = await enrich({ ...base, replyId: "9", imageUrls: ["u1"] }, { call, dl });
    expect(m.quoted).toBeUndefined();
    expect(m.rawText).toBe("看看");
    expect(m.images).toEqual([{ data: "b64(u1)", mediaType: "image/jpeg" }]);
  });

  it("单张图下载失败跳过,不整条失败", async () => {
    const call = vi.fn();
    const dlFail = vi.fn(async (url: string) => {
      if (url === "bad") throw new Error("dl fail");
      return { data: `b64(${url})`, mediaType: "image/jpeg" };
    });
    const m = await enrich({ ...base, imageUrls: ["ok", "bad"] }, { call, dl: dlFail });
    expect(m.images).toEqual([{ data: "b64(ok)", mediaType: "image/jpeg" }]);
  });

  it("无富内容时 images 为 undefined", async () => {
    const m = await enrich(base, { call: vi.fn(), dl });
    expect(m.images).toBeUndefined();
    expect(m.quoted).toBeUndefined();
    expect(m.forwarded).toBeUndefined();
  });
});
