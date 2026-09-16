import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAppContext } from "@/lib/core/app-context"
import { listEnabledChats } from "@/lib/core/chat/enabled-chats"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { buildGroupChatStats } from "@/lib/knowledge/reflection/stats"
import { promoteEntry } from "@/lib/knowledge/reflection/promoter"
import { embed } from "@/lib/model/embed"
import { DEFAULT_EMBED_TIMEOUT_MS, withTimeoutFn } from "@/lib/model/timeout"
import { readJsonBody, REQUEST_BODY_TOO_LARGE } from "@/lib/core/http-security"
import { withKbMutationLock } from "@/lib/knowledge/mutation-lock"
import { emitErrorSafely } from "@/lib/core/bus"
import { withAdminMutationAudit } from "@/lib/core/admin-audit-route"

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
    // SQL 层只取最近一页摘要;全文仍可通过 entries/[id] 按需读取。
    const entries = repo.reflectionEntrySummaries(300, 200, 500)

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
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

const patchSchema = z.object({
  id: z.number(),
  action: z.enum(["approve", "reject", "promote"]),
})

/**
 * 这些 reason 表示系统内部不一致(不是调用方请求有问题),映射成 409 而不是 400,
 * 免得把「磁盘与索引对不上」误导成「你参数写错了」。
 *
 * 入选依据:文件系统/索引一致性、路径守卫、容量上限——这些都发生在表单参数与
 * 条目 id 都已校验通过之后,失败源于系统自身状态(磁盘、索引、KB 布局),调用方
 * 重试也只是撞同一堵墙。反之「已驳回,不可升格」是正常业务状态,不属故障;
 * 成文校验类(单元超长/含空行/域不在白名单内…)是模型产出不合规,仍归 400。
 *
 * 刻意用白名单而不是前缀/子串匹配:reason 是文案,子串判断会随文案改动静默失效
 * ——「目标文档不存在」含「条目不存在」的后三个字,子串判断会把它误报成 404。
 * 字符串取自 lib/knowledge/reflection/apply-promote.ts,改动那边请同步这里。
 */
const INTERNAL_FAULT_REASONS = new Set([
  "目标文档不存在",
  "目标文档过大,拒绝合并",
  "目标文档已存在",
  "知识库文件过大",
  "知识库路径非法",
  "台账目录非法",
])

const reflectionAuditAction = {
  approve: "reflection.approve",
  reject: "reflection.reject",
  promote: "reflection.entry_promote",
} as const

function reflectionMutationFailure(err: unknown): NextResponse {
  // Keep manual failures on the error bus even when the audit wrapper receives
  // a returned 500 response instead of a thrown exception.
  emitErrorSafely({ scope: "reflection-promote", err, userVisible: false })
  return NextResponse.json(fail(safeApiError(err)), { status: 500 })
}

// 驳回 / 恢复入库 / 升格为正式 FAQ 文档(沉淀默认已 approved,无需审核)
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await readJsonBody(req)
    if (body === REQUEST_BODY_TOO_LARGE)
      return NextResponse.json(fail("请求体过大"), { status: 413 })
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json(fail("参数非法"), { status: 400 })
    const { id, action } = parsed.data

    if (action !== "promote") {
      const status = action === "approve" ? "approved" : "rejected"
      return await withKbMutationLock(async () => {
        const { repo: r } = getAppContext()
        return withAdminMutationAudit(
          r,
          {
            action: reflectionAuditAction[action],
            route: "/api/reflection",
            method: "PATCH",
          },
          () => {
            try {
              if (!r.reflectionEntryDetail(id))
                return NextResponse.json(fail("条目不存在"), { status: 404 })
              if (!r.setReflectionStatus(id, status))
                return NextResponse.json(fail("条目不存在"), { status: 404 })
              return NextResponse.json(ok({ id, status }))
            } catch (err) {
              return reflectionMutationFailure(err)
            }
          }
        )
      })
    }

    // promote: 成文 → 写文件 + 向量入库 + status=promoted
    // 必须与定时升格走同一条路径,否则手动升格会产出不合规的旧格式文档。
    const { repo: r } = getAppContext()
    return withAdminMutationAudit(
      r,
      {
        action: reflectionAuditAction.promote,
        route: "/api/reflection",
        method: "PATCH",
      },
      async () => {
        try {
          const promo = await promoteEntry({
            repo: r,
            chunkId: id,
            // 手动路径没有 resolve() 那层包装,裸 embed 会让 HTTP 请求一直等一个挂死的
            // 本地 embedding(冷启动加载模型实测可达 20s+);定时路径由 promoter 的
            // resolve() 负责套超时,这里得自己套。
            embed: withTimeoutFn(DEFAULT_EMBED_TIMEOUT_MS, embed),
          })
          if (!promo.ok) {
            // 精确匹配,不用 includes("不存在"):「目标文档不存在」也含这三个字,用子串
            // 判断会把「索引里有该 doc、磁盘上文件却丢了」这种内部一致性故障报成 404,
            // 让操作员以为条目 id 不存在——而这是本特性最不该撒的谎。
            const status =
              promo.reason === "条目不存在"
                ? 404
                : INTERNAL_FAULT_REASONS.has(promo.reason)
                  ? 409
                  : 400
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
          return reflectionMutationFailure(err)
        }
      }
    )
  } catch (err) {
    return reflectionMutationFailure(err)
  }
}
