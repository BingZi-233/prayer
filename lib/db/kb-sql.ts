/**
 * 知识检索的向量近邻 SQL(唯一事实源)。
 * 过滤 reflection_meta.status:rejected(人工纠错须立刻从检索消失)与
 * promoted(已升格为正式文档,避免与升格文档双份占坑)。
 * 消费者:KnowledgeRepository.searchKb 与 cs 插件子进程的内联语句——此前
 * 插件侧内联副本漏了过滤,管理员驳回的错误知识仍会经 kb_search 工具漏给用户。
 *
 * 本文件不得引入任何 import:cs 子进程以 Node strip-only 模式按路径直接加载它。
 */
export const KB_SEARCH_SQL = `SELECT c.id, c.content, c.source, v.distance
     FROM kb_vec v
     JOIN kb_chunks c ON c.id = v.chunk_id
     LEFT JOIN reflection_meta m ON m.chunk_id = c.id
     WHERE v.embedding MATCH ? AND k = ?
       AND COALESCE(m.status, 'approved') NOT IN ('rejected', 'promoted')
     ORDER BY v.distance`
