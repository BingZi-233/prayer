import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import { bus } from "../bus"
import { logger } from "../logger"
import type { Repo } from "../db/repo"
import { embed as defaultEmbed } from "../tools/embed"
import { applyPromote } from "../reflect-promote"
import { noToolQueryOptions, drainQuery } from "./agent"

export interface ReflectionPromoterDeps {
  repo: Repo
  adminGroupId: number
  /** 升格周期。缺省 24h;≤0 时装配层不注册 */
  promoteMs?: number
  scanMs?: number
  firstDelayMs?: number
  /** 候选条目至少这么多才调 LLM。缺省 1 */
  minEntries?: number
  /** 单轮最多升格条数,防一次冲太猛。缺省 5 */
  maxPerRun?: number
  baseContextK?: number
  notifyAdmin?: boolean
  embed?: (text: string) => Promise<Float32Array>
  queryFn?: typeof sdkQuery
  now?: () => number
  /** 测试可注入升格实现 */
  promoteFn?: typeof applyPromote
  cwd?: string
}

interface Resolved {
  repo: Repo
  adminGroupId: number
  minEntries: number
  maxPerRun: number
  baseContextK: number
  notifyAdmin: boolean
  embed: (text: string) => Promise<Float32Array>
  queryFn: typeof sdkQuery
  now: () => number
  promoteFn: typeof applyPromote
  cwd?: string
}

export const PROMOTE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number", description: "候选条目 id" },
          promote: { type: "boolean", description: "是否升格为正式文档" },
          reason: { type: "string", description: "简短理由" },
        },
        required: ["id", "promote", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions"],
  additionalProperties: false,
} as const

const PROMOTE_SYSTEM = `你是客服知识库升格评审助手。反思条目是从人工有效答复中自动沉淀的自学习知识,已在检索库中可用。
「升格」= 固化为正式产品文档(docs/kb/promoted/),长期维护、与基础文档同等权威。
用户消息给出:
一、【权威基础文档片段】——相关正式文档摘录。
二、【候选反思条目】——尚未升格的 FAQ,每条带 id。

对每条候选决定 promote true/false,规则(偏保守:不确定则 false):
应升格(promote=true):
- 可复用、完整、脱离具体会话仍成立的通用 FAQ/操作步骤
- 信息准确、含关键细节(步骤/条件/例外/数字)
- 基础文档未覆盖,或反思提供了正式文档缺少的实操细节/边界 case
- 对客服/用户反复有用的稳定知识

不应升格(promote=false):
- 一次性、时效性强、绑定某用户/订单
- 信息不足、含糊、可能过时
- 与基础文档明确矛盾
- 基础文档已完整讲清且反思无增量
- 闲聊、寒暄、隐私(手机号/订单号)

硬约束:只能对给出的 id 决策,不得编造 id;不得修改 FAQ 正文。
输出 JSON Schema 强制为 {"decisions":[{"id":number,"promote":boolean,"reason":string}]}。
每条候选都应有一条 decision;若全部不升格也返回完整 decisions。`

function resolve(deps: ReflectionPromoterDeps): Resolved {
  return {
    repo: deps.repo,
    adminGroupId: deps.adminGroupId,
    minEntries: deps.minEntries ?? 1,
    maxPerRun: deps.maxPerRun ?? 5,
    baseContextK: deps.baseContextK ?? 3,
    notifyAdmin: deps.notifyAdmin ?? true,
    embed: deps.embed ?? defaultEmbed,
    queryFn: deps.queryFn ?? sdkQuery,
    now: deps.now ?? (() => Date.now()),
    promoteFn: deps.promoteFn ?? applyPromote,
    cwd: deps.cwd,
  }
}

type Decision = { id: number; promote: boolean; reason: string }

// 只信 SDK structured_output(schema 已强制 decisions 形状);不做文本 JSON 二次解析。
function decisionsFromPayload(
  structured: unknown | undefined
): Decision[] | null {
  if (!structured || typeof structured !== "object") return null
  const arr = (structured as { decisions?: unknown }).decisions
  if (!Array.isArray(arr)) return null
  const out: Decision[] = []
  for (const it of arr) {
    if (!it || typeof it !== "object") continue
    const o = it as { id?: unknown; promote?: unknown; reason?: unknown }
    if (typeof o.id !== "number" || !Number.isFinite(o.id)) continue
    if (typeof o.promote !== "boolean") continue
    out.push({
      id: o.id,
      promote: o.promote,
      reason: typeof o.reason === "string" ? o.reason : "",
    })
  }
  return out
}

/** 校验决策:只保留候选 id 内的;promote=true 截断到 maxPerRun */
export function selectPromoteIds(
  decisions: Decision[] | null,
  candidateIds: number[],
  maxPerRun: number
): { ok: true; ids: number[] } | { ok: false; reason: string } {
  if (!decisions) return { ok: false, reason: "无法解析 decisions" }
  const allowed = new Set(candidateIds)
  const ids: number[] = []
  const seen = new Set<number>()
  for (const d of decisions) {
    if (!d.promote) continue
    if (!allowed.has(d.id)) continue // 忽略编造 id
    if (seen.has(d.id)) continue
    seen.add(d.id)
    ids.push(d.id)
    if (ids.length >= maxPerRun) break
  }
  return { ok: true, ids }
}

export async function runPromote(
  deps: ReflectionPromoterDeps
): Promise<{ considered: number; promoted: number }> {
  const d = resolve(deps)
  const candidates = d.repo
    .reflectionEntries()
    .filter((e) => e.status === "approved")
  if (candidates.length < d.minEntries)
    return { considered: candidates.length, promoted: 0 }

  try {
    const ctx = new Map<number, string>()
    for (const e of candidates) {
      for (const h of d.repo.searchBaseKb(
        await d.embed(e.content),
        d.baseContextK
      )) {
        ctx.set(h.id, h.content)
      }
    }
    const baseBlock = [...ctx.values()]
      .map((c, i) => `(${i + 1}) ${c}`)
      .join("\n")
    const candBlock = candidates
      .map(
        (e) =>
          `[id=${e.id}] ${e.content}${e.question || e.answer ? ` | 来源问:${e.question ?? ""} 答:${e.answer ?? ""}` : ""}`
      )
      .join("\n")
    const prompt = `【权威基础文档片段】\n${baseBlock || "(无)"}\n\n【候选反思条目】\n${candBlock}`

    const { structuredOutput } = await drainQuery(
      d.queryFn({
        prompt,
        options: noToolQueryOptions({
          systemPrompt: PROMOTE_SYSTEM,
          outputFormat: { type: "json_schema", schema: PROMOTE_OUTPUT_SCHEMA },
          thinking: { type: "disabled" },
          canUseTool: async () => ({
            behavior: "deny" as const,
            message: "升格阶段不使用工具",
          }),
          maxTurns: 2,
        }) as never,
      }) as AsyncIterable<any>,
      "promote"
    )

    const decisions = decisionsFromPayload(structuredOutput)
    const selected = selectPromoteIds(
      decisions,
      candidates.map((c) => c.id),
      d.maxPerRun
    )
    if (!selected.ok) {
      logger.log(
        "warn",
        `[reflection-promote] 校验失败(${selected.reason}),本轮不升格`
      )
      bus.emit("error.occurred", {
        scope: "reflection-promote",
        err: new Error(`LLM 产出未过校验:${selected.reason}`),
      })
      return { considered: candidates.length, promoted: 0 }
    }

    let promoted = 0
    for (const id of selected.ids) {
      const r = await d.promoteFn({
        repo: d.repo,
        chunkId: id,
        embed: d.embed,
        cwd: d.cwd,
      })
      if (r.ok && !r.already) {
        promoted++
        if (d.notifyAdmin) {
          const preview =
            r.content.slice(0, 40) + (r.content.length > 40 ? "…" : "")
          bus.emit("action.send", {
            action: "send_group_msg",
            groupId: d.adminGroupId,
            text: `反思自动升格: #${id} → ${r.file}\n${preview}`,
          })
        }
      } else if (!r.ok) {
        logger.log("warn", `[reflection-promote] 升格 #${id} 失败: ${r.reason}`)
      }
    }

    if (promoted > 0) {
      logger.log(
        "info",
        `[reflection-promote] ${candidates.length} 候选 → 升格 ${promoted} 条`
      )
    }
    return { considered: candidates.length, promoted }
  } catch (err) {
    bus.emit("error.occurred", { scope: "reflection-promote", err })
    return { considered: candidates.length, promoted: 0 }
  }
}

export function registerReflectionPromoter(
  deps: ReflectionPromoterDeps
): () => void {
  const promoteMs = deps.promoteMs ?? 86_400_000
  const scanMs = deps.scanMs ?? Math.min(promoteMs, 3_600_000)
  const now = deps.now ?? (() => Date.now())
  const repo = deps.repo
  let running = false
  const tick = () => {
    if (running) return
    if (now() - repo.promoteAt() < promoteMs) return
    running = true
    logger.log("info", "[reflection-promote] due, running")
    void runPromote(deps)
      .catch((err) =>
        bus.emit("error.occurred", { scope: "reflection-promote", err })
      )
      .finally(() => {
        repo.setPromoteAt(now())
        running = false
      })
  }
  const timer = setInterval(tick, scanMs)
  const kick = setTimeout(tick, deps.firstDelayMs ?? 45_000) // 略晚于 compact 首刷
  return () => {
    clearInterval(timer)
    clearTimeout(kick)
  }
}
