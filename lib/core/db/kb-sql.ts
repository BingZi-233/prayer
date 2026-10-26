/**
 * 知识检索的向量近邻 SQL(唯一事实源)。
 * 过滤 reflection_meta.status:pending(反思默认待审,审核前不得进检索)、
 * rejected(人工纠错须立刻从检索消失)与 promoted(已升格为正式文档,避免与升格文档双份占坑)。
 * 无 meta 的条目视为 approved。
 * 消费者:KnowledgeRepository.searchKb 与 cs 插件子进程的内联语句——此前
 * 插件侧内联副本漏了过滤,管理员驳回的错误知识仍会经 kb_search 工具漏给用户。
 * includePending=true 仅供反思自身(入库去重、反思上下文)看见待审条目,不得用于对用户的检索。
 *
 * 本文件不得引入任何 import:cs 子进程以 Node strip-only 模式按路径直接加载它。
 */
export function kbSearchSql(opts: { includePending: boolean }): string {
  const excluded = opts.includePending
    ? "'rejected', 'promoted'"
    : "'pending', 'rejected', 'promoted'"
  return `SELECT c.id, c.content, c.source, v.distance
     FROM kb_vec v
     JOIN kb_chunks c ON c.id = v.chunk_id
     LEFT JOIN reflection_meta m ON m.chunk_id = c.id
     WHERE v.embedding MATCH ? AND k = ?
       AND COALESCE(m.status, 'approved') NOT IN (${excluded})
     ORDER BY v.distance`
}

export const KB_SEARCH_SQL = kbSearchSql({ includePending: false })
