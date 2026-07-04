import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TranscriptMsg {
  role: "user" | "assistant" | "tool";
  text?: string; // user / assistant 文本
  tool?: string; // 工具名(role==='tool')
  input?: string; // 工具请求(JSON)
  result?: string; // 工具响应
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// tool_result 的 content 可能是字符串或 [{type:'text',text}] 数组
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { text?: string }).text) || "")
      .filter(Boolean)
      .join("\n");
  }
  return stringify(content);
}

interface Block {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

export function parseTranscript(jsonl: string): TranscriptMsg[] {
  const out: TranscriptMsg[] = [];
  const byToolId = new Map<string, number>(); // tool_use_id → out 索引,用于回填 result

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: { type?: string; isMeta?: boolean; message?: { content?: unknown } };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // 坏行跳过
    }
    if (rec.type !== "user" && rec.type !== "assistant") continue; // 未知类型忽略
    if (rec.isMeta) continue; // 合成注入(skill / system 上下文)非真人输入,跳过
    const role = rec.type;
    const content = rec.message?.content;

    if (typeof content === "string") {
      if (content) out.push({ role, text: content });
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const raw of content) {
      if (!raw || typeof raw !== "object") continue;
      const b = raw as Block;
      if (b.type === "text" && b.text) {
        out.push({ role, text: b.text });
      } else if (b.type === "tool_use" && b.name) {
        const idx = out.push({ role: "tool", tool: b.name, input: stringify(b.input) }) - 1;
        if (b.id) byToolId.set(b.id, idx);
      } else if (b.type === "tool_result") {
        const text = resultText(b.content);
        const idx = b.tool_use_id ? byToolId.get(b.tool_use_id) : undefined;
        if (idx !== undefined) out[idx].result = text; // 回填到对应 tool_use
        else out.push({ role: "tool", tool: "result", result: text }); // 孤儿结果
      }
      // thinking 等其它块忽略
    }
  }
  return out;
}

export function findTranscript(configDir: string, sessionId: string): string | null {
  const root = join(configDir, "projects");
  if (!existsSync(root)) return null;
  const target = `${sessionId}.jsonl`;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === target) return full;
    }
  }
  return null;
}

export function readTranscript(configDir: string, sessionId: string): TranscriptMsg[] {
  const p = findTranscript(configDir, sessionId);
  if (!p) return [];
  return parseTranscript(readFileSync(p, "utf8"));
}
