import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Repo } from "../db/repo";
import { embed } from "./embed";
import { makeKbTool } from "./kb";
import { DIM } from "../db/index";

export const TOOL_NAMES = ["mcp__cs__kb_search"];

// 进程内 SDK MCP server 的自省描述:mcpServerStatus() 不上报 in-process server,
// 故在此静态镜像 buildToolServer 注册的 cs server,供能力页展示。改动 cs 工具时同步此处。
export const CS_SERVER_INFO = {
  name: "cs",
  version: "1.0.0",
  tools: [
    { name: "kb_search", description: "检索产品知识库/FAQ,回答事实性问题前先调用。", readOnly: true },
  ],
};

// 当前消息的会话上下文(orchestrator 绑定,当前工具未使用,保留以兼容调用签名)
export interface ToolContext {
  sessionKey: string;
  groupId: number;
  userId: number;
}

// 按消息构建:kb 无状态
export function buildToolServer(repo: Repo, _ctx: ToolContext) {
  return createSdkMcpServer({
    name: "cs",
    version: "1.0.0",
    tools: [makeKbTool(repo, embed, DIM)],
  });
}
