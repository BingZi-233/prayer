import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sharedDb } from "@/lib/db/shared"
import { Repo } from "@/lib/db/repo"
import { getConfig } from "@/lib/config-store"
import { getGroupPolicy, listEnabledChats, policyKey } from "@/lib/channels/enabled-chats"
import type { ChannelId } from "@/lib/channels/types"
import { ok, fail } from "@/lib/api"

function getRepo(): Repo {
  const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")))
  return new Repo(sharedDb(cfg.dbPath))
}

function chatKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`
}

// 主动回复专页:节奏配置 + 每群(游标/滞后/主动回复数) + 最近插话列表
export async function GET(): Promise<NextResponse> {
  try {
    const cfg = getConfig(new Repo(sharedDb(process.env.DB_PATH ?? "./data/agent.db")))
    const repo = new Repo(sharedDb(cfg.dbPath))
    const now = Date.now()

    const counts = new Map(
      repo.proactiveGroupCounts().map((c) => [chatKey(c.channel, c.chatId), c])
    )
    const enabled = listEnabledChats(cfg)
    const cursors = new Map<string, number>()
    for (const c of enabled) {
      cursors.set(
        chatKey(c.channel, c.chatId),
        repo.groupProactiveCursor(c.channel, c.chatId)
      )
    }

    const ids = new Set<string>([
      ...enabled.map((c) => chatKey(c.channel, c.chatId)),
      ...counts.keys(),
    ])
    // 管理面会话不展示
    const adminKey = cfg.adminSurface
      ? chatKey(cfg.adminSurface.channel, cfg.adminSurface.chatId)
      : null

    const groups = [...ids]
      .filter((key) => key !== adminKey)
      .map((key) => {
        const i = key.indexOf(":")
        const channel = key.slice(0, i) as ChannelId
        const chatId = key.slice(i + 1)
        const cursor =
          cursors.get(key) ?? repo.groupProactiveCursor(channel, chatId)
        const c = counts.get(key)
        const policy = getGroupPolicy(cfg, channel, chatId)
        const silence = policy?.proactiveSilenceMs ?? cfg.proactiveSilenceMs
        const proactiveOn =
          policy?.proactiveEnabled !== undefined
            ? policy.proactiveEnabled
            : cfg.proactiveEnabled
        // QQ-only UI: groupId 数字;其它通道 Number 可能 NaN,前端仍可用 chatId
        const groupIdNum = Number(chatId)
        return {
          channel,
          chatId,
          // 兼容旧前端字段(useGroupNames 仍按 QQ 群号)
          groupId: Number.isFinite(groupIdNum) ? groupIdNum : 0,
          enabled: enabled.some(
            (e) => e.channel === channel && e.chatId === chatId
          ),
          proactiveEnabled: proactiveOn,
          cursor,
          // 游标落后当前沉默前沿多久(与 poller 的 until = now - silenceMs 对齐)
          lagMs: cursor === 0 ? null : Math.max(0, now - silence - cursor),
          replyCount: c?.count ?? 0,
          lastReplyTs: c?.lastTs ?? null,
          policyKey: policyKey(channel, chatId),
        }
      })
      .sort(
        (a, b) =>
          a.channel.localeCompare(b.channel) || a.chatId.localeCompare(b.chatId)
      )

    // 回复列表:附 groupId 数字字段兼容旧 UI(useGroupNames)
    const replies = repo.proactiveReplies(50).map((r) => {
      const gid = Number(r.chatId)
      return {
        ...r,
        groupId: Number.isFinite(gid) ? gid : 0,
      }
    })

    return NextResponse.json(
      ok({
        config: {
          enabled: cfg.proactiveEnabled,
          scanMs: cfg.proactiveScanMs,
          silenceMs: cfg.proactiveSilenceMs,
          maxPerScan: cfg.proactiveMaxPerScan,
        },
        total: repo.proactiveTotalCount(),
        groups,
        replies,
      })
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}

const patchSchema = z.object({
  id: z.number(),
  quality: z.enum(["ok", "bad"]),
})

// 质检:标主动回复为恰当 / 不当
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json(fail("参数非法"), { status: 400 })
    const okk = getRepo().setProactiveQuality(
      parsed.data.id,
      parsed.data.quality
    )
    if (!okk) return NextResponse.json(fail("记录不存在"), { status: 404 })
    return NextResponse.json(
      ok({ id: parsed.data.id, quality: parsed.data.quality })
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
