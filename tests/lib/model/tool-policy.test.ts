import { describe, it, expect } from "vitest"
import { configuredToolAllowlist, isToolAllowed } from "@/lib/model/tool-policy"

describe("isToolAllowed", () => {
  it("白名单工具放行:cs kb_search + packyapi + Skill", () => {
    expect(isToolAllowed("mcp__plugin_cs_cs__kb_search", {})).toBe(true)
    expect(isToolAllowed("mcp__plugin_packyapi_packyapi__packy", {})).toBe(true)
    expect(isToolAllowed("Skill", { command: "packyapi" })).toBe(true)
  })
  it("未知 MCP 工具默认拒绝，避免插件安装扩大模型权限", () => {
    expect(isToolAllowed("mcp__plugin_foo_bar__anything", {})).toBe(false)
    expect(isToolAllowed("mcp__whatever", {})).toBe(false)
  })
  it("部署可显式增补合法 MCP 工具名，非法值不会形成通配", () => {
    const allow = configuredToolAllowlist({
      NODE_ENV: "test",
      PRAYER_MCP_ALLOWLIST:
        "mcp__plugin_internal_server__read_status, mcp__bad value, *",
    })
    expect(allow.has("mcp__plugin_internal_server__read_status")).toBe(true)
    expect(allow.has("mcp__bad")).toBe(false)
    expect(allow.has("*")).toBe(false)
  })
  it("Bash / Read / WebSearch / WebFetch 禁用", () => {
    expect(isToolAllowed("Bash", { command: "node /a/packy.ts models" })).toBe(
      false
    )
    expect(isToolAllowed("Bash", { command: "rm -rf /" })).toBe(false)
    expect(
      isToolAllowed("Read", {
        file_path: "/x/plugins/packyapi/skills/packyapi/references/docs-map.md",
      })
    ).toBe(false)
    expect(isToolAllowed("Read", { file_path: "/etc/passwd" })).toBe(false)
    // 联网工具已禁(整页正文入 context,无缓存下每 turn 重发放大成本)
    expect(isToolAllowed("WebSearch", {})).toBe(false)
    expect(isToolAllowed("WebFetch", { url: "https://evil.com/x" })).toBe(false)
  })
  it("其余工具拒绝", () => {
    expect(isToolAllowed("Write", { file_path: "/x" })).toBe(false)
    expect(isToolAllowed("Task", {})).toBe(false)
    expect(isToolAllowed("Edit", { file_path: "/x" })).toBe(false)
  })
})
