import {
  clearTgBypassBlocked,
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
   * Privacy 启发式：累计观察 ≥ 此条后，若几乎全是 botMentioned 则关旁路。
   * 默认 20。
   */
  privacyMinObservations?: number
  /** 非 @ 消息占比低于此阈值 → 疑似 Privacy Mode。默认 0.05 */
  privacyNonMentionShareMin?: number
}

interface CacheEntry {
  admins: Map<string, "owner" | "admin">
  fetchedAt: number
  failed: boolean
  failReason?: string
}

interface PrivacyStats {
  total: number
  nonMention: number
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

  /** 该 chat 旁路是否因 admins 失败 / Privacy 被关 */
  isBypassBlocked(chatId: string): boolean {
    const id = String(chatId)
    const c = this.cache.get(id)
    if (c?.failed) return true
    return this.privacy.get(id)?.blocked === true
  }

  bypassBlockReason(chatId: string): string | undefined {
    const id = String(chatId)
    const c = this.cache.get(id)
    if (c?.failed) return c.failReason ?? "admins-failed"
    if (this.privacy.get(id)?.blocked) return "privacy-mode?"
    return undefined
  }

  listBypassBlocks(): { chatId: string; reason: string }[] {
    const out: { chatId: string; reason: string }[] = []
    for (const [chatId, c] of this.cache) {
      if (c.failed) {
        out.push({ chatId, reason: c.failReason ?? "admins-failed" })
      }
    }
    for (const [chatId, p] of this.privacy) {
      if (p.blocked && !this.cache.get(chatId)?.failed) {
        out.push({ chatId, reason: "privacy-mode?" })
      }
    }
    return out
  }

  /**
   * 观察一条入站消息（用于 Privacy 启发式）。
   * 应在 parse/enrich 后调用；非 @ 消息会解除 privacy 封锁。
   */
  observeMessage(chatId: string, botMentioned: boolean): void {
    const id = String(chatId)
    let s = this.privacy.get(id)
    if (!s) {
      s = { total: 0, nonMention: 0, blocked: false }
      this.privacy.set(id, s)
    }
    s.total++
    if (!botMentioned) {
      s.nonMention++
      if (s.blocked) {
        s.blocked = false
        // 仅当 admins 未失败时清全局旁路封锁
        if (!this.cache.get(id)?.failed) {
          clearTgBypassBlocked(id)
        }
      }
      return
    }
    // 启发式：样本够大且几乎全是 @bot 相关
    if (
      s.total >= this.privacyMin &&
      s.nonMention / s.total < this.privacyShareMin
    ) {
      if (!s.blocked) {
        s.blocked = true
        // admins 失败优先；否则写 privacy
        if (!this.cache.get(id)?.failed) {
          setTgBypassBlocked(id, "privacy-mode?")
        }
      }
    }
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
      // 管理员拉取成功：清 admins-failed；privacy 封锁保留直至看到非 @ 消息
      const p = this.privacy.get(chatId)
      if (!p?.blocked) {
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
      // 保留 raw 便于排查，但不抛
      void msg
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
