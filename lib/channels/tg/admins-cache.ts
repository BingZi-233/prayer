import { logger } from "../../logger"
import {
  clearTgBypassBlocked,
  getTgBypassBlockReason,
  listTgBypassBlocks,
  setTgBypassBlocked,
} from "./bypass-state"

/** 与 IncomingMessage.senderRole 对齐 */
export type SenderRole = "owner" | "admin" | "member"

/** 管理员条目（creator 已映射为 owner） */
export interface AdminEntry {
  userId: string
  role: "owner" | "admin"
}

export interface AdminsCacheOpts {
  /** 拉取群管理员；失败应 throw */
  getChatAdministrators: (chatId: string) => Promise<AdminEntry[]>
  now?: () => number
  /** 缓存 TTL，默认 15 min */
  ttlMs?: number
  /**
   * Privacy 启发式：累计观察 ≥ 此条后，若几乎全是 bot 可见消息则关旁路。
   * 默认 20。
   */
  privacyMinObservations?: number
  /** 非 bot 可见消息占比低于此阈值 → 疑似 Privacy Mode。默认 0.05 */
  privacyNonMentionShareMin?: number
}

interface CacheEntry {
  admins: Map<string, "owner" | "admin">
  fetchedAt: number
  failed: boolean
  failReason?: string
}

interface PrivacyStats {
  /** 连续 bot 可见消息计数（见到非 bot 可见则清零） */
  botRelatedStreak: number
  blocked: boolean
}

const DEFAULT_TTL_MS = 15 * 60_000
const DEFAULT_PRIVACY_MIN = 20
const DEFAULT_PRIVACY_SHARE = 0.05

/**
 * 群管理员角色缓存 + Privacy 启发式。
 * - 未知 chat 首次 lookup 强制拉取
 * - TTL 过期再拉
 * - 拉取失败 → 角色回退 member，并封锁该 chat 旁路
 */
export class AdminsCache {
  private readonly getChatAdministrators: (
    chatId: string
  ) => Promise<AdminEntry[]>
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly privacyMin: number
  private readonly privacyShareMin: number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly privacy = new Map<string, PrivacyStats>()

  constructor(opts: AdminsCacheOpts) {
    this.getChatAdministrators = opts.getChatAdministrators
    this.now = opts.now ?? (() => Date.now())
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.privacyMin = opts.privacyMinObservations ?? DEFAULT_PRIVACY_MIN
    this.privacyShareMin =
      opts.privacyNonMentionShareMin ?? DEFAULT_PRIVACY_SHARE
  }

  /** 查 user 在 chat 中的角色；必要时刷新缓存 */
  async getRole(chatId: string, userId: string): Promise<SenderRole> {
    const entry = await this.ensure(chatId)
    if (entry.failed) return "member"
    return entry.admins.get(String(userId)) ?? "member"
  }

  /** 该 chat 旁路是否因 admins 失败 / Privacy 被关（以 module 状态为真相源） */
  isBypassBlocked(chatId: string): boolean {
    return getTgBypassBlockReason(String(chatId)) != null
  }

  bypassBlockReason(chatId: string): string | undefined {
    return getTgBypassBlockReason(String(chatId))
  }

  /** 与 poller 共用 module 状态，避免 reconfigure 后实例/module 双源不一致 */
  listBypassBlocks(): { chatId: string; reason: string }[] {
    return listTgBypassBlocks()
  }

  /**
   * 观察一条入站消息（用于 Privacy 启发式）。
   * `botRelated`：Privacy Mode 下仍可见的消息（@bot / 回复 bot / 命令）。
   * 非 botRelated 消息解除 privacy 封锁并**重置 streak**，避免解封 thrash。
   */
  observeMessage(chatId: string, botRelated: boolean): void {
    const id = String(chatId)
    let s = this.privacy.get(id)
    if (!s) {
      s = { botRelatedStreak: 0, blocked: false }
      this.privacy.set(id, s)
    }
    // 非 bot 可见：证明有全量消息，解封并重置窗口
    if (!botRelated) {
      s.botRelatedStreak = 0
      if (s.blocked || getTgBypassBlockReason(id) === "privacy-mode?") {
        s.blocked = false
        if (getTgBypassBlockReason(id) === "privacy-mode?") {
          clearTgBypassBlocked(id)
        }
      }
      return
    }
    s.botRelatedStreak++
    // 连续 ≥ N 条仅 bot 可见 → 疑似 Privacy Mode
    // privacyShareMin 保留配置兼容；streak 模型下等价于「几乎全 bot 可见」
    if (s.botRelatedStreak >= this.privacyMin && !s.blocked) {
      s.blocked = true
      // admins 失败优先，不覆盖
      if (getTgBypassBlockReason(id) !== "admins-failed") {
        setTgBypassBlocked(id, "privacy-mode?")
      }
    }
    void this.privacyShareMin
  }

  /** 强制刷新（测试 / 手动） */
  async refresh(chatId: string): Promise<void> {
    await this.fetch(String(chatId))
  }

  private async ensure(chatId: string): Promise<CacheEntry> {
    const id = String(chatId)
    const existing = this.cache.get(id)
    const t = this.now()
    if (existing && !existing.failed && t - existing.fetchedAt < this.ttlMs) {
      return existing
    }
    // 失败条目也按 TTL 重试
    if (existing?.failed && t - existing.fetchedAt < this.ttlMs) {
      return existing
    }
    return this.fetch(id)
  }

  private async fetch(chatId: string): Promise<CacheEntry> {
    try {
      const list = await this.getChatAdministrators(chatId)
      const admins = new Map<string, "owner" | "admin">()
      for (const a of list) {
        admins.set(String(a.userId), a.role)
      }
      const entry: CacheEntry = {
        admins,
        fetchedAt: this.now(),
        failed: false,
      }
      this.cache.set(chatId, entry)
      // 仅清 admins-failed；privacy-mode? 保留到见到非 bot 可见消息
      if (getTgBypassBlockReason(chatId) === "admins-failed") {
        clearTgBypassBlocked(chatId)
      }
      return entry
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const entry: CacheEntry = {
        admins: new Map(),
        fetchedAt: this.now(),
        failed: true,
        failReason: "admins-failed",
      }
      this.cache.set(chatId, entry)
      setTgBypassBlocked(chatId, "admins-failed")
      logger.log(
        "warn",
        `[tg] getChatAdministrators chat=${chatId} failed: ${msg}`
      )
      return entry
    }
  }
}

/**
 * 将 Telegram ChatMember 列表映射为 AdminEntry。
 * status: creator → owner, administrator → admin；其余丢弃。
 */
export function mapChatMembersToAdmins(
  members: { user?: { id?: number }; status?: string }[]
): AdminEntry[] {
  const out: AdminEntry[] = []
  for (const m of members) {
    const id = m.user?.id
    if (id == null) continue
    if (m.status === "creator") {
      out.push({ userId: String(id), role: "owner" })
    } else if (m.status === "administrator") {
      out.push({ userId: String(id), role: "admin" })
    }
  }
  return out
}
