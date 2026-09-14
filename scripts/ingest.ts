import { lstatSync, readdirSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { openDb } from "../lib/core/db/index.ts"
import { canonicalDbPath } from "../lib/core/db/path.ts"
import { Repo } from "../lib/core/db/repo.ts"
import { embed } from "../lib/model/embed.ts"
import {
  isKbIngestibleRelPath,
  MAX_KB_FILE_BYTES,
  readKbFileBoundedNoFollow,
  safeKbAbsAt,
} from "../lib/knowledge/kb-path.ts"
import { withKbMutationLock } from "../lib/knowledge/mutation-lock.ts"
import { splitCompactedFaq } from "../lib/knowledge/reflection/compact-chunks.ts"

// 保留 CLI/测试的旧导出名；知识库与反思整理共用同一分块实现。
export const chunkText = splitCompactedFaq

export interface IngestResult {
  file: string
  chunks: number
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

// 只存在于 DB、磁盘无对应文件的 doc(人工反思沉淀),prune 时不得误删
const DB_ONLY_DOCS = new Set(["human-reflection"])

// 进程内互斥:API 文件写入和 POST /api/kb/ingest 共用同一把锁,
// 避免扫描到同一 Node 进程正在替换的临时/半成品文件。pnpm ingest
// 通常是独立进程,不能由这把锁与 PM2 做跨进程协调;部署脚本须按文档先停服务
// 或提供外部锁。
function withIngestLock<T>(fn: () => Promise<T>): Promise<T> {
  return withKbMutationLock(fn)
}

export async function runIngest(
  repo: Repo,
  dir = "docs/kb"
): Promise<IngestResult[]> {
  return withIngestLock(async () => {
    // 递归子目录;文件标识用相对 posix 路径(如 faq/退款.md),便于区分同名文件。
    // isFile 过滤:目录名恰好以 .md/.txt 结尾时 readFileSync 会抛 EISDIR 中断整轮
    const root = resolve(dir)
    const rootStat = lstatSync(root)
    // A symlink (or a non-directory) root is not a trustworthy discovery
    // boundary.  Return an empty result while deliberately skipping prune.
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return []
    let unsafeDiscovery = false
    const files = readdirSync(root, { recursive: true })
      .map((f) => String(f).split(sep).join("/"))
      .filter((f) => {
        if (!isKbIngestibleRelPath(f)) return false
        // A rejected root/component, symlink, directory, or disappearing file
        // means the discovery snapshot is not trustworthy. Keep the historical
        // "ignore unsafe file" behavior, but disable prune below so a bad
        // snapshot can never delete unrelated indexed documents.
        if (safeKbAbsAt(root, f) === null) {
          unsafeDiscovery = true
          return false
        }
        if (!isRegularFile(join(root, f))) {
          unsafeDiscovery = true
          return false
        }
        return true
      })
    // 先完成整轮读取与向量计算，再一次性提交 SQLite 变更。这样第 N 个
    // 文件读取/embedding 失败时，前 N-1 个文件不会留下半轮新旧混合索引。
    const prepared: {
      file: string
      chunks: { content: string; embedding: Float32Array }[]
    }[] = []
    for (const f of files) {
      // Re-open through an O_NOFOLLOW fd after the discovery pass. This closes
      // the final-component symlink race and keeps an unexpectedly large file
      // from being buffered into the ingest process.
      const read = readKbFileBoundedNoFollow(
        join(root, f),
        MAX_KB_FILE_BYTES
      )
      if (read === null) {
        unsafeDiscovery = true
        throw new Error(`无法安全读取知识库文件: ${f}`)
      }
      if ("tooLarge" in read)
        throw new Error(`知识库文件过大(上限 ${MAX_KB_FILE_BYTES} 字节): ${f}`)
      const content = read.content
      const chunks = chunkText(content)
      // 向量先全部算好,delete+insert 同一事务(对齐 applyPromote 的事故教训):
      // 此前逐条「各开一个事务」且先删后插——中途 embed 失败留下半成品 doc,
      // 异常上抛还会跳过末尾 prune,幽灵 doc 存活到下一次成功 ingest
      const withVec: { content: string; embedding: Float32Array }[] = []
      for (const c of chunks)
        withVec.push({ content: c, embedding: await embed(c) })
      prepared.push({ file: f, chunks: withVec })
    }

    repo.transaction(() => {
      for (const { file, chunks } of prepared) {
        // 先清该 doc 旧分块再写入,保证「重建 embedding」幂等;否则每次重建叠加重复 chunk
        repo.deleteKbDoc(file)
        for (const { content: c, embedding } of chunks)
          repo.insertKbEntry(file, c, file, embedding)
      }
      // prune 只在完整、可信的发现快照上执行。若任何可见文档因路径安全
      // 检查/类型检查被拒绝，保留旧索引等待人工处理，避免 files=[] 触发全库误删。
      if (!unsafeDiscovery) {
        const onDisk = new Set(files)
        for (const { doc } of repo.kbDocStats()) {
          if (!onDisk.has(doc) && !DB_ONLY_DOCS.has(doc)) repo.deleteKbDoc(doc)
        }
      }
    })
    return prepared.map(({ file, chunks }) => ({ file, chunks: chunks.length }))
  })
}

async function main(): Promise<void> {
  // kb 灌库 CLI:只需 DB_PATH(缺省同 config-store 默认),不依赖其他 env
  const db = openDb(canonicalDbPath(process.env.DB_PATH ?? "./data/agent.db"))
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
