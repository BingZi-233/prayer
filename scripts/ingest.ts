import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { openDb } from "../lib/core/db/index.ts"
import { Repo } from "../lib/core/db/repo.ts"
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

// 只存在于 DB、磁盘无对应文件的 doc(人工反思沉淀),prune 时不得误删
const DB_ONLY_DOCS = new Set(["human-reflection"])

// 进程级互斥:pnpm ingest 与 POST /api/kb/ingest 并发时,两个循环对同一 doc
// 交错 delete/insert 会混入双方 chunk;共享这一把锁串行化(sharedDb 同款 globalThis 模式)
const g = globalThis as unknown as { __ingestLock?: Promise<unknown> }
function withIngestLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__ingestLock ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  g.__ingestLock = next
  return next
}

export async function runIngest(
  repo: Repo,
  dir = "docs/kb"
): Promise<IngestResult[]> {
  return withIngestLock(async () => {
    // 递归子目录;文件标识用相对 posix 路径(如 faq/退款.md),便于区分同名文件。
    // isFile 过滤:目录名恰好以 .md/.txt 结尾时 readFileSync 会抛 EISDIR 中断整轮
    const files = readdirSync(dir, { recursive: true })
      .map((f) => String(f).split(sep).join("/"))
      .filter(
        (f) =>
          (f.endsWith(".md") || f.endsWith(".txt")) &&
          statSync(join(dir, f)).isFile()
      )
    const out: IngestResult[] = []
    for (const f of files) {
      const content = readFileSync(join(dir, f), "utf8")
      const chunks = chunkText(content)
      // 向量先全部算好,delete+insert 同一事务(对齐 applyPromote 的事故教训):
      // 此前逐条「各开一个事务」且先删后插——中途 embed 失败留下半成品 doc,
      // 异常上抛还会跳过末尾 prune,幽灵 doc 存活到下一次成功 ingest
      const withVec: { content: string; embedding: Float32Array }[] = []
      for (const c of chunks)
        withVec.push({ content: c, embedding: await embed(c) })
      repo.transaction(() => {
        // 先清该 doc 旧分块再写入,保证「重建 embedding」幂等;否则每次重建叠加重复 chunk
        repo.deleteKbDoc(f)
        for (const { content: c, embedding } of withVec)
          repo.insertKbEntry(f, c, f, embedding)
      })
      out.push({ file: f, chunks: chunks.length })
    }
    // prune:文件已从磁盘删除的 doc 清出索引,避免幽灵检索结果
    const onDisk = new Set(files)
    for (const { doc } of repo.kbDocStats()) {
      if (!onDisk.has(doc) && !DB_ONLY_DOCS.has(doc)) repo.deleteKbDoc(doc)
    }
    return out
  })
}

async function main(): Promise<void> {
  // kb 灌库 CLI:只需 DB_PATH(缺省同 config-store 默认),不依赖其他 env
  const db = openDb(process.env.DB_PATH ?? "./data/agent.db")
  const repo = new Repo(db)
  const results = await runIngest(repo, "docs/kb")
  for (const r of results) console.log(`ingested ${r.file}: ${r.chunks} chunks`)
  db.close()
}

// 直接运行时执行(vitest import 时不执行);失败给出明确退出码而非 unhandled rejection
if (process.argv[1]?.endsWith("ingest.ts")) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
