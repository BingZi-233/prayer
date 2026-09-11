import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { sdkEnv } from "./sdk-env"
import {
  wrapCanUseToolForStructuredOutput,
  type CanUseToolFn,
} from "./tool-policy"

/**
 * 读取 CLAUDE_CONFIG_DIR/settings.json 的 env,供隔离型后台 LLM 调用使用。
 *
 * 后台分类/整理任务需要 auth / relay / model 配置,但不应加载 user settings 中的
 * plugins、skills 与 hooks（尤其面向用户回复的风格 hook 会干扰 JSON 输出）。
 * 这里只搬运 env 字符串,不读取或返回 settings 的其它字段,也不记录任何值。
 */
function configuredSdkEnv(
  base: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out = sdkEnv(base)
  const configDir = base.CLAUDE_CONFIG_DIR
  if (!configDir) return out
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(configDir, "settings.json"), "utf8")
    ) as { env?: unknown }
    if (!parsed.env || typeof parsed.env !== "object") return out
    for (const [key, value] of Object.entries(parsed.env)) {
      if (typeof value === "string") out[key] = value
    }
  } catch {
    // 配置缺失/暂时写入中时保持旧的 fail-soft 语义:让 SDK 给出认证错误,
    // 由各后台任务既有的 fail-open / fail-closed 逻辑接管,绝不打印凭据。
  }
  return out
}

/**
 * 无工具 JSON 任务(intent / answerability / reflect / compact / topic / promote)共用的 query options 基座。
 *
 * 目标:压住 prompt cache 前缀抖动与体积 —— 这些调用点从不需要业务工具,却曾默认带上
 * Claude Code 全套内置工具 schema + enabledPlugins 的 MCP/skills,导致:
 *   1) 前缀数 k~数十 k token,每次冷启动贵;
 *   2) MCP 连接时序/工具顺序不稳 → 5 分钟 API cache 前缀字节对不上 → 命中率 20%~50%。
 * 这条优化确有实效:2026-09 实测中转端点认 Anthropic prompt cache(近 7 天主客服 370 次调用,
 * 218 次 cache_read>1k,命中侧累计 2.72M vs 未缓存 input 1.33M),别当无用功删掉。
 *
 * settingSources:[]:不加载 user settings 的 plugins / skills / hooks,避免面向用户的
 * 风格插件污染 JSON 分类与知识整理。认证、relay 与模型配置由 configuredSdkEnv
 * 只读 settings.json.env 后显式传入。
 * strictMcpConfig + 空 mcpServers:双保险,不让其它 MCP 进入 prompt。
 * tools:[] / skills:[]:内置工具与技能均不注入。
 * 例外:outputFormat.json_schema 时 CLI 注入的 StructuredOutput 必须放行(见 wrapCanUseToolForStructuredOutput)。
 */
export function noToolQueryOptions(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const { canUseTool: userCanUseTool, ...rest } = overrides
  const inner =
    typeof userCanUseTool === "function"
      ? (userCanUseTool as CanUseToolFn)
      : undefined
  return {
    tools: [],
    skills: [],
    strictMcpConfig: true,
    mcpServers: {},
    settingSources: [],
    permissionMode: "default",
    env: configuredSdkEnv(),
    ...rest,
    // 始终最后覆盖:调用方 deny-all 也不能挡 StructuredOutput
    canUseTool: wrapCanUseToolForStructuredOutput(inner),
  }
}

/**
 * 主客服 agent 的 query options 基座:砍掉 Bash/Read/Web* 等内置工具 schema
 * (本就靠 canUseTool 拒绝,但 schema 仍占前缀、会抖),只留插件 MCP + skills。
 * 业务插件及其 MCP 仍由 settingSources:["user"] → enabledPlugins 加载。
 */
export function agentQueryOptions(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    // 空数组 = 禁用全部内置工具 schema;MCP 工具不在此列,仍由插件注入
    tools: [],
    // 启用已发现 skills;skills 选项会带上 Skill 工具,无需再塞 allowedTools
    skills: "all",
    settingSources: ["user"],
    permissionMode: "default",
    env: sdkEnv(),
    ...overrides,
  }
}
