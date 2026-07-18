import { describe, it, expect, vi } from "vitest"
import type { Message } from "grammy/types"
import {
  enrichTelegramMessage,
  isBotRelatedMessage,
} from "@/lib/channels/tg/enrich"
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

  it("observeMessage 被调用（botMentioned → botRelated）", async () => {
    const seen: { chatId: string; bot: boolean }[] = []
    await enrichTelegramMessage(
      baseMsg({ botMentioned: true }),
      rawMsg(),
      {
        getRole: async () => "member",
        observeMessage: (chatId, botRelated) => {
          seen.push({ chatId, bot: botRelated })
        },
      }
    )
    expect(seen).toEqual([{ chatId: "-1001", bot: true }])
  })

  it("observeMessage：reply-to-bot 视为 botRelated", async () => {
    const observe = vi.fn()
    await enrichTelegramMessage(
      baseMsg({ botMentioned: false }),
      rawMsg({
        reply_to_message: {
          message_id: 1,
          date: 1,
          chat: { id: -1001, type: "supergroup", title: "g" },
          from: { id: 999, is_bot: true, first_name: "bot" },
        } as Message["reply_to_message"],
      }),
      {
        getRole: async () => "member",
        observeMessage: observe,
        botId: 999,
      }
    )
    expect(observe).toHaveBeenCalledWith("-1001", true)
  })
})

describe("isBotRelatedMessage", () => {
  it("@ / reply-to-bot / bot_command 为 true，普通文本为 false", () => {
    expect(isBotRelatedMessage(rawMsg(), 1, true)).toBe(true)
    expect(
      isBotRelatedMessage(
        rawMsg({
          reply_to_message: {
            message_id: 1,
            date: 1,
            chat: { id: -1001, type: "supergroup", title: "g" },
            from: { id: 42, is_bot: true, first_name: "b" },
          } as Message["reply_to_message"],
        }),
        42,
        false
      )
    ).toBe(true)
    expect(
      isBotRelatedMessage(
        rawMsg({
          text: "/start",
          entities: [{ type: "bot_command", offset: 0, length: 6 }],
        }),
        1,
        false
      )
    ).toBe(true)
    expect(isBotRelatedMessage(rawMsg({ text: "闲聊" }), 1, false)).toBe(
      false
    )
  })
})
