/**
 * SDK `outputFormat: { type: "json_schema" }` 强制路径注入的合成工具名。
 * CLI 会要求模型调用它提交结构化结果;若 canUseTool 一律 deny,强制路径失败,
 * 模型只能吐自由文本(再被多轮拼接/解析搞挂)。
 */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput"

export function isStructuredOutputTool(name: string): boolean {
  return name === STRUCTURED_OUTPUT_TOOL
}

export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>
) => Promise<{
  behavior: "allow" | "deny"
  message?: string
  updatedInput?: Record<string, unknown>
}>

/**
 * 包一层 canUseTool:StructuredOutput 始终 allow(updatedInput 原样回传),
 * 其余工具交给 inner(默认 deny)。必须在 overrides 之后套,避免调用方
 * `canUseTool: async () => deny` 把强制路径一并掐死。
 */
export function wrapCanUseToolForStructuredOutput(
  inner?: CanUseToolFn
): CanUseToolFn {
  const deny: CanUseToolFn = async () => ({
    behavior: "deny",
    message: "本阶段不使用工具",
  })
  const base = inner ?? deny
  return async (toolName, input) => {
    if (isStructuredOutputTool(toolName)) {
      return { behavior: "allow", updatedInput: input }
    }
    return base(toolName, input)
  }
}

// 工具白名单:无条件放行的工具名。
// 插件 MCP 工具名由 SDK 拼作 mcp__plugin_<插件名>_<server名>__<工具名>(冒号→下划线)。
// Skill 仅加载 skill 正文(markdown 指令),真实动作仍受白名单约束。
export const CS_KB_TOOL = "mcp__plugin_cs_cs__kb_search"
/** 兼容 PackyAPI 插件统计/旧调用方；核心客服不依赖该工具。 */
export const PACKY_TOOL = "mcp__plugin_packyapi_packyapi__packy"
// 所有 MCP 工具(名以 mcp__ 前缀)统一由 isToolAllowed 无条件放行 —— 插件新增 server/工具无需改此处。
// 本 Set 只留非 MCP 的显式放行项。WebSearch / WebFetch 禁用:整页正文/检索结果塞进 context 后
// 永久留在会话里,即便命中缓存按 0.1x 计费,每轮重发的绝对量仍显著。Bash / Read 亦禁用。
export const TOOL_ALLOWLIST = new Set<string>(["Skill"])

// 权限判定:所有 MCP 工具(mcp__ 前缀)无条件放行 —— 插件 MCP 均为受控只读查询,
// 新增 server/工具免改白名单;再叠加非 MCP 的显式放行项(Skill)。Bash/Read/Web* 等宿主工具一律拒绝。
export function isToolAllowed(
  toolName: string,
  // 入参占位以匹配 SDK canUseTool 回调签名;当前判定只按工具名,不看入参
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: Record<string, unknown>
): boolean {
  return toolName.startsWith("mcp__") || TOOL_ALLOWLIST.has(toolName)
}

// 拒因 message:引导模型停止重试、改走合规路径,避免反复撞被拒工具烧光 maxTurns。
// 允许制下被拒即「未在放行白名单」,无需逐工具区分文案;统一导向知识库或业务工具。
export function denyMessage(toolName: string): string {
  return `${toolName} 不可用(未在放行白名单)。改用已安装的知识库或业务工具获取信息。`
}
