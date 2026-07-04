import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TranscriptMsg {
  role: "user" | "assistant";
  text: string;
  tool?: string;
}

function extractText(content: unknown): { text: string; tool?: string } {
  if (typeof content === "string") return { text: content };
  if (Array.isArray(content)) {
    let text = "";
    let tool: string | undefined;
    for (const b of content) {
      if (b && typeof b === "object") {
        const block = b as { type?: string; text?: string; name?: string };
        if (block.type === "text" && block.text) text += block.text;
        if (block.type === "tool_use" && block.name) tool = block.name;
      }
    }
    return { text, tool };
  }
  return { text: "" };
}

export function parseTranscript(jsonl: string): TranscriptMsg[] {
  const out: TranscriptMsg[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: { type?: string; message?: { content?: unknown } };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // 坏行跳过
    }
    if (rec.type !== "user" && rec.type !== "assistant") continue; // 未知类型忽略
    const { text, tool } = extractText(rec.message?.content);
    out.push({ role: rec.type, text, tool });
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
