import { TOOL_ALLOWLIST } from "./agent";

export interface CapabilityTool {
  name: string;
  description?: string;
  readOnly?: boolean;
}
export interface CapabilityMcpServer {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  version?: string;
  error?: string;
  scope?: string;
  tools: CapabilityTool[];
}
export interface CapabilitySkill {
  name: string;
  description: string;
  argumentHint?: string;
}
export interface CapabilityPlugin {
  name: string;
  path: string;
  source?: string;
}
export interface CapabilityToolPolicy {
  allowlist: string[];
  gated: { tool: string; constraint: string }[];
}
export interface Capabilities {
  plugins: CapabilityPlugin[];
  skills: CapabilitySkill[];
  mcpServers: CapabilityMcpServer[];
  toolPolicy: CapabilityToolPolicy;
  probedAt: number;
}

// 静态工具门控:与 lib/agent/agent.ts 的 isToolAllowed/denyMessage 语义一致。
// SDK 不上报本 host 的白名单,故在此静态描述。
export function buildToolPolicy(): CapabilityToolPolicy {
  return {
    allowlist: [...TOOL_ALLOWLIST],
    gated: [
      { tool: "Bash", constraint: "仅放行 PackyAPI 查询脚本(node …/packy.ts),禁 shell 链接/重定向" },
      { tool: "Read", constraint: "仅读 packyapi 技能的 references/*.md" },
      { tool: "WebFetch", constraint: "仅访问 packyapi.com 及其子域" },
    ],
  };
}
