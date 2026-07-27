import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { Update } from "grammy/types"
import { bus } from "@/lib/bus"
import type { ActionSend, IncomingMessage } from "@/lib/events"
import {
  TelegramChannel,
  splitTelegramText,
  type TelegramBotApi,
} from "@/lib/channels/tg/client"
import { _resetTgBypassStateForTests } from "@/lib/channels/tg/bypass-state"

function groupUpdate(updateId: number, text = "hi"): Update {
  return {
    update_id: updateId,
    message: {
      message_id: 10 + updateId,
      date: 1_700_000_000,
      chat: { id: -100111, type: "supergroup", title: "g" } as never,
      from: { id: 55, is_bot: false, first_name: "u" },
      text,
    } as never,
  }
}

function privateUpdate(updateId: number): Update {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 99, type: "private", first_name: "x" } as never,
      from: { id: 99, is_bot: false, first_name: "x" },
      text: "secret",
    } as never,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 可控 mock：按队列吐 updates */
function makeMockApi(opts?: {
  getMeError?: Error
  /** 每批 updates；耗尽后返回 [] */
  updatesQueue?: Update[][]
  /** getUpdates 挂起直到 abort（测 stop） */
  hangUntilAbort?: boolean
  /** 仅第 1 次 getUpdates 挂起直到 abort（测硬超时后循环继续） */
  hangFirstCall?: boolean
  admins?: { userId: string; role: "owner" | "admin" }[]
  adminsError?: Error
}): TelegramBotApi & {
  sent: { chatId: string | number; text: string; replyTo?: number }[]
  getUpdatesCalls: number
  adminCalls: number
} {
  const sent: { chatId: string | number; text: string; replyTo?: number }[] = []
  let batchIdx = 0
  const queue = opts?.updatesQueue ?? []
  const api = {
    sent,
    getUpdatesCalls: 0,
    adminCalls: 0,
    async getMe() {
      if (opts?.getMeError) throw opts.getMeError
      return { id: 900001, username: "PrayerBot" }
    },
    async getUpdates(
      args: { offset?: number; timeout?: number },
      signal?: AbortSignal
    ) {
      api.getUpdatesCalls++
      const hang =
        opts?.hangUntilAbort ||
        (opts?.hangFirstCall && api.getUpdatesCalls === 1)
      if (hang) {
        await new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) {
            const e = new Error("aborted")
            e.name = "AbortError"
            reject(e)
            return
          }
          signal?.addEventListener(
            "abort",
            () => {
              const e = new Error("aborted")
              e.name = "AbortError"
              reject(e)
            },
            { once: true }
          )
        })
      }
      if (signal?.aborted) {
        const e = new Error("aborted")
        e.name = "AbortError"
        throw e
      }
      const batch = queue[batchIdx] ?? []
      batchIdx++
      const offset = args.offset ?? 0
      return batch.filter((u) => u.update_id >= offset)
    },
    async sendMessage(
      chatId: string | number,
      text: string,
      other?: { reply_to_message_id?: number }
    ) {
      sent.push({
        chatId,
        text,
        replyTo: other?.reply_to_message_id,
      })
      return {}
    },
    async getChatAdministrators() {
      api.adminCalls++
      if (opts?.adminsError) throw opts.adminsError
      return opts?.admins ?? [{ userId: "55", role: "admin" as const }]
    },
    async getFile() {
      return { file_path: "photos/x.jpg", file_size: 3 }
    },
  }
  return api
}

async function waitFor(
  pred: () => boolean,
  label: string,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting: ${label}`)
    }
    await delay(10)
  }
}

describe("splitTelegramText", () => {
  it("短文本不拆", () => {
    expect(splitTelegramText("abc", 10)).toEqual(["abc"])
  })

  it("超长按 max 硬拆", () => {
    const s = "a".repeat(10)
    expect(splitTelegramText(s, 4)).toEqual(["aaaa", "aaaa", "aa"])
  })
})

describe("TelegramChannel", () => {
  let offset = 0
  let received: IncomingMessage[] = []
  let onMsg: (m: IncomingMessage) => void
  let channels: TelegramChannel[] = []

  beforeEach(() => {
    offset = 0
    received = []
    channels = []
    _resetTgBypassStateForTests()
    onMsg = (m) => received.push(m)
    bus.on("message.received", onMsg)
  })

  afterEach(async () => {
    for (const ch of channels) {
      try {
        await ch.stop()
      } catch {
        /* ignore */
      }
    }
    bus.off("message.received", onMsg)
    bus.removeAllListeners("action.send")
    bus.removeAllListeners("error.occurred")
  })

  function track(ch: TelegramChannel): TelegramChannel {
    channels.push(ch)
    return ch
  }

  it("getMe 成功后 connected，status 含 username 与 offset", async () => {
    const api = makeMockApi({ updatesQueue: [[]] })
    const ch = track(
      new TelegramChannel("tok", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 0,
        sleep: (ms) => delay(ms),
      })
    )
    await ch.start()
    await waitFor(() => ch.isConnected(), "connected")
    const st = ch.status()
    expect(st.id).toBe("tg")
    expect(st.connected).toBe(true)
    expect(st.detail).toContain("@PrayerBot")
    expect(st.detail).toContain("offset=0")
    await ch.stop()
    expect(ch.isConnected()).toBe(false)
  })

  it("群消息 parse 后 enrich senderRole 再 emit 并推进 offset；私聊丢弃仍推进", async () => {
    const api = makeMockApi({
      updatesQueue: [[groupUpdate(5, "hello group"), privateUpdate(6)], []],
      admins: [{ userId: "55", role: "admin" }],
    })
    const ch = track(
      new TelegramChannel("tok", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 0,
        sleep: (ms) => delay(ms),
        downloadImage: null, // 单测不走真实下载
      })
    )
    await ch.start()
    await waitFor(() => received.length === 1, "message.received")
    await waitFor(() => offset === 7, "offset=7")
    expect(received[0]!.channel).toBe("tg")
    expect(received[0]!.chatId).toBe("-100111")
    expect(received[0]!.rawText).toBe("hello group")
    expect(received[0]!.senderRole).toBe("admin")
    expect(api.adminCalls).toBeGreaterThanOrEqual(1)
  })

  it("admins 失败时仍 emit 降级消息并推进 offset，status 含 bypass-off", async () => {
    const api = makeMockApi({
      updatesQueue: [[groupUpdate(8, "hi")], []],
      adminsError: new Error("forbidden"),
    })
    const ch = track(
      new TelegramChannel("tok", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 0,
        sleep: (ms) => delay(ms),
        downloadImage: null,
      })
    )
    await ch.start()
    await waitFor(() => received.length === 1, "message.received")
    await waitFor(() => offset === 9, "offset=9")
    expect(received[0]!.senderRole).toBe("member")
    expect(ch.status().detail).toMatch(/bypass-off:-100111:admins-failed/)
  })

  it("channel.send 仅处理 channel=tg，超长文本拆分，首条带 reply", async () => {
    const api = makeMockApi({ updatesQueue: [[]] })
    const ch = track(
      new TelegramChannel("tok", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 0,
        sleep: (ms) => delay(ms),
      })
    )
    await ch.start()
    await waitFor(() => ch.isConnected(), "connected")

    // 非 tg 动作应被忽略（防御）
    await ch.send({
      channel: "qq",
      chatId: "1",
      text: "nope",
    })
    expect(api.sent).toHaveLength(0)

    const long = "x".repeat(4096 + 10)
    await ch.send({
      channel: "tg",
      chatId: "-100111",
      text: long,
      replyToId: "42",
    } satisfies ActionSend)
    await waitFor(() => api.sent.length === 2, "two sendMessage")
    expect(api.sent[0]!.chatId).toBe("-100111")
    expect(api.sent[0]!.text.length).toBe(4096)
    expect(api.sent[0]!.replyTo).toBe(42)
    expect(api.sent[1]!.text.length).toBe(10)
    expect(api.sent[1]!.replyTo).toBeUndefined()

    // 不订阅 bus：直接 emit 不应触发 send
    const before = api.sent.length
    bus.emit("action.send", {
      channel: "tg",
      chatId: "-1",
      text: "no-bus",
    })
    await delay(30)
    expect(api.sent.length).toBe(before)
  })

  it("401 记 lastError 并退避，进程不崩", async () => {
    const err = Object.assign(new Error("Unauthorized"), { error_code: 401 })
    let sleeps = 0
    const api = makeMockApi({ getMeError: err })
    const ch = track(
      new TelegramChannel("bad", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 0,
        // 必须 yield 事件循环，否则 tight loop 卡死
        sleep: async () => {
          sleeps++
          await delay(5)
        },
      })
    )
    await ch.start()
    await waitFor(() => !!ch.status().lastError, "lastError")
    expect(ch.status().lastError).toMatch(/401/)
    expect(ch.isConnected()).toBe(false)
    await waitFor(() => sleeps >= 1, "backoff sleep")
  })

  it("stop 中止 in-flight getUpdates 并退出 loop", async () => {
    const api = makeMockApi({ hangUntilAbort: true })
    const ch = track(
      new TelegramChannel("tok", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 30,
        sleep: (ms) => delay(ms),
      })
    )
    await ch.start()
    await waitFor(() => ch.isConnected(), "connected")
    // 给 getUpdates 挂起一点时间
    await delay(20)
    await ch.stop()
    expect(ch.isConnected()).toBe(false)
  })

  it("getUpdates 卡死 → 硬超时后循环继续,下一轮仍能收到消息", async () => {
    const api = makeMockApi({
      hangFirstCall: true,
      updatesQueue: [[groupUpdate(11, "after timeout")], []],
      admins: [{ userId: "55", role: "admin" }],
    })
    const ch = track(
      new TelegramChannel("tok", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 0,
        pollDeadlineMs: 50,
        sleep: (ms) => delay(Math.min(ms, 20)),
        downloadImage: null,
      })
    )
    await ch.start()
    await waitFor(() => received.length === 1, "超时后仍收到消息", 4000)
    expect(received[0]!.rawText).toBe("after timeout")
    expect(api.getUpdatesCalls).toBeGreaterThanOrEqual(2)
    expect(ch.status().detail).toContain("poll-timeouts=1")
  })
})
