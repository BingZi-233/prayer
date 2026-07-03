import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../lib/db/index";
import { Repo } from "../lib/db/repo";
import { embed } from "../lib/tools/embed";
import { loadConfig } from "../lib/config";

export function chunkText(text: string, maxLen = 500): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= maxLen) out.push(p);
    else for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
  }
  return out;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const repo = new Repo(db);
  const dir = "docs/kb";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8");
    const chunks = chunkText(content);
    for (const c of chunks) {
      const id = repo.insertKbChunk(f, c, f);
      repo.insertKbVec(id, await embed(c));
    }
    console.log(`ingested ${f}: ${chunks.length} chunks`);
  }
}

// 直接运行时执行(vitest import 时不执行)
if (process.argv[1]?.endsWith("ingest.ts")) main();
