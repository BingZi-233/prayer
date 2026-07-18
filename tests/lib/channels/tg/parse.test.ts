import { describe, it, expect } from "vitest"
import type { Update } from "grammy/types"
import { parseTelegramUpdate } from "@/lib/channels/tg/parse"
import {
  isBotMentioned,
  stripBotMention,
  normalizeUsername,
  utf16Slice,
} from "@/lib/channels/tg/trigger"

const BOT_ID = 900001
const BOT_USERNAME = "PrayerBot"
const CTX = { botId: BOT_ID, botUsername: BOT_USERNAME }

/** 构造一条群消息 Update 的最小 fixture */
function groupUpdate(overrides: {
  chatId?: number
  chatType?: "group" | "supergroup" | "private" | "channel"
  userId?: number
  messageId?: number
  text?: string
  entities?: Update["message"] extends infer M
    ? M extends { entities?: infer E }
      ? E
      : never
    : never
  message_thread_id?: number
  reply_to_message?: { text?: string; caption?: string }
  forward_origin?: NonNullable<Update["message"]>["forward_origin"]
  from?: false
}): Update {
  const chatId = overrides.chatId ?? -1001234567890
  const chatType = overrides.chatType ?? "supergroup"
  const text = overrides.text ?? "hello"
  return {
    update_id: 1,
    message: {
      message_id: overrides.messageId ?? 42,
      date: 1_700_000_000,
      chat: {
        id: chatId,
        type: chatType,
        title: "test group",
      } as never,
      ...(overrides.from === false
        ? {}
        : {
            from: {
              id: overrides.userId ?? 555,
              is_bot: false,
              first_name: "User",
            },
          }),
      text,
      ...(overrides.entities ? { entities: overrides.entities } : {}),
      ...(overrides.message_thread_id != null
        ? { message_thread_id: overrides.message_thread_id }
        : {}),
      ...(overrides.reply_to_message
        ? { reply_to_message: overrides.reply_to_message as never }
        : {}),
      ...(overrides.forward_origin
        ? { forward_origin: overrides.forward_origin }
        : {}),
    } as never,
  }
}

describe("channels/tg/trigger", () => {
  it("normalizeUsername 去 @ 并小写", () => {
    expect(normalizeUsername("@PrayerBot")).toBe("prayerbot")
    expect(normalizeUsername("PrayerBot")).toBe("prayerbot")
  })

  it("utf16Slice 按 UTF-16 code unit 切片（含 emoji 代理对）", () => {
    // 👋 = U+1F44B，两个 UTF-16 code units；@prayerbot = 10
    const text = "👋@prayerbot hi"
    expect(utf16Slice(text, 0, 2)).toBe("👋")
    expect(utf16Slice(text, 2, 10)).toBe("@prayerbot")
  })

  it("isBotMentioned: mention 按 username（大小写不敏感）", () => {
    const text = "@PrayerBot 你好"
    const message = {
      text,
      entities: [{ type: "mention" as const, offset: 0, length: 10 }],
    }
    expect(isBotMentioned(message, BOT_USERNAME, BOT_ID)).toBe(true)
    expect(isBotMentioned(message, "other_bot", BOT_ID)).toBe(false)
  })

  it("isBotMentioned: text_mention 按 user.id", () => {
    const text = "Bot 你好"
    const message = {
      text,
      entities: [
        {
          type: "text_mention" as const,
          offset: 0,
          length: 3,
          user: {
            id: BOT_ID,
            is_bot: true,
            first_name: "Prayer",
          },
        },
      ],
    }
    expect(isBotMentioned(message, BOT_USERNAME, BOT_ID)).toBe(true)
    expect(isBotMentioned(message, BOT_USERNAME, 1)).toBe(false)
  })

  it("stripBotMention 用 UTF-16 偏移剥 mention", () => {
    // 👋 = 2 UTF-16 units；@prayerbot = 10
    const text = "👋@prayerbot 帮忙"
    const entities = [{ type: "mention" as const, offset: 2, length: 10 }]
    expect(stripBotMention(text, entities, BOT_USERNAME, BOT_ID)).toBe(
      "👋 帮忙"
    )
  })

  it("stripBotMention 剥 text_mention", () => {
    const text = "客服 请问"
    const entities = [
      {
        type: "text_mention" as const,
        offset: 0,
        length: 2,
        user: { id: BOT_ID, is_bot: true, first_name: "客服" },
      },
    ]
    expect(stripBotMention(text, entities, BOT_USERNAME, BOT_ID)).toBe("请问")
  })
})

describe("channels/tg/parseTelegramUpdate", () => {
  it("群 @bot → IncomingMessage（负 chatId 保留、rawText 已剥 mention）", () => {
    const text = "@PrayerBot 怎么退款"
    const update = groupUpdate({
      chatId: -1001234567890,
      text,
      entities: [{ type: "mention", offset: 0, length: 10 }],
    })
    const msg = parseTelegramUpdate(update, CTX)
    expect(msg).toMatchObject({
      channel: "tg",
      chatId: "-1001234567890",
      userId: "555",
      messageId: "42",
      rawText: "怎么退款",
      botMentioned: true,
      atList: [],
      images: [],
    })
    // 负号保留为字符串，不可 Number 丢精度/符号
    expect(msg!.chatId.startsWith("-")).toBe(true)
    expect(msg!.senderRole).toBeUndefined()
  })

  it("text_mention @bot 写入 atList 与 botMentioned", () => {
    const text = "Bot 在吗"
    const update = groupUpdate({
      text,
      entities: [
        {
          type: "text_mention",
          offset: 0,
          length: 3,
          user: { id: BOT_ID, is_bot: true, first_name: "Bot" },
        },
      ],
    })
    const msg = parseTelegramUpdate(update, CTX)!
    expect(msg.botMentioned).toBe(true)
    expect(msg.atList).toEqual([String(BOT_ID)])
    expect(msg.rawText).toBe("在吗")
  })

  it("private → null", () => {
    const update = groupUpdate({ chatType: "private", text: "hi" })
    expect(parseTelegramUpdate(update, CTX)).toBeNull()
  })

  it("channel → null", () => {
    const update = groupUpdate({ chatType: "channel", text: "hi" })
    expect(parseTelegramUpdate(update, CTX)).toBeNull()
  })

  it("forum thread（有 message_thread_id）仍解析，靠 reply_to 回同话题", () => {
    const update = groupUpdate({
      message_thread_id: 99,
      text: "@PrayerBot hi",
      entities: [{ type: "mention", offset: 0, length: 10 }],
    })
    const msg = parseTelegramUpdate(update, CTX)
    expect(msg).not.toBeNull()
    expect(msg!.botMentioned).toBe(true)
    expect(msg!.rawText).toBe("hi")
  })

  it("edited_message 忽略（仅 message）→ null", () => {
    const update: Update = {
      update_id: 2,
      edited_message: {
        message_id: 1,
        date: 1,
        chat: { id: -1001, type: "supergroup", title: "g" },
        from: { id: 1, is_bot: false, first_name: "U" },
        text: "edited",
      } as never,
    }
    expect(parseTelegramUpdate(update, CTX)).toBeNull()
  })

  it("无 @ → botMentioned false，仍解析供 buffer", () => {
    const update = groupUpdate({ text: "有人在吗" })
    const msg = parseTelegramUpdate(update, CTX)
    expect(msg).not.toBeNull()
    expect(msg).toMatchObject({
      channel: "tg",
      rawText: "有人在吗",
      botMentioned: false,
      chatId: "-1001234567890",
    })
  })

  it("negative chat id 原样保留字符串", () => {
    const update = groupUpdate({ chatId: -1009988776655 })
    const msg = parseTelegramUpdate(update, CTX)!
    expect(msg.chatId).toBe("-1009988776655")
  })

  it("group 类型也接受", () => {
    const update = groupUpdate({ chatType: "group", chatId: -12345 })
    const msg = parseTelegramUpdate(update, CTX)!
    expect(msg.chatId).toBe("-12345")
    expect(msg.channel).toBe("tg")
  })

  it("reply_to_message 填 quoted", () => {
    const update = groupUpdate({
      text: "跟进",
      reply_to_message: { text: "原问题内容" },
    })
    expect(parseTelegramUpdate(update, CTX)?.quoted).toBe("原问题内容")
  })

  it("forward_origin 尽力填 forwarded", () => {
    const update = groupUpdate({
      text: "转发正文",
      forward_origin: {
        type: "user",
        date: 1,
        sender_user: {
          id: 7,
          is_bot: false,
          first_name: "Alice",
          last_name: "L",
        },
      },
    })
    expect(parseTelegramUpdate(update, CTX)?.forwarded).toBe("Alice L")
  })

  it("无 from 的消息 → null", () => {
    const update = groupUpdate({ from: false })
    expect(parseTelegramUpdate(update, CTX)).toBeNull()
  })
})
