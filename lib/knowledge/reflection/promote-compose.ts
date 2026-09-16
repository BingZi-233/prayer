import { isKbRelPath } from "../kb-path"
import { DEFAULT_KB_CHUNK_MAX_CHARS } from "./compact-chunks"

/**
 * 升格只允许落在这批既有 retrieval 域目录下,与 docs/kb/retrieval/* 一一对应。
 * 由测试断言本列表与实际目录一致:域目录改名/新增时测试会红,而不是静默
 * 让模型把文档写到一个不存在的域里。
 */
export const RETRIEVAL_DOMAINS = [
  "advanced",
  "ccswitch",
  "cli",
  "faq",
  "foundation",
  "image",
  "legal",
  "token",
] as const

/**
 * 合并上限。目标文档超过这个段数就不再作为候选:合并会让整份文档重新分块、
 * 重新 embed,大文档(如 legal/terms.md)每次升格都全量重算,代价随文档增长。
 * 与 500 字分块配合,40 段约 2 万字。
 */
export const MAX_MERGE_CHUNKS = 40

/** slug 只允许小写英文、数字与连字符,3-40 字符:直接决定文件名。 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/

/** 第二阶段 LLM 的目标决策字段(未校验的原始值)。 */
export interface ComposeTarget {
  mode?: unknown
  doc?: unknown
  domain?: unknown
  slug?: unknown
}

/** 成文后的单元字段(未校验的原始值)。 */
export interface ComposeUnit {
  product: string
  protocol: string
  task: string
  body: string
  /** 反思原文里逐字出现过的官方 URL;没有则为空串 */
  sourceUrl: string
  volatility: string
}

export type TargetDecision =
  | { ok: true; kind: "merge"; doc: string }
  | { ok: true; kind: "new"; doc: string }
  | { ok: false; reason: string }

/**
 * 候选文档必须是 retrieval/ 下的 canonical 文档。上游 promoteEntry 已按此筛过
 * 候选,这里再拦一道:跨函数的不变量不能只活在注释里——调用方忘了过滤时,
 * merge 就会指向 promoted/ 历史层或别的非 canonical 位置。
 */
function isCanonicalTarget(rel: string): boolean {
  return rel.startsWith("retrieval/") && isKbRelPath(rel)
}

/**
 * 目标文档由程序定,不信模型输出:
 * - merge 只能精确命中本轮真实候选 doc,且该 doc 必须通过 isCanonicalTarget
 *   (不依赖调用方已经过滤好候选);
 * - new 只能落在域名白名单内,slug 必须匹配,路径由此拼出;
 * - new 撞上已存在的文件时转 merge,绝不覆盖既有 canonical 文档。
 */
export function resolveTarget(
  raw: ComposeTarget,
  candidateDocs: readonly string[],
  exists: (rel: string) => boolean
): TargetDecision {
  if (raw.mode === "merge") {
    if (typeof raw.doc !== "string") return { ok: false, reason: "缺少 doc" }
    if (!isCanonicalTarget(raw.doc))
      return { ok: false, reason: "目标文档非 retrieval/ canonical 路径" }
    if (!candidateDocs.includes(raw.doc))
      return { ok: false, reason: "目标文档不在本轮候选内" }
    return { ok: true, kind: "merge", doc: raw.doc }
  }

  if (raw.mode === "new") {
    if (typeof raw.domain !== "string" || !raw.domain)
      return { ok: false, reason: "缺少 domain" }
    if (!(RETRIEVAL_DOMAINS as readonly string[]).includes(raw.domain))
      return { ok: false, reason: "域不在白名单内" }
    if (typeof raw.slug !== "string" || !SLUG_RE.test(raw.slug))
      return { ok: false, reason: "slug 非法" }
    const rel = `retrieval/${raw.domain}/${raw.slug}.md`
    return exists(rel)
      ? { ok: true, kind: "merge", doc: rel }
      : { ok: true, kind: "new", doc: rel }
  }

  return { ok: false, reason: "target.mode 非法" }
}

/**
 * 来源 URL 只认逐字出现在反思正文/来源问答里的那些。模型很容易"顺手"补一个
 * 看起来对的链接,那属于伪造出处;宁可退回会话来源标注。
 */
export function trustedSourceUrl(
  candidate: string,
  rawSources: string
): string | null {
  const url = candidate.trim()
  if (!url) return null
  // URL 必须是纯可打印 ASCII。模型照抄时容易把紧跟其后的中文标点吞进 URL
  // (「见 https://x/a。」→ `https://x/a。`),而 \S 不排除全角标点,那样
  // `includes` 校验会一并放行,来源行就带了个假 URL 尾巴。
  // 代价:IDN 域名退回会话来源标注,可接受。
  if (!/^https?:\/\/[!-~]+$/.test(url)) return null
  return rawSources.includes(url) ? url : null
}

export interface RenderedUnit {
  content: string
  sourceStatus: string
}

const SENTENCE_END = /[。！？.!?]$/

/**
 * 按固定模板成文。标题行与正文之间**不能有空行**:ingest 与升格共用
 * splitCompactedFaq(按空行切段),标题单独成块会产出只含标题的孤立向量块。
 */
export function renderUnit(
  unit: ComposeUnit,
  opts: { chunkId: number; date: string; rawSources: string }
): RenderedUnit {
  const url = trustedSourceUrl(unit.sourceUrl, opts.rawSources)
  const sourceStatus = url ?? `QQ 群客服会话反思 #${opts.chunkId}`
  const body = unit.body.trim()
  const tail = SENTENCE_END.test(body) ? "" : "。"
  const content =
    `# 产品：${unit.product.trim()}；协议：${unit.protocol.trim()}；任务：${unit.task.trim()}\n` +
    `${body}${tail}来源：${sourceStatus}；核验日期：${opts.date}；动态性：${unit.volatility.trim()}\n`
  return { content, sourceStatus }
}

export function validateUnit(
  unit: ComposeUnit
): { ok: true } | { ok: false; reason: string } {
  for (const key of [
    "product",
    "protocol",
    "task",
    "body",
    "volatility",
  ] as const) {
    if (typeof unit[key] !== "string" || !unit[key].trim())
      return { ok: false, reason: `成文字段为空:${key}` }
  }
  return { ok: true }
}

/**
 * 单元形状检查:含空行会切出孤立标题块;超长会被 500 字规则硬切在句子中间。
 * 两种情况都拒绝,让该条留到下轮重试,而不是写一份切坏的知识。
 */
export function unitShapeIssue(content: string): string | null {
  if (/\n\s*\n/.test(content)) return "单元含空行"
  if (content.length > DEFAULT_KB_CHUNK_MAX_CHARS)
    return `单元超长(${content.length} > ${DEFAULT_KB_CHUNK_MAX_CHARS})`
  return null
}
