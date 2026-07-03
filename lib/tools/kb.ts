import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Repo } from "../db/repo";

type EmbedFn = (text: string) => Promise<Float32Array>;

export function makeKbTool(repo: Repo, embed: EmbedFn, _dim: number) {
  return tool(
    "kb_search",
    "检索产品知识库/FAQ,回答事实性问题前先调用。返回最相关的知识片段。",
    { query: z.string().describe("用户问题或检索关键词") },
    async ({ query }) => {
      const vec = await embed(query);
      const hits = repo.searchKb(vec, 5);
      const text = hits.length
        ? hits.map((h, i) => `[${i + 1}] ${h.content}`).join("\n")
        : "知识库无相关内容。";
      return { content: [{ type: "text", text }] };
    }
  );
}
