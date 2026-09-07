import type { KnowledgeRepository } from "../db/repositories/knowledge.ts"

type EmbedFn = (text: string) => Promise<Float32Array>

// 知识库语义检索纯函数:embed → 向量近邻 → 拼片段文本。
// cs 插件子进程(plugins/cs/scripts/cs-mcp.ts)复用此实现,避免检索/格式逻辑漂移。
export const KB_TOOL_DESC =
  "语义检索产品知识库(注册/令牌/CLI 接入/绘图/条款/FAQ 等文档 + 人工沉淀)。回答任何产品、业务、接入配置、故障排查等事实性问题前必须先调用,并严格依据返回片段作答,不得凭记忆编造。参数 query 传用户问题或检索关键词(整句自然语言比堆关键词更准)。返回语义最相近的 top-5 片段(格式 [1]…[2]…),无命中时返回「知识库无相关内容。」。"

/**
 * 知识检索的向量近邻 SQL(唯一事实源)。
 * 过滤 reflection_meta.status:rejected(人工纠错须立刻从检索消失)与
 * promoted(已升格为正式文档,避免与升格文档双份占坑)。
 * repo.searchKb 与 cs 插件子进程的内联语句共用本常量——此前插件侧内联副本
 * 漏了过滤,管理员驳回的错误知识仍会经 kb_search 工具漏给用户。
 * 注意:cs 子进程是 Node strip-only 运行,不能 import repo.ts(参数属性),
 * 本文件只允许 import type,保持可被子进程安全加载。
 */
export const KB_SEARCH_SQL = `SELECT c.id, c.content, c.source, v.distance
     FROM kb_vec v
     JOIN kb_chunks c ON c.id = v.chunk_id
     LEFT JOIN reflection_meta m ON m.chunk_id = c.id
     WHERE v.embedding MATCH ? AND k = ?
       AND COALESCE(m.status, 'approved') NOT IN ('rejected', 'promoted')
     ORDER BY v.distance`

export async function runKbSearch(
  repo: Pick<KnowledgeRepository, "searchKb">,
  embed: EmbedFn,
  query: string
): Promise<string> {
  const vec = await embed(query)
  const hits = repo.searchKb(vec, 5)
  return hits.length
    ? hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n")
    : "知识库无相关内容。"
}
