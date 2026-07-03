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

export function buildToolServer(repo: Repo) {
  return createSdkMcpServer({
    name: "cs",
    version: "1.0.0",
    tools: [makeKbTool(repo, embed, DIM), makeOrderTool(), makeHandoffTool()],
  });
}
