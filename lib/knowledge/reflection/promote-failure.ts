/**
 * 升格失败分类。只有「条目自身、可重现」的失败才计入评审账本次数;系统故障与
 * 并发变化重试即可,计次会把无辜条目推成 failed。
 *
 * 刻意用白名单精确匹配而不是子串:reason 是文案,「目标文档不存在」含「条目不存在」
 * 的后几个字,子串判断会静默误判。字符串取自 apply-promote.ts / promoter.ts,
 * 改动那边请同步这里。
 */
export const INTERNAL_FAULT_REASONS: ReadonlySet<string> = new Set([
  "目标文档不存在",
  "目标文档过大,拒绝合并",
  "目标文档已存在",
  "知识库文件过大",
  "知识库路径非法",
  "台账目录非法",
])

/** 并发变化或条目状态不允许,不是条目本身的问题。 */
const TRANSIENT_REASONS: ReadonlySet<string> = new Set([
  "条目不存在",
  "已驳回,不可升格",
  "反思来源在升格期间已变化,保留原条目",
])

/** 成文失败达到该次数转 failed,不再自动重试。 */
export const MAX_PROMOTE_ATTEMPTS = 3

export function countsAsEntryFailure(reason: string): boolean {
  return !INTERNAL_FAULT_REASONS.has(reason) && !TRANSIENT_REASONS.has(reason)
}
