import { Bot, GrammyError } from "grammy"
import type { Update } from "grammy/types"
import { bus } from "../../bus"
import type { ActionSend } from "../../events"
import { logger } from "../../logger"
import { getNameCache } from "../../name-cache"
import type { Channel, ChannelCapabilities, ChannelStatus } from "../types"
import {
  AdminsCache,
  mapChatMembersToAdmins,
  type AdminEntry,
} from "./admins-cache"
import { clearAllTgBypassBlocked } from "./bypass-state"
import { enrichTelegramMessage, makeTelegramImageDownloader } from "./enrich"
import type { TelegramFileInfo } from "./media"
import { parseTelegramUpdate } from "./parse"

/** Telegram Bot API 文本上限 */
const TG_MAX_TEXT = 4096

/** long poll 超时（秒）；单实例假设见文件头注释 */
const DEFAULT_POLL_TIMEOUT_SEC = 30

/** 可注入的 TG API 面，便于单测 mock */
export interface TelegramBotApi {
  getMe(signal?: AbortSignal): Promise<{ id: number; username?: string }>
  getUpdates(
    args: {
      offset?: number
      timeout?: number
      allowed_updates?: string[]
    },
    signal?: AbortSignal
  ): Promise<Update[]>
  sendMessage(
    chatId: string | number,
    text: string,
    other?: { reply_to_message_id?: number },
    signal?: AbortSignal
  ): Promise<unknown>
  getChatAdministrators?(
    chatId: string | number,
    signal?: AbortSignal
  ): Promise<AdminEntry[]>
  getFile?(fileId: string, signal?: AbortSignal): Promise<TelegramFileInfo>
  /** 查 chat 标题;管理后台补群名用 */
  getChat?(
    chatId: string | number,
    signal?: AbortSignal
  ): Promise<{ id: number; title?: string; type: string }>
}

export interface TelegramChannelOpts {
  getOffset: () => number
  setOffset: (n: number) => void
  onStatus?: (connected: boolean) => void
  /** 缺省用 grammY Bot 包装；单测注入 mock */
  api?: TelegramBotApi
  /** getUpdates long-poll 超时秒数，默认 30 */
  pollTimeoutSec?: number
  /** 可注入 sleep（退避 / 单测加速） */
  sleep?: (ms: number) => Promise<void>
  /** 可注入 admins 缓存（单测） */
  adminsCache?: AdminsCache
  /** 可注入图片下载；传 null 禁用下载 */
  downloadImage?:
    | ((fileId: string) => Promise<import("../../events").ImageInput | null>)
    | null
}

const TG_CAPABILITIES: ChannelCapabilities = {
  canNotifyOwnAdminSurface: false,
  supportsAdminCommands: false,
  supportsMemberList: true,
  supportsGroupList: false,
  supportsMediaDownload: true,
  // 通道级 true；per-chat 由 admins-cache / Privacy 启发式关旁路
  supportsBypassPipeline: true,
}

/**
 * Telegram 通道：grammY long polling。
 *
 * **单实例假设**：同一 bot token 同一时刻只能有一个 getUpdates 消费者；
 * 多实例（pm2 cluster / 多进程）会 409 Conflict。与现网 pm2 fork 单实例一致。
 * offset 持久化键由调用方注入（runtime 用 `tg:update_offset`）。
 */
export class TelegramChannel implements Channel {
  readonly id = "tg" as const
  readonly capabilities = TG_CAPABILITIES

  private connected = false
  private stopped = true
  private lastError?: string
  private botId?: number
  private botUsername?: string
  private api: TelegramBotApi
  private abort?: AbortController
  private loopPromise?: Promise<void>
  private backoffMs = 1000
  private readonly onStatus?: (connected: boolean) => void
  private readonly getOffset: () => number
  private readonly setOffset: (n: number) => void
  private readonly pollTimeoutSec: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly adminsCache: AdminsCache
  private readonly downloadImage:
    | ((fileId: string) => Promise<import("../../events").ImageInput | null>)
    | null

  private readonly onAction = (a: ActionSend) => {
    if (a.channel !== "tg") return
    void this.sendAction(a)
  }

  constructor(
    private readonly token: string,
    opts: TelegramChannelOpts
  ) {
    this.getOffset = opts.getOffset
    this.setOffset = opts.setOffset
    this.onStatus = opts.onStatus
    this.pollTimeoutSec = opts.pollTimeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC
    this.sleep = opts.sleep ?? defaultSleep
    this.api = opts.api ?? createGrammyApi(token)
    this.adminsCache =
      opts.adminsCache ??
      new AdminsCache({
        getChatAdministrators: (chatId) => this.fetchAdmins(chatId),
      })
    if (opts.downloadImage === null) {
      this.downloadImage = null
    } else if (opts.downloadImage) {
      this.downloadImage = opts.downloadImage
    } else {
      this.downloadImage = makeTelegramImageDownloader({
        token: this.token,
        getFile: (fileId) => this.fetchFile(fileId),
      })
    }
  }

  async start(): Promise<void> {
    if (!this.stopped && this.loopPromise) return
    this.stopped = false
    this.lastError = undefined
    this.backoffMs = 1000
    bus.on("action.send", this.onAction)
    // 后台 long poll；start 立即返回，不阻塞 registry.startAll
    this.loopPromise = this.runLoop().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.log("error", `[tg] poll loop crashed: ${msg}`)
      this.lastError = msg
      this.setConnected(false)
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.abort?.abort()
    bus.off("action.send", this.onAction)
    try {
      await this.loopPromise
    } catch {
      /* runLoop 已吞错 */
    }
    this.loopPromise = undefined
    this.abort = undefined
    this.setConnected(false)
    // 清 module 旁路封锁，避免 reconfigure 后 poller 仍 skip 而 status 已空
    clearAllTgBypassBlocked()
  }

  isConnected(): boolean {
    return this.connected
  }

  status(): ChannelStatus {
    const detailParts: string[] = []
    if (this.botUsername) detailParts.push(`@${this.botUsername}`)
    detailParts.push(`offset=${this.safeOffset()}`)
    for (const b of this.adminsCache.listBypassBlocks()) {
      detailParts.push(`bypass-off:${b.chatId}:${b.reason}`)
    }
    return {
      id: this.id,
      connected: this.connected,
      lastError: this.lastError,
      detail: detailParts.join(" "),
    }
  }

  /** registry startAll 失败时写入 */
  setLastError(err: string): void {
    this.lastError = err
  }

  // ── 内部 ──────────────────────────────────────────

  private safeOffset(): number {
    try {
      return this.getOffset()
    } catch {
      return 0
    }
  }

  private setConnected(v: boolean): void {
    if (this.connected === v) return
    this.connected = v
    this.onStatus?.(v)
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        // 尚未 getMe 成功则先身份校验
        if (this.botId == null) {
          await this.ensureIdentity()
          if (this.stopped) break
        }

        this.abort = new AbortController()
        const offset = this.getOffset()
        const updates = await this.api.getUpdates(
          {
            offset,
            timeout: this.pollTimeoutSec,
            // Phase 1 只收 message；忽略 edited 等
            allowed_updates: ["message"],
          },
          this.abort.signal
        )

        if (this.stopped) break

        for (const update of updates) {
          if (this.stopped) break
          await this.handleUpdate(update)
          // offset 仅在 emit/丢弃决策之后推进（不得在 enrich 前推进）
          this.setOffset(update.update_id + 1)
        }

        // 成功一轮：重置退避
        this.backoffMs = 1000
        if (this.lastError && this.connected) {
          // 恢复后清瞬时错误（保留 detail 中的 username/offset）
          this.lastError = undefined
        }
        // timeout=0 的短轮询（单测）避免空转占满事件循环
        if (this.pollTimeoutSec <= 0 && updates.length === 0 && !this.stopped) {
          await this.sleep(10)
        }
      } catch (err) {
        if (this.stopped || isAbortError(err)) break
        await this.handlePollError(err)
      }
    }
    this.setConnected(false)
  }

  private async ensureIdentity(): Promise<void> {
    this.abort = new AbortController()
    const me = await this.api.getMe(this.abort.signal)
    if (this.stopped) return
    this.botId = me.id
    // username 可能为空（极少见）；mention 匹配依赖小写比较，空串则几乎不匹配
    this.botUsername = me.username ?? ""
    this.setConnected(true)
    this.lastError = undefined
    this.backoffMs = 1000
    logger.log(
      "info",
      `[tg] getMe ok id=${me.id} username=${this.botUsername || "(none)"}`
    )
  }

  private async handleUpdate(update: Update): Promise<void> {
    try {
      const raw = update.message
      const msg = parseTelegramUpdate(update, {
        botId: this.botId!,
        botUsername: this.botUsername ?? "",
      })
      if (!msg) {
        // 明确丢弃（私聊/频道/非 message），仍推进 offset
        return
      }
      // 群标题随消息自带,写入名称缓存(后台展示用;负 chatId 可存 INTEGER)
      cacheTelegramChatTitle(msg.chatId, raw?.chat)
      // enrich 失败仍 emit 降级消息；offset 由调用方在 await 后推进
      let enriched = msg
      try {
        if (raw) {
          enriched = await enrichTelegramMessage(msg, raw, {
            getRole: (chatId, userId) =>
              this.adminsCache.getRole(chatId, userId),
            downloadImage: this.downloadImage ?? undefined,
            observeMessage: (chatId, botRelated) =>
              this.adminsCache.observeMessage(chatId, botRelated),
            botId: this.botId,
          })
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err)
        logger.log(
          "warn",
          `[tg] enrich update ${update.update_id} failed: ${m}; emit degraded`
        )
        // 降级：至少带 member 角色
        enriched = { ...msg, senderRole: msg.senderRole ?? "member" }
      }
      bus.emit("message.received", enriched)
    } catch (err) {
      // 解析异常：记日志后仍推进 offset，避免卡死同一 update
      const m = err instanceof Error ? err.message : String(err)
      logger.log("warn", `[tg] parse update ${update.update_id} failed: ${m}`)
      bus.emit("error.occurred", { scope: "tg.parse", err })
    }
  }

  private async fetchAdmins(chatId: string): Promise<AdminEntry[]> {
    if (!this.api.getChatAdministrators) {
      throw new Error("getChatAdministrators not available")
    }
    return this.api.getChatAdministrators(chatId)
  }

  private async fetchFile(fileId: string): Promise<TelegramFileInfo> {
    if (!this.api.getFile) {
      throw new Error("getFile not available")
    }
    return this.api.getFile(fileId)
  }

  /**
   * 解析 TG 群/超级群标题:先名称缓存,miss 再 getChat 并回写。
   * 供管理后台 /api/chats/names 使用。
   */
  async resolveChatTitle(chatId: string): Promise<string | undefined> {
    const id = Number(chatId)
    if (Number.isFinite(id)) {
      const hit = getNameCache().getGroupName(id)
      if (hit) return hit
    }
    if (!this.api.getChat) return undefined
    try {
      const chat = await this.api.getChat(chatId)
      const title = chat.title?.trim()
      if (title && Number.isFinite(id)) {
        getNameCache().setGroupName(id, title)
      }
      return title || undefined
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      logger.log("warn", `[tg] getChat ${chatId} failed: ${m}`)
      return undefined
    }
  }

  private async handlePollError(err: unknown): Promise<void> {
    const code = telegramErrorCode(err)
    const msg = err instanceof Error ? err.message : String(err)
    this.lastError = code != null ? `HTTP ${code}: ${msg}` : msg
    // 401 无效 token / 409 多实例冲突：保持进程存活，退避重试
    if (code === 401 || code === 409) {
      this.setConnected(false)
      logger.log(
        "error",
        `[tg] poll fatal-ish ${code}: ${msg}; backoff ${this.backoffMs}ms (keep alive)`
      )
    } else {
      logger.log("warn", `[tg] poll error: ${msg}; backoff ${this.backoffMs}ms`)
    }
    await this.sleep(this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000)
  }

  private async sendAction(a: ActionSend): Promise<void> {
    if (!this.connected && this.botId == null) {
      logger.log("warn", "[tg] send skipped: not ready")
      return
    }
    const chunks = splitTelegramText(a.text, TG_MAX_TEXT)
    const replyTo =
      a.replyToId != null && a.replyToId !== ""
        ? Number(a.replyToId)
        : undefined
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i]!
      try {
        await this.api.sendMessage(
          a.chatId,
          text,
          // 仅首条带 reply_to，避免刷一串引用
          i === 0 && replyTo != null && Number.isFinite(replyTo)
            ? { reply_to_message_id: replyTo }
            : undefined
        )
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err)
        logger.log("error", `[tg] sendMessage failed: ${m}`)
        bus.emit("error.occurred", {
          scope: "tg.send",
          err,
          channel: "tg",
          chatId: a.chatId,
          userVisible: a.userVisibleOnFailure,
        })
        break
      }
    }
  }
}

/** 超 4096 硬拆（reply-mapper 通常已拆到更短；此处防御性） */
export function splitTelegramText(text: string, max = TG_MAX_TEXT): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    parts.push(rest.slice(0, max))
    rest = rest.slice(max)
  }
  if (rest) parts.push(rest)
  return parts
}

function createGrammyApi(token: string): TelegramBotApi {
  const bot = new Bot(token)
  // grammY 依赖的 abort-controller 与 DOM AbortSignal 类型不兼容，运行时一致
  const sig = (s?: AbortSignal) => s as never
  return {
    getMe: (signal) =>
      bot.api.getMe(sig(signal)).then((u) => ({
        id: u.id,
        username: u.username,
      })),
    getUpdates: (args, signal) =>
      bot.api.getUpdates(args as never, sig(signal)),
    sendMessage: (chatId, text, other, signal) =>
      bot.api.sendMessage(chatId, text, other, sig(signal)),
    getChatAdministrators: async (chatId, signal) => {
      const members = await bot.api.getChatAdministrators(chatId, sig(signal))
      return mapChatMembersToAdmins(members)
    },
    getFile: async (fileId, signal) => {
      const f = await bot.api.getFile(fileId, sig(signal))
      return { file_path: f.file_path, file_size: f.file_size }
    },
    getChat: async (chatId, signal) => {
      const c = await bot.api.getChat(chatId, sig(signal))
      return {
        id: c.id,
        title: "title" in c ? c.title : undefined,
        type: c.type,
      }
    },
  }
}

/** 从 Update.message.chat 提取 title 写入 NameCache(可单测) */
export function cacheTelegramChatTitle(
  chatId: string,
  chat: { title?: string } | undefined | null
): void {
  const title = chat?.title?.trim()
  if (!title) return
  const id = Number(chatId)
  if (!Number.isFinite(id)) return
  try {
    getNameCache().setGroupName(id, title)
  } catch {
    /* 缓存失败不阻断入站 */
  }
}

function telegramErrorCode(err: unknown): number | undefined {
  if (err instanceof GrammyError) return err.error_code
  if (err && typeof err === "object" && "error_code" in err) {
    const c = (err as { error_code: unknown }).error_code
    return typeof c === "number" ? c : undefined
  }
  return undefined
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const name = (err as { name?: string }).name
  if (name === "AbortError") return true
  // grammY / undici 取消可能包一层
  const msg = err instanceof Error ? err.message : ""
  return /aborted|abort/i.test(msg) && name === "DOMException"
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
