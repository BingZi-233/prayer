// 注意:cs 子进程(plugins/cs/scripts/cs-mcp.ts)以 Node strip-only 模式按路径
// 直接加载本文件。本文件只允许 import type——一旦对 repo.ts 改成值 import
// (该文件用了参数属性),子进程加载即失败。
import type { KnowledgeRepository } from "../core/db/repositories/knowledge.ts"

type EmbedFn = (text: string) => Promise<Float32Array>

// 知识库语义检索纯函数:embed → 向量近邻 → 拼片段文本。
// cs 插件子进程(plugins/cs/scripts/cs-mcp.ts)复用此实现,避免检索/格式逻辑漂移。
export const KB_TOOL_DESC =
  "语义检索产品知识库(产品文档、配置、FAQ、政策与人工沉淀)。政策、文档、FAQ、接入步骤与故障排查等事实性问题,预检索片段不足或没有预检索时必须调用,并严格依据返回片段作答,不得凭记忆编造。价格、库存、版本、状态与公告等实时数据不要用本工具,改调 packy 或其它对应的业务工具。参数 query 传用户问题或检索关键词(整句自然语言比堆关键词更准)。返回语义最相近的 top-5 片段(格式 [1]…[2]…),无命中时返回「知识库无相关内容。」。"

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
