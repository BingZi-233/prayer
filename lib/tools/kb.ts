import type { Repo } from "../db/repo";

type EmbedFn = (text: string) => Promise<Float32Array>;

// 知识库语义检索纯函数:embed → 向量近邻 → 拼片段文本。
// cs 插件子进程(plugins/cs/scripts/cs-mcp.ts)复用此实现,避免检索/格式逻辑漂移。
export const KB_TOOL_DESC = "检索产品知识库/FAQ,回答事实性问题前先调用。返回最相关的知识片段。";

export async function runKbSearch(repo: Repo, embed: EmbedFn, query: string): Promise<string> {
  const vec = await embed(query);
  const hits = repo.searchKb(vec, 5);
  return hits.length ? hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n") : "知识库无相关内容。";
}
