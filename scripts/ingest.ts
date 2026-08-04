import { readFileSync, readdirSync } from "node:fs"
import { join, sep } from "node:path"
import { openDb } from "../lib/db/index.ts"
import { Repo } from "../lib/db/repo.ts"
import { embed } from "../lib/tools/embed.ts"

export function chunkText(text: string, maxLen = 500): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const p of paras) {
    if (p.length <= maxLen) out.push(p)
    else
      for (let i = 0; i < p.length; i += maxLen)
        out.push(p.slice(i, i + maxLen))
  }
  return out
}

export interface IngestResult {
  file: string
  chunks: number
}

export async function runIngest(
  repo: Repo,
  dir = "docs/kb"
): Promise<IngestResult[]> {
  // 递归子目录;文件标识用相对 posix 路径(如 faq/退款.md),便于区分同名文件
  const files = readdirSync(dir, { recursive: true })
    .map((f) => String(f).split(sep).join("/"))
    .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
  const out: IngestResult[] = []
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8")
    const chunks = chunkText(content)
    // 先清该 doc 旧分块再写入,保证「重建 embedding」幂等;否则每次重建叠加重复 chunk
    repo.deleteKbDoc(f)
    for (const c of chunks) {
      repo.insertKbEntry(f, c, f, await embed(c))
    }
    out.push({ file: f, chunks: chunks.length })
  }
  return out
}

async function main(): Promise<void> {
  // kb 灌库 CLI:只需 DB_PATH(缺省同 config-store 默认),不依赖其他 env
  const db = openDb(process.env.DB_PATH ?? "./data/agent.db")
  const repo = new Repo(db)
  const results = await runIngest(repo, "docs/kb")
  for (const r of results) console.log(`ingested ${r.file}: ${r.chunks} chunks`)
}

// 直接运行时执行(vitest import 时不执行)
if (process.argv[1]?.endsWith("ingest.ts")) main()
