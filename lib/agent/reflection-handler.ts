import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { bus } from "../bus";
import type { Repo } from "../db/repo";
import { embed as defaultEmbed } from "../tools/embed";
import type { HandoffHumanReply } from "../events";

export interface ReflectionDeps {
  repo: Repo;
  adminGroupId: number;
  embed?: (text: string) => Promise<Float32Array>;
  queryFn?: typeof sdkQuery;
  now?: () => number;
}

const REFLECT_SYSTEM = `你是客服知识运营助手。给定[用户问题]与[人工客服答案],判断能否提炼成通用、独立、可复用的 FAQ 知识条。
- 能:输出 {"learn": true, "faq": "<脱离本次上下文、含问题要点与结论的完整知识,纯文本一段>"}
- 不能(闲聊 / 寒暄 / 一次性 / 信息不足 / 含隐私如订单号手机号):输出 {"learn": false}
只输出一个 JSON 对象,不要额外文字,不要 Markdown 代码块。`;

// 从模型输出里抽第一个 JSON 对象,解析失败返回 null(当作 learn=false)
function extractJson(s: string): { learn?: unknown; faq?: unknown } | null {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// 监听 handoff.humanReply:LLM 提炼人工问答为 FAQ,直写 KB(打 source 标签)。
// 旁路观察者 —— 任何失败只记 error,不阻断静音/接管主流程。
export function registerReflectionHandler(deps: ReflectionDeps): () => void {
  const { repo, adminGroupId } = deps;
  const embed = deps.embed ?? defaultEmbed;
  const queryFn = deps.queryFn ?? sdkQuery;
  const now = deps.now ?? (() => Date.now());

  async function reflect(e: HandoffHumanReply): Promise<void> {
    try {
      const prompt = `[用户问题]\n${e.question || "(未记录)"}\n\n[人工客服答案]\n${e.answer}`;
      const iter = queryFn({
        prompt,
        options: {
          // 模型由 CLAUDE_CONFIG_DIR 配置决定;纯推理不给任何工具
          systemPrompt: { type: "preset", preset: "claude_code", append: REFLECT_SYSTEM },
          canUseTool: async () => ({ behavior: "deny" as const, message: "反思阶段不使用工具" }),
          maxTurns: 1,
          settingSources: ["user"],
        } as never,
      });
      let out = "";
      for await (const msg of iter as AsyncIterable<any>) {
        if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
          for (const b of msg.message.content) if (b.type === "text") out += b.text;
        }
      }
      const parsed = extractJson(out);
      if (!parsed || parsed.learn !== true || typeof parsed.faq !== "string" || !parsed.faq.trim()) return;
      const faq = parsed.faq.trim();
      const id = repo.insertKbChunk("human-reflection", faq, `human-reflection:${e.sessionKey}:${now()}`);
      repo.insertKbVec(id, await embed(faq));
      bus.emit("action.send", {
        action: "send_group_msg",
        groupId: adminGroupId,
        text: `已从本次人工回复沉淀 1 条知识到库:${faq.slice(0, 40)}${faq.length > 40 ? "…" : ""}`,
      });
    } catch (err) {
      bus.emit("error.occurred", { scope: "reflection", err, sessionKey: e.sessionKey });
    }
  }

  const onReply = (e: HandoffHumanReply) => {
    void reflect(e);
  };
  bus.on("handoff.humanReply", onReply);
  return () => bus.off("handoff.humanReply", onReply);
}
