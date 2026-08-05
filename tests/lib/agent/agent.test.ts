import { describe, it, expect } from "vitest"
import {
  Agent,
  isToolAllowed,
  sdkEnv,
  noToolQueryOptions,
  agentQueryOptions,
  AGENT_FALLBACK_TEXT,
  type AgentDeps,
} from "@/lib/agent/agent"
import { usageStats } from "@/lib/usage-stats"

// 与 Agent 内部 queryFn 同型;spy 捕获的入参即 SDK query 的参数
type QueryFn = NonNullable<AgentDeps["queryFn"]>
type QueryArgs = Parameters<QueryFn>[0]

// 模拟 SDK query:产出 init(带 session_id)+ 一条 assistant 文本
async function* fakeQuery(_args: QueryArgs) {
  yield { type: "system", subtype: "init", session_id: "sid-new" }
  yield {
    type: "assistant",
    message: { content: [{ type: "text", text: "你好,请问有什么可以帮您?" }] },
  }
  yield { type: "result", subtype: "success" }
}

describe("Agent.run", () => {
  it("返回最终文本 + 新 session_id", async () => {
    const agent = new Agent({
      systemPrompt: "客服",
      queryFn: fakeQuery as unknown as QueryFn,
    })
    const out = await agent.run("在吗", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(out.text).toContain("有什么可以帮您")
    expect(out.sessionId).toBe("sid-new")
  })

  it("传入 resumeId 时透传给 options.resume", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "system", subtype: "init", session_id: "sid-x" }
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run("hi", "sid-prev", {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(seen.options!.resume).toBe("sid-prev")
  })

  it("pluginPaths 转成 options.plugins 的 local 项(开启 MCP 发现,不设 skipMcpDiscovery)", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      pluginPaths: ["/abs/plugins/packyapi"],
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run("hi", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(seen.options!.plugins).toEqual([
      { type: "local", path: "/abs/plugins/packyapi" },
    ])
  })

  it("未给 pluginPaths 时 options.plugins 为空数组", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run("hi", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(seen.options!.plugins).toEqual([])
  })

  it("无图:prompt 为字符串(向后兼容)", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run("在吗", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(seen.prompt).toBe("在吗")
  })

  it("引用/转发折叠进文本前言(无图仍字符串)", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run(
      "这是啥",
      undefined,
      { sessionKey: "1:2", groupId: 1, userId: 2 },
      { quoted: "张三: 原问题", forwarded: "A: x\nB: y" }
    )
    expect(seen.prompt).toContain("【用户引用了一条消息:张三: 原问题】")
    expect(seen.prompt).toContain("【用户转发的合并消息:")
    expect(seen.prompt).toContain("这是啥")
  })

  it("有图:prompt 为 AsyncIterable,首条含 image block(base64)+ 文本", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run(
      "看图",
      undefined,
      { sessionKey: "1:2", groupId: 1, userId: 2 },
      {
        images: [{ data: "AAAA", mediaType: "image/png" }],
      }
    )
    const prompt = seen.prompt as AsyncIterable<{
      type: string
      message: { role: string; content: Record<string, unknown>[] }
    }>
    expect(typeof prompt[Symbol.asyncIterator]).toBe("function")
    const first = (await prompt[Symbol.asyncIterator]().next()).value
    expect(first.type).toBe("user")
    expect(first.message.role).toBe("user")
    const content = first.message.content
    expect(content[0]).toEqual({ type: "text", text: "看图" })
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAAA" },
    })
  })

  it("cache 友好:tools=[] 砍内置工具 schema,skills=all 保留插件技能", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run("hi", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(seen.options!.tools).toEqual([])
    expect(seen.options!.skills).toBe("all")
    expect(seen.options!.settingSources).toEqual(["user"])
  })
})

describe("Agent.run 超时", () => {
  const ctx = { sessionKey: "1:2", groupId: 1, userId: 2 }

  it("迭代挂起超过 timeoutMs → 降级返回,不无限卡死", async () => {
    // 模拟 relay 流卡住:init 后永不产出后续消息
    const hang = async function* () {
      yield { type: "system", subtype: "init", session_id: "sid-hang" }
      await new Promise<void>(() => {})
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: hang as unknown as QueryFn,
      timeoutMs: 30,
    })
    const out = await agent.run("在吗", undefined, ctx)
    expect(out.text).toBe(AGENT_FALLBACK_TEXT)
    // 已抓到的 session_id 仍保留,便于网页查历史
    expect(out.sessionId).toBe("sid-hang")
  })

  it("超时但已累积部分文本 → 保留已累积,不覆盖为降级文案", async () => {
    const hang = async function* () {
      yield { type: "system", subtype: "init", session_id: "sid" }
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "部分答案" }] },
      }
      await new Promise<void>(() => {})
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: hang as unknown as QueryFn,
      timeoutMs: 30,
    })
    const out = await agent.run("在吗", undefined, ctx)
    expect(out.text).toBe("部分答案")
  })

  it("传入 abortController 给 SDK query(超时时可 abort 子进程)", async () => {
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run("hi", undefined, ctx)
    expect(seen.options!.abortController).toBeInstanceOf(AbortController)
  })
})

describe("Agent.run systemPrompt", () => {
  it("systemPrompt 恒定 = deps.systemPrompt(无按调用拼接的后缀 → 主动/正常路径共享前缀)", async () => {
    let captured!: QueryArgs
    const queryFn = ((args: QueryArgs) => {
      captured = args
      return (async function* () {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "ok" }] },
        }
      })()
    }) as unknown as QueryFn
    const agent = new Agent({ systemPrompt: "BASE", queryFn })
    await agent.run("hi", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(captured.options!.systemPrompt).toBe("BASE")
  })
})

describe("Agent.run 用量记账", () => {
  it("末尾 result.usage → 记入 usageStats 的 agent 站点", async () => {
    usageStats.reset()
    const q = async function* () {
      yield { type: "system", subtype: "init", session_id: "s" }
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      }
      yield {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 300,
          cache_creation_input_tokens: 50,
        },
      }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: q as unknown as QueryFn,
    })
    await agent.run("hi", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(usageStats.snapshot().agent).toMatchObject({
      count: 1,
      input: 100,
      output: 20,
      cacheRead: 300,
      cacheCreation: 50,
      costUsd: 0.01,
    })
  })
})

describe("sdkEnv", () => {
  it("剥掉所有 ANTHROPIC_* 让 settings.json 的 env 接管", () => {
    const out = sdkEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      CLAUDE_CONFIG_DIR: "/abs/data/claude-config",
      ANTHROPIC_BASE_URL: "https://www.packyapi.ai",
      ANTHROPIC_AUTH_TOKEN: "leak",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "x",
    })
    expect(out.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(out.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    // 保留 CONFIG_DIR 与必需变量
    expect(out.CLAUDE_CONFIG_DIR).toBe("/abs/data/claude-config")
    expect(out.PATH).toBe("/usr/bin")
    expect(out.HOME).toBe("/home/x")
  })
  it("丢弃 undefined 值", () => {
    const out = sdkEnv({ A: "1", B: undefined })
    expect(out).toEqual({ A: "1" })
  })
})

describe("noToolQueryOptions / agentQueryOptions", () => {
  it("noTool:空 tools/skills + 严格 MCP,稳定无工具前缀", () => {
    const o = noToolQueryOptions({ systemPrompt: "x", maxTurns: 2 })
    expect(o.tools).toEqual([])
    expect(o.skills).toEqual([])
    expect(o.strictMcpConfig).toBe(true)
    expect(o.mcpServers).toEqual({})
    expect(o.settingSources).toEqual(["user"])
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

describe("Agent.run env", () => {
  it("options.env 剥掉 ANTHROPIC_*(不 shadow settings.json)", async () => {
    const prev = process.env.ANTHROPIC_BASE_URL
    process.env.ANTHROPIC_BASE_URL = "https://inherited.example"
    let seen!: QueryArgs
    const spyQuery = async function* (args: QueryArgs) {
      seen = args
      yield { type: "result", subtype: "success" }
    }
    const agent = new Agent({
      systemPrompt: "s",
      queryFn: spyQuery as unknown as QueryFn,
    })
    await agent.run("hi", undefined, {
      sessionKey: "1:2",
      groupId: 1,
      userId: 2,
    })
    expect(seen.options!.env!.ANTHROPIC_BASE_URL).toBeUndefined()
    if (prev === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = prev
  })
})

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
