import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAppContext } from "@/lib/core/app-context"
import { listEnabledChats } from "@/lib/core/chat/enabled-chats"
import { ok, fail, safeApiError } from "@/lib/core/api"
import { buildGroupChatStats } from "@/lib/knowledge/reflection/stats"
import { promoteEntry } from "@/lib/knowledge/reflection/promoter"
import {
  INTERNAL_FAULT_REASONS,
  MAX_PROMOTE_ATTEMPTS,
} from "@/lib/knowledge/reflection/promote-failure"
import { embed } from "@/lib/model/embed"
import { DEFAULT_EMBED_TIMEOUT_MS, withTimeoutFn } from "@/lib/model/timeout"
import { readJsonBody, REQUEST_BODY_TOO_LARGE } from "@/lib/core/http-security"
import { withKbMutationLock } from "@/lib/knowledge/mutation-lock"
import { emitErrorSafely } from "@/lib/core/bus"
import { withAdminMutationAudit } from "@/lib/core/admin-audit-route"
import { withAdminJob } from "@/lib/core/admin-jobs"

function chatKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`
}

// 反思专页:节奏配置 + 每群进度(游标/滞后/缓冲/沉淀数) + 沉淀条目列表
export async function GET(req?: Request): Promise<NextResponse> {
  try {
    const statusParam = req ? new URL(req.url).searchParams.get("status") : null
    const statusFilter = reflectionStatusSchema.safeParse(statusParam)
    const { cfg, repo } = getAppContext()
    const now = Date.now()

    const { cursors, msg, sed } = buildGroupChatStats(repo)
    // 条目列表仍需展示,但只带预览截断(SQL 内截断):全文按需走
    // /api/reflection/entries/[id],3 秒轮询不背全量全文
    // SQL 层只取最近一页摘要;全文仍可通过 entries/[id] 按需读取。
    // status 过滤在 SQL 层完成,避免老待审被 500 条上限截断而看不到
    const entries = repo.reflectionEntrySummaries(
      300,
      200,
      500,
      statusFilter.success ? statusFilter.data : undefined
    )
    const counts = repo.countReflectionsByStatus()

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

    // 条目:附 groupId 兼容旧 UI(chatId="0" = 存量整理块的全局归属)
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
          promoteMs: cfg.reflectPromoteMs,
          promoteMinEntries: cfg.reflectPromoteMinEntries,
          promoteMaxPerRun: cfg.reflectPromoteMaxPerRun,
        },
        groups,
        entries: entryRows,
        counts,
      })
    )
  } catch (err) {
    return NextResponse.json(fail(safeApiError(err)), { status: 500 })
  }
}

const reflectionStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "promoted",
])

const patchSchema = z.object({
  id: z.number(),
  action: z.enum(["approve", "reject", "promote"]),
})

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

// 驳回 / 恢复入库 / 升格为正式 FAQ 文档(新沉淀默认 pending,approve 后才进检索)
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
    return withAdminJob(req, r, `reflection.entry_promote:${id}`, () =>
      withAdminMutationAudit(
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
              // 手动失败只留原因供页面展示,不计次:管理员反复重试不应把条目推成 failed
              if (promo.reason !== "条目不存在")
                r.recordPromoteFailure(
                  id,
                  promo.reason,
                  false,
                  MAX_PROMOTE_ATTEMPTS
                )
              // 精确匹配,不用 includes("不存在"):「目标文档不存在」也含这三个字,用子串
              // 判断会把「索引里有该 doc、磁盘上文件却丢了」这种内部一致性故障报成 404,
              // 让操作员以为条目 id 不存在——而这是本特性最不该撒的谎。
              // INTERNAL_FAULT_REASONS 是磁盘/索引/路径守卫类系统故障(非请求参数问题),
              // 映射 409 而非 400;成文校验类仍归 400。
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
            // 抛错多为超时/I/O:同样只写 note 不计次;记账本身失败不能盖掉原始错误
            try {
              r.recordPromoteFailure(
                id,
                "手动升格调用异常(超时或 I/O),可重试",
                false,
                MAX_PROMOTE_ATTEMPTS
              )
            } catch {
              // 忽略:原始错误已由下面进错误总线
            }
            return reflectionMutationFailure(err)
          }
        }
      )
    )
  } catch (err) {
    return reflectionMutationFailure(err)
  }
}
