import { describe, it, expect } from "vitest"
import { isToolAllowed } from "@/lib/model/tool-policy"

describe("isToolAllowed", () => {
  it("白名单工具放行:cs kb_search + packyapi + Skill", () => {
    expect(isToolAllowed("mcp__plugin_cs_cs__kb_search", {})).toBe(true)
    expect(isToolAllowed("mcp__plugin_packyapi_packyapi__packy", {})).toBe(true)
    expect(isToolAllowed("Skill", { command: "packyapi" })).toBe(true)
  })
  it("所有 MCP 工具(mcp__ 前缀)无条件放行 —— 新增 server/工具免改白名单", () => {
    expect(isToolAllowed("mcp__plugin_foo_bar__anything", {})).toBe(true)
    expect(isToolAllowed("mcp__whatever", {})).toBe(true)
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
