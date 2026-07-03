import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { bus } from "../bus";

export function makeHandoffTool() {
  return tool(
    "handoff_to_human",
    "当无法解决用户问题、或用户明确要求人工时调用,转接人工客服。",
    {
      sessionKey: z.string(),
      groupId: z.number(),
      userId: z.number(),
      lastQuestion: z.string().describe("用户最后的问题摘要"),
    },
    async ({ sessionKey, groupId, userId, lastQuestion }) => {
      bus.emit("handoff.requested", { sessionKey, groupId, userId, lastQuestion });
      return { content: [{ type: "text", text: "已为您转接人工客服,请稍候。" }] };
    }
  );
}
