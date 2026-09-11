import { describe, it, expect } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseTranscript, findTranscript, readTranscript } from "@/lib/conversation/transcript"

describe("parseTranscript", () => {
  it("文本与 tool_use 拆成独立条目", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { content: "你好" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "您好,请问" },
            { type: "tool_use", name: "kb_search", input: { q: "退款" } },
          ],
        },
      }),
    ].join("\n")
    const msgs = parseTranscript(jsonl)
    expect(msgs[0]).toEqual({ role: "user", text: "你好" })
    expect(msgs[1]).toEqual({ role: "assistant", text: "您好,请问" })
    expect(msgs[2].role).toBe("tool")
    expect(msgs[2].tool).toBe("kb_search")
    expect(msgs[2].input).toContain("退款")
  })

  it("tool_result 按 tool_use_id 回填到对应 tool_use 的 result", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "kb_search",
              input: { query: "价格" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: [{ type: "text", text: "知识库无相关内容。" }],
            },
          ],
        },
      }),
    ].join("\n")
    const msgs = parseTranscript(jsonl)
    expect(msgs).toHaveLength(1) // tool_result 合并进 tool_use,不新增条目
    expect(msgs[0].role).toBe("tool")
    expect(msgs[0].tool).toBe("kb_search")
    expect(msgs[0].input).toContain("价格")
    expect(msgs[0].result).toBe("知识库无相关内容。")
  })

  it("坏行跳过,未知类型忽略", () => {
    const jsonl = [
      "{bad json",
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "user", message: { content: "hi" } }),
    ].join("\n")
    const msgs = parseTranscript(jsonl)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe("hi")
  })

  it("空输入返回空数组", () => {
    expect(parseTranscript("")).toEqual([])
  })

  it("合成注入的 user 记录(<task-notification> 等)不产 user 气泡", () => {
    const synth = [
      "<task-notification>\n<task-id>abc</task-id>\n完成</task-notification>",
      "<system-reminder>后台提醒</system-reminder>",
      "<command-name>/foo</command-name>",
      "<local-command-stdout>输出</local-command-stdout>",
      "<user-prompt-submit-hook>hook</user-prompt-submit-hook>",
      "[Request interrupted by user]",
    ]
    const jsonl = [
      ...synth.map((c) =>
        JSON.stringify({ type: "user", message: { content: c } })
      ),
      JSON.stringify({ type: "user", message: { content: "真人问题" } }),
    ].join("\n")
    const msgs = parseTranscript(jsonl)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: "user", text: "真人问题" })
  })

  it("剥离真人文本尾部注入的 <system-reminder> 片段", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        content: "怎么续费?\n\n<system-reminder>注入的上下文</system-reminder>",
      },
    })
    const msgs = parseTranscript(jsonl)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe("怎么续费?")
  })

  it("数组内文本块也过滤合成注入,只留真人块", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "text", text: "<system-reminder>x</system-reminder>" },
          { type: "text", text: "你好" },
        ],
      },
    })
    const msgs = parseTranscript(jsonl)
    expect(msgs).toEqual([{ role: "user", text: "你好" }])
  })

  it("带 timestamp / model:每条挂 ts,assistant 挂 model", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-07-07T12:00:00.000Z",
        message: { content: "hi" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-07-07T12:00:01.000Z",
        message: {
          model: "MiniMax-M3",
          content: [{ type: "text", text: "您好" }],
        },
      }),
    ].join("\n")
    const msgs = parseTranscript(jsonl)
    expect(msgs[0]).toMatchObject({
      role: "user",
      text: "hi",
      ts: Date.parse("2026-07-07T12:00:00.000Z"),
    })
    expect(msgs[1]).toMatchObject({
      role: "assistant",
      text: "您好",
      model: "MiniMax-M3",
      ts: Date.parse("2026-07-07T12:00:01.000Z"),
    })
  })
})

describe("findTranscript", () => {
  it("在 configDir/projects 下递归找 <id>.jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"))
    const proj = join(dir, "projects", "-some-slug")
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, "abc-123.jsonl"), "")
    expect(findTranscript(dir, "abc-123")).toBe(join(proj, "abc-123.jsonl"))
    expect(findTranscript(dir, "nope")).toBeNull()
  })

  it("命中后走进程内缓存:整棵目录树删除后仍返回原路径", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-cache-"))
    const proj = join(dir, "projects", "-x")
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, "cached-1.jsonl"), "")
    const first = findTranscript(dir, "cached-1")
    expect(first).toBe(join(proj, "cached-1.jsonl"))
    expect(findTranscript(dir, "cached-1")).toBe(first)
  })

  it("缓存路径失效后重新扫描并返回空结果", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-stale-cache-"))
    const proj = join(dir, "projects", "-x")
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, "stale-1.jsonl"), "")
    expect(findTranscript(dir, "stale-1")).toBe(
      join(proj, "stale-1.jsonl")
    )
    rmSync(join(proj, "stale-1.jsonl"))
    expect(readTranscript(dir, "stale-1")).toEqual([])
  })
})
