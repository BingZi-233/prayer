import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { bus } from "../bus";
import type { ToolContext } from "./index";

// sessionKey/groupId/userId 由 runtime 按当前消息绑定(见 ToolContext),
// 不暴露给模型 —— 模型只需给出问题摘要,避免 id 被编造或篡改。
export function makeHandoffTool(ctx: ToolContext) {
  return tool(
    "handoff_to_human",
    "当无法解决用户问题、或用户明确要求人工时调用,转接人工客服。",
    {
      lastQuestion: z.string().describe("用户最后的问题摘要"),
    },
    async ({ lastQuestion }) => {
      bus.emit("handoff.requested", { ...ctx, lastQuestion });
      return { content: [{ type: "text", text: "已为您转接人工客服,请稍候。" }] };
    }
  );
}
