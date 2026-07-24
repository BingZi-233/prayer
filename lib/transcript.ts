import { readdirSync, existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

export interface TranscriptMsg {
  role: "user" | "assistant" | "tool"
  text?: string // user / assistant 文本
  tool?: string // 工具名(role==='tool')
  input?: string // 工具请求(JSON)
  result?: string // 工具响应
  ts?: number // 记录时间戳(ms);源自 jsonl 行的 timestamp
  model?: string // assistant 回合的模型名
}

// Claude Code 会以 type:"user" 注入非真人内容(后台任务通知 / 系统提醒 / 斜杠命令 /
// 本地命令输出 / hook 上下文 / 用户打断标记)。这些不是人发的消息,不能渲成用户气泡。
const SYNTHETIC_PREFIXES = [
  "<task-notification>",
  "<system-reminder>",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<user-prompt-submit-hook>",
  "<session-start-hook>",
  "[Request interrupted",
]

// 剥离真人文本里被追加/嵌入的 <system-reminder>…</system-reminder> 片段(hook 会挂到真提示后)。
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
}

// 归一化一段 user 文本:剥离注入片段后,整体是合成注入或空 → null(丢弃);否则返回真人文本。
function humanUserText(raw: string): string | null {
  const stripped = stripSystemReminders(raw).trim()
  if (!stripped) return null
  if (SYNTHETIC_PREFIXES.some((p) => stripped.startsWith(p))) return null
  return stripped
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// tool_result 的 content 可能是字符串或 [{type:'text',text}] 数组
function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map(
        (b) =>
          (b && typeof b === "object" && (b as { text?: string }).text) || ""
      )
      .filter(Boolean)
      .join("\n")
  }
  return stringify(content)
}

interface Block {
  type?: string
  text?: string
  name?: string
  id?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
}

export function parseTranscript(jsonl: string): TranscriptMsg[] {
  const out: TranscriptMsg[] = []
  const byToolId = new Map<string, number>() // tool_use_id → out 索引,用于回填 result

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: {
      type?: string
      isMeta?: boolean
      timestamp?: string
      message?: { content?: unknown; model?: string }
    }
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue // 坏行跳过
    }
    if (rec.type !== "user" && rec.type !== "assistant") continue // 未知类型忽略
    if (rec.isMeta) continue // 合成注入(skill / system 上下文)非真人输入,跳过
    const role = rec.type
    const content = rec.message?.content
    const ts = rec.timestamp
      ? Date.parse(rec.timestamp) || undefined
      : undefined
    const model = role === "assistant" ? rec.message?.model : undefined

    if (typeof content === "string") {
      const text = role === "user" ? humanUserText(content) : content || null
      if (text) out.push({ role, text, ts, model })
      continue
    }
    if (!Array.isArray(content)) continue

    for (const raw of content) {
      if (!raw || typeof raw !== "object") continue
      const b = raw as Block
      if (b.type === "text" && b.text) {
        const text = role === "user" ? humanUserText(b.text) : b.text
        if (text) out.push({ role, text, ts, model })
      } else if (b.type === "tool_use" && b.name) {
        const idx =
          out.push({
            role: "tool",
            tool: b.name,
            input: stringify(b.input),
            ts,
          }) - 1
        if (b.id) byToolId.set(b.id, idx)
      } else if (b.type === "tool_result") {
        const text = resultText(b.content)
        const idx = b.tool_use_id ? byToolId.get(b.tool_use_id) : undefined
        if (idx !== undefined)
          out[idx].result = text // 回填到对应 tool_use
        else out.push({ role: "tool", tool: "result", result: text, ts }) // 孤儿结果
      }
      // thinking 等其它块忽略
    }
  }
  return out
}

export function findTranscript(
  configDir: string,
  sessionId: string
): string | null {
  // configDir 为运行时配置(常在项目外)。fs 参数加 turbopackIgnore,避免 NFT 把整仓 trace 进来。
  const root = join(/* turbopackIgnore: true */ resolve(configDir), "projects")
  if (!existsSync(/* turbopackIgnore: true */ root)) return null
  const target = `${sessionId}.jsonl`
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(/* turbopackIgnore: true */ dir, {
        withFileTypes: true,
      })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name === target) return full
    }
  }
  return null
}

export function readTranscript(
  configDir: string,
  sessionId: string
): TranscriptMsg[] {
  const p = findTranscript(configDir, sessionId)
  if (!p) return []
  return parseTranscript(readFileSync(/* turbopackIgnore: true */ p, "utf8"))
}
