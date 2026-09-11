import { describe, it, expect } from "vitest"
import {
  noToolQueryOptions,
  agentQueryOptions,
} from "@/lib/model/query-options"

describe("noToolQueryOptions / agentQueryOptions", () => {
  it("noTool:空 tools/skills + 严格 MCP,稳定无工具前缀", () => {
    const o = noToolQueryOptions({ systemPrompt: "x", maxTurns: 2 })
    expect(o.tools).toEqual([])
    expect(o.skills).toEqual([])
    expect(o.strictMcpConfig).toBe(true)
    expect(o.mcpServers).toEqual({})
    expect(o.settingSources).toEqual([])
    expect(o.systemPrompt).toBe("x")
    expect(o.maxTurns).toBe(2)
  })
  it("noTool:StructuredOutput 始终 allow,其它工具仍 deny", async () => {
    const o = noToolQueryOptions({
      canUseTool: async () => ({
        behavior: "deny" as const,
        message: "归类阶段不使用工具",
      }),
    })
    const can = o.canUseTool as (
      name: string,
      input: Record<string, unknown>
    ) => Promise<{
      behavior: string
      message?: string
      updatedInput?: Record<string, unknown>
    }>
    const so = await can("StructuredOutput", { items: [{ i: 0 }] })
    expect(so).toEqual({
      behavior: "allow",
      updatedInput: { items: [{ i: 0 }] },
    })
    const bash = await can("Bash", { command: "ls" })
    expect(bash.behavior).toBe("deny")
    expect(bash.message).toBe("归类阶段不使用工具")
  })
  it("noTool:默认 canUseTool 也放行 StructuredOutput", async () => {
    const o = noToolQueryOptions()
    const can = o.canUseTool as (
      name: string,
      input: Record<string, unknown>
    ) => Promise<{ behavior: string }>
    expect((await can("StructuredOutput", {})).behavior).toBe("allow")
    expect((await can("Read", {})).behavior).toBe("deny")
  })
  it("agent:空 tools + skills=all,保留插件 MCP 路径", () => {
    const o = agentQueryOptions({ systemPrompt: "s" })
    expect(o.tools).toEqual([])
    expect(o.skills).toBe("all")
    expect(o.strictMcpConfig).toBeUndefined()
    expect(o.settingSources).toEqual(["user"])
  })
})
