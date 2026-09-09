import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAppContext } from "@/lib/app-context"
import { listEnabledChats } from "@/lib/channels/enabled-chats"
import { ok, fail } from "@/lib/api"
import { buildGroupChatStats } from "@/lib/reflect-stats"
import { applyPromote } from "@/lib/reflect-promote"
import { embed } from "@/lib/tools/embed"

function getRepo() { return getAppContext().repo }

function chatKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`
}

// 反思专页:节奏配置 + 每群进度(游标/滞后/缓冲/沉淀数) + 沉淀条目列表
export async function GET(): Promise<NextResponse> {
  try {
    const { cfg, repo } = getAppContext()
    const now = Date.now()

    const { cursors, msg, sed } = buildGroupChatStats(repo)
    // 条目列表仍需展示,但只带预览截断(SQL 内截断):全文按需走
    // /api/reflection/entries/[id],3 秒轮询不背全量全文(compactions 同款修法)
    const entries = repo.reflectionEntrySummaries()

    const enabled = listEnabledChats(cfg)
    const ids = new Set<string>([
      ...enabled.map((c) => chatKey(c.channel, c.chatId)),
      ...cursors.keys(),
      ...msg.keys(),
    ])
    const groups = [...ids]
      .map((key) => {
        const i = key.indexOf(":")
        const channel = key.slice(0, i)
        const chatId = key.slice(i + 1)
        const cursor = cursors.get(key) ?? 0
        const gid = Number(chatId)
        return {
          channel,
          chatId,
          // 兼容旧前端(useGroupNames 按 QQ 群号)
          groupId: Number.isFinite(gid) ? gid : 0,
          cursor,
          lagMs:
            cursor === 0
              ? null
              : Math.max(0, now - cfg.reflectSettleMs - cursor),
          bufferCount: msg.get(key)?.count ?? 0,
          sedimentedCount: sed.get(key) ?? 0,
        }
      })
      .sort(
        (a, b) =>
          a.channel.localeCompare(b.channel) || a.chatId.localeCompare(b.chatId)
      )

    // 条目:附 groupId 兼容旧 UI(chatId="0" = 整理后全局归属)
    const entryRows = entries.map((e) => {
      const gid = e.chatId != null ? Number(e.chatId) : NaN
      return {
        ...e,
        groupId: Number.isFinite(gid) ? gid : null,
      }
    })

    return NextResponse.json(
      ok({
        config: {
          scanMs: cfg.reflectScanMs,
          lookbackMs: cfg.reflectLookbackMs,
          settleMs: cfg.reflectSettleMs,
          windowMax: cfg.reflectWindowMax,
          compactMs: cfg.reflectCompactMs,
          compactMinEntries: cfg.reflectCompactMinEntries,
          promoteMs: cfg.reflectPromoteMs,
          promoteMinEntries: cfg.reflectPromoteMinEntries,
          promoteMaxPerRun: cfg.reflectPromoteMaxPerRun,
        },
        groups,
        entries: entryRows,
        // 只给摘要:全文走 /api/reflection/compactions/[id](本页 3 秒轮询,全文会把响应顶到 MB 级)
        compactions: repo.recentCompactionSummaries(10),
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
  action: z.enum(["approve", "reject", "promote"]),
})

// 驳回 / 恢复入库 / 升格为正式 FAQ 文档(沉淀默认已 approved,无需审核)
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json(fail("参数非法"), { status: 400 })
    const { repo: r } = getAppContext()
    const { id, action } = parsed.data

    if (action === "approve") {
      r.setReflectionStatus(id, "approved")
      return NextResponse.json(ok({ id, status: "approved" }))
    }
    if (action === "reject") {
      r.setReflectionStatus(id, "rejected")
      return NextResponse.json(ok({ id, status: "rejected" }))
    }

    // promote: 写文件 + 向量入库 + status=promoted
    const promo = await applyPromote({ repo: r, chunkId: id, embed })
    if (!promo.ok) {
      const status = promo.reason.includes("不存在") ? 404 : 400
      return NextResponse.json(fail(promo.reason), { status })
    }
    return NextResponse.json(
      ok({
        id,
        status: "promoted",
        file: promo.file,
        already: promo.already ?? false,
      })
    )
  } catch (err) {
    return NextResponse.json(
      fail(err instanceof Error ? err.message : String(err)),
      { status: 500 }
    )
  }
}
