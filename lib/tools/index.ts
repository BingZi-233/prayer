import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Repo } from "../db/repo";
import { embed } from "./embed";
import { makeKbTool } from "./kb";
import { makeOrderTool } from "./biz";
import { DIM } from "../db/index";

export const TOOL_NAMES = ["mcp__cs__kb_search", "mcp__cs__lookup_order"];

// 当前消息的会话上下文(orchestrator 绑定,当前工具未使用,保留以兼容调用签名)
export interface ToolContext {
  sessionKey: string;
  groupId: number;
  userId: number;
}

// 按消息构建:kb/order 无状态
export function buildToolServer(repo: Repo, _ctx: ToolContext) {
  return createSdkMcpServer({
    name: "cs",
    version: "1.0.0",
    tools: [makeKbTool(repo, embed, DIM), makeOrderTool()],
  });
}
