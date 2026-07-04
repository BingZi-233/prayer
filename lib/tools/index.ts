import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Repo } from "../db/repo";
import { embed } from "./embed";
import { makeKbTool } from "./kb";
import { makeOrderTool } from "./biz";
import { makeHandoffTool } from "./handoff";
import { DIM } from "../db/index";

export const TOOL_NAMES = [
  "mcp__cs__kb_search",
  "mcp__cs__lookup_order",
  "mcp__cs__handoff_to_human",
];

// 当前消息的会话上下文,由 runtime 绑定进工具(handoff 用),不进模型
export interface ToolContext {
  sessionKey: string;
  groupId: number;
  userId: number;
}

// 按消息构建:kb/order 无状态,handoff 绑定当前 ctx
export function buildToolServer(repo: Repo, ctx: ToolContext) {
  return createSdkMcpServer({
    name: "cs",
    version: "1.0.0",
    tools: [makeKbTool(repo, embed, DIM), makeOrderTool(), makeHandoffTool(ctx)],
  });
}
