/**
 * 主客服 agent 的知识库「预检索注入」。
 *
 * 背景:检索原本全靠 system prompt 自觉调 kb_search。实测单轮会话 100% 会调,
 * 但 resume 续聊的长会话掉到 11%~70% —— 模型看到历史里已有片段就认为够了,
 * 后续轮直接凭记忆推断。修法是把「要不要查」从模型手里拿走:每轮消息进模型前
 * 由本模块检索并把片段拼进 user prompt;kb_search 工具保留,供片段不足时补检。
 *
 * 写法对齐既有先例 reflection-poller.ts 的 collectKbContext(embed → searchKb →
 * 按 chunk id 去重 → 截断),差别只在去重作用域从「单次调用内」变成「跨轮次的
 * sessionKey」,外加一层 distance 阈值过滤。
 */

import type { KbHit, Repo } from "../db/repo"
import { errorMessage } from "../log-context"
import { logger } from "../logger"
import { sanitizeForModel } from "./sanitize-input"

/** 每轮注入的片段条数 */
export const DEFAULT_KB_PREFETCH_TOP_K = 5
/** 向量距离上限(sqlite-vec L2,越小越近);1.0 约等于余弦相似度 0.5 */
export const DEFAULT_KB_PREFETCH_MAX_DISTANCE = 1.0
/** 单片段截断:灌库 chunk 上限 500 字,留点冗余;调小可压长会话 context 增长 */
export const DEFAULT_KB_PREFETCH_MAX_CHARS = 600
/** 检索超时:超时按 fail-open 处理,退回纯 kb_search 工具路径 */
export const DEFAULT_KB_PREFETCH_TIMEOUT_MS = 5_000
/** 去重记忆存活时长;装配层应传 cfg.resumeTtlMs 与会话续接窗口对齐 */
export const DEFAULT_MEMO_TTL_MS = 300_000
/** 去重记忆的会话数上限(LRU 淘汰) */
export const DEFAULT_MEMO_MAX_SESSIONS = 500
/** 单会话记住的 chunk id 上限;超了整体清空(宁可多注入一次,不可该注入时不注入) */
export const DEFAULT_MEMO_MAX_IDS = 200
/** embed 前的查询文本截断:整句语义足够,过长反而稀释向量 */
export const PROBE_MAX_CHARS = 1000
/** 短于此长度不检索(与 collectKbContext 的 >=4 门槛一致) */
const PROBE_MIN_CHARS = 4
/** 单次调用最多清扫的过期会话数,摊还成本 */
const SWEEP_PER_CALL = 20

export interface KbPrefetchDeps {
  repo: Pick<Repo, "searchKb">
  embed: (text: string) => Promise<Float32Array>
  topK?: number
  maxDistance?: number
  maxCharsPerHit?: number
  timeoutMs?: number
  memoTtlMs?: number
  memoMaxSessions?: number
  memoMaxIdsPerSession?: number
  /** 测试注入时钟 */
  now?: () => number
}

/**
 * 返回可直接拼进 user prompt 的文本块;无命中 / 全被去重 / 检索失败 → 空串。
 * fresh:本轮是新开对话(未 resume),模型 context 里没有任何旧片段 → 清空去重记忆。
 */
export type KbPrefetch = (
  query: string,
  sessionKey: string,
  opts?: { fresh?: boolean }
) => Promise<string>

/**
 * 进程内「本会话已注入过哪些 chunk」的记忆。
 * 去重的前提是「片段还在模型 context 里」,只有 resume 续聊才成立;
 * 新开对话必须由调用方传 fresh 强制失效(见 Agent.run)。
 * 不落库:进程重启后首轮多注入一次,可接受。
 */
export class InjectedChunkMemo {
  private m = new Map<string, { ids: Set<number>; exp: number }>()
  private ttlMs: number
  private maxSessions: number
  private maxIds: number
  private now: () => number

  constructor(
    opts: {
      ttlMs?: number
      maxSessions?: number
      maxIds?: number
      now?: () => number
    } = {}
  ) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_MEMO_TTL_MS
    this.maxSessions = opts.maxSessions ?? DEFAULT_MEMO_MAX_SESSIONS
    this.maxIds = opts.maxIds ?? DEFAULT_MEMO_MAX_IDS
    this.now = opts.now ?? Date.now
  }

  /** 惰性清扫过期项:ttl 恒定 + 命中后尾插 ⇒ Map 头部 exp 最早,遇未过期即可停 */
  private sweep(): void {
    const t = this.now()
    let swept = 0
    for (const [k, v] of this.m) {
      if (v.exp > t || swept >= SWEEP_PER_CALL) break
      this.m.delete(k)
      swept += 1
    }
  }

  /** 会话数上限:从头部(最久未用)淘汰;在写入之后调用,新写的那条在尾部不会被误删 */
  private capSessions(): void {
    while (this.m.size > this.maxSessions) {
      const oldest = this.m.keys().next()
      if (oldest.done) break
      this.m.delete(oldest.value)
    }
  }

  /** 过滤掉本会话已注入过的片段,并把保留项登记为已注入 */
  filterAndMark<T extends { id: number }>(sessionKey: string, hits: T[]): T[] {
    this.sweep()
    const t = this.now()
    const cur = this.m.get(sessionKey)
    // 无论命中与否都先 delete:Map.set 对已存在的 key 不会改插入位置,
    // 必须删掉再插才能把本会话移到尾部,维持「头部最久未用」的 LRU 顺序
    this.m.delete(sessionKey)
    let ids = !cur || cur.exp <= t ? new Set<number>() : cur.ids
    const kept = hits.filter((h) => !ids.has(h.id))
    for (const h of kept) ids.add(h.id)
    // 单会话上限:整体清空重来,失败方向偏「多注入」
    if (ids.size > this.maxIds) ids = new Set<number>()
    this.m.set(sessionKey, { ids, exp: t + this.ttlMs })
    this.capSessions()
    return kept
  }

  forget(sessionKey: string): void {
    this.m.delete(sessionKey)
  }

  size(): number {
    return this.m.size
  }
}

/** 拼注入块;编号在去重之后重排,始终从 [1] 起 */
export function formatKbBlock(hits: { content: string }[]): string {
  if (!hits.length) return ""
  const body = hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n")
  return [
    "【知识库检索结果|本轮系统已自动检索,直接据此作答】",
    body,
    "以上是针对本轮问题实时检索到的片段。请优先严格依据它们作答;若不足以回答,换关键词调用 kb_search 补检;不要凭记忆或此前轮次的印象推断。",
  ].join("\n")
}

/** 检索超时:embed 首次调用要加载本地模型,慢就放弃注入而非拖死整条 run */
async function withTimeout<T>(ms: number, task: Promise<T>): Promise<T> {
  if (ms <= 0) return task
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`预检索超时(${ms}ms)`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function makeKbPrefetch(deps: KbPrefetchDeps): KbPrefetch {
  const topK = deps.topK ?? DEFAULT_KB_PREFETCH_TOP_K
  const maxDistance = deps.maxDistance ?? DEFAULT_KB_PREFETCH_MAX_DISTANCE
  const maxChars = deps.maxCharsPerHit ?? DEFAULT_KB_PREFETCH_MAX_CHARS
  const timeoutMs = deps.timeoutMs ?? DEFAULT_KB_PREFETCH_TIMEOUT_MS
  const memo = new InjectedChunkMemo({
    ttlMs: deps.memoTtlMs,
    maxSessions: deps.memoMaxSessions,
    maxIds: deps.memoMaxIdsPerSession,
    now: deps.now,
  })

  return async (query, sessionKey, opts) => {
    const probe = query.trim()
    // 太短(纯 @ / "嗯" / 表情)语义不足以检索,直接跳过,省一次本地推理
    if (probe.length < PROBE_MIN_CHARS) return ""
    if (opts?.fresh) memo.forget(sessionKey)
    try {
      const hits: KbHit[] = await withTimeout(
        timeoutMs,
        (async () => {
          const vec = await deps.embed(probe.slice(0, PROBE_MAX_CHARS))
          // searchKb 已 ORDER BY distance,无需再排
          return deps.repo.searchKb(vec, topK)
        })()
      )
      const near = hits.filter((h) => h.distance <= maxDistance)
      const fresh = memo.filterAndMark(sessionKey, near)
      // 片段同样要过 sanitize:预检索每轮都注入,比 kb_search 的偶发 tool result
      // 暴露面大得多,不清洗可能整请求被 MiniMax new_sensitive 打成 500
      return formatKbBlock(
        fresh.map((h) => ({
          content: sanitizeForModel(h.content).slice(0, maxChars),
        }))
      )
    } catch (e) {
      // fail-open:检索挂了就退回纯 kb_search 工具路径,绝不阻断 agent.run
      logger.warn(`[kb-prefetch] 预检索失败,跳过注入: ${errorMessage(e)}`)
      return ""
    }
  }
}
