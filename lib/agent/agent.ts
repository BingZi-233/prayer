import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { TOOL_NAMES } from "../tools/index";

export interface AgentDeps {
  model: string;
  systemPrompt: string;
  toolServer: unknown;
  queryFn?: typeof sdkQuery;
}

export interface AgentResult {
  text: string;
  sessionId?: string;
}

const DEFAULT_SYSTEM = `你是一名专业、友好的客服助手。规则:
1. 回答产品/业务问题前,先用 kb_search 检索知识库,依据检索结果作答,不要编造。
2. 涉及具体订单时用 lookup_order 查询。
3. 无法解决或用户要求人工时,调用 handoff_to_human。
4. 回答简洁、有礼,用中文。`;

export class Agent {
  private queryFn: typeof sdkQuery;
  constructor(private deps: AgentDeps) {
    this.queryFn = deps.queryFn ?? sdkQuery;
  }

  async run(text: string, resumeId: string | undefined): Promise<AgentResult> {
    const iter = this.queryFn({
      prompt: text,
      options: {
        model: this.deps.model,
        systemPrompt: this.deps.systemPrompt || DEFAULT_SYSTEM,
        mcpServers: { cs: this.deps.toolServer as any },
        allowedTools: TOOL_NAMES,
        resume: resumeId,
        maxTurns: 8,
        settingSources: ["user"],
      } as any,
    });

    let sessionId: string | undefined = resumeId;
    let out = "";
    for await (const msg of iter as AsyncIterable<any>) {
      if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
        sessionId = msg.session_id;
      }
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === "text") out += block.text;
        }
      }
    }
    return { text: out.trim(), sessionId };
  }
}
