import { describe, it, expect } from "vitest"
import type { Message } from "grammy/types"
import { enrichTelegramMessage } from "@/lib/channels/tg/enrich"
import type { IncomingMessage } from "@/lib/events"

function baseMsg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    channel: "tg",
    chatId: "-1001",
    userId: "55",
    messageId: "9",
    rawText: "hi",
    atList: [],
    botMentioned: false,
    images: [],
    ...over,
  }
}

function rawMsg(over: Partial<Message> = {}): Message {
  return {
    message_id: 9,
    date: 1,
    chat: { id: -1001, type: "supergroup", title: "g" },
    from: { id: 55, is_bot: false, first_name: "u" },
    text: "hi",
    ...over,
  } as Message
}

describe("enrichTelegramMessage", () => {
  it("填充 senderRole", async () => {
    const out = await enrichTelegramMessage(baseMsg(), rawMsg(), {
      getRole: async () => "admin",
    })
    expect(out.senderRole).toBe("admin")
    expect(out.images).toBeUndefined()
  })

  it("getRole 失败降级 member", async () => {
    const out = await enrichTelegramMessage(baseMsg(), rawMsg(), {
      getRole: async () => {
        throw new Error("x")
      },
    })
    expect(out.senderRole).toBe("member")
  })

  it("下载 photo 最大尺寸", async () => {
    const raw = rawMsg({
      photo: [
        { file_id: "s", width: 90, height: 90, file_unique_id: "1" },
        { file_id: "L", width: 800, height: 800, file_unique_id: "2" },
      ],
      text: undefined,
      caption: "cap",
    } as never)
    const out = await enrichTelegramMessage(
      baseMsg({ rawText: "cap" }),
      raw,
      {
        getRole: async () => "member",
        downloadImage: async (fid) =>
          fid === "L"
            ? { data: "YQ==", mediaType: "image/jpeg" }
            : null,
      }
    )
    expect(out.images).toEqual([
      { data: "YQ==", mediaType: "image/jpeg" },
    ])
  })

  it("下载失败仍返回消息无图", async () => {
    const raw = rawMsg({
      photo: [
        { file_id: "x", width: 1, height: 1, file_unique_id: "1" },
      ],
    } as never)
    const out = await enrichTelegramMessage(baseMsg(), raw, {
      getRole: async () => "owner",
      downloadImage: async () => null,
    })
    expect(out.senderRole).toBe("owner")
    expect(out.images).toBeUndefined()
  })

  it("observeMessage 被调用", async () => {
    const seen: { chatId: string; bot: boolean }[] = []
    await enrichTelegramMessage(
      baseMsg({ botMentioned: true }),
      rawMsg(),
      {
        getRole: async () => "member",
        observeMessage: (chatId, botMentioned) => {
          seen.push({ chatId, bot: botMentioned })
        },
      }
    )
    expect(seen).toEqual([{ chatId: "-1001", bot: true }])
  })
})
