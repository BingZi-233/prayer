import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Repo } from "./core/db/repo"

/** 升格后正式文档相对路径(相对 docs/kb) */
export function promotedDocRel(chunkId: number): string {
  return `promoted/reflection-${chunkId}.md`
}

/** 升格 Markdown 正文(与历史手动升格格式一致) */
export function promotedMarkdown(chunkId: number, content: string): string {
  return `# 升格反思 #${chunkId}\n\n${content.trim()}\n`
}

export type PromoteResult =
  | { ok: true; file: string; content: string; already?: boolean }
  | { ok: false; reason: string }

export interface ApplyPromoteOpts {
  repo: Repo
  chunkId: number
  embed: (text: string) => Promise<Float32Array>
  /** 知识库根目录(含 docs/kb 的上一级 cwd)。缺省 process.cwd() */
  cwd?: string
  /** 可注入写盘,测试用 */
  writeFileFn?: (abs: string, body: string) => Promise<void>
  mkdirFn?: (dir: string) => Promise<void>
}

/**
 * 将一条 human-reflection 升格为正式文档:
 * 1. 写 docs/kb/promoted/reflection-{id}.md
 * 2. 立即 embed 写入 kb_chunks(doc=相对路径),Agent 检索可命中
 * 3. 物理删除原反思 chunk,避免列表 / 检索残留
 *
 * 幂等:已 promoted 则返回 already,不重写、不再删(原 chunk 早已不在)。
 */
export async function applyPromote(
  opts: ApplyPromoteOpts
): Promise<PromoteResult> {
  const { repo, chunkId, embed } = opts
  // 单条取行(替代全量 reflectionEntries 拉取后再 find)
  const entry = repo.reflectionEntryDetail(chunkId)
  if (!entry) return { ok: false, reason: "条目不存在" }
  if (entry.status === "rejected")
    return { ok: false, reason: "已驳回,不可升格" }
  if (entry.status === "promoted") {
    return {
      ok: true,
      file: promotedDocRel(chunkId),
      content: entry.content,
      already: true,
    }
  }

  const rel = promotedDocRel(chunkId)
  const body = promotedMarkdown(chunkId, entry.content)
  const cwd = opts.cwd ?? process.cwd()
  const abs = join(cwd, "docs/kb", rel)
  const mkdirFn =
    opts.mkdirFn ??
    ((d: string) => mkdir(d, { recursive: true }).then(() => undefined))
  const writeFileFn =
    opts.writeFileFn ?? ((p: string, b: string) => writeFile(p, b, "utf8"))

  await mkdirFn(dirname(abs))
  await writeFileFn(abs, body)

  // 向量先算好:embed 失败(超时等)时 DB 完全未动,条目仍在,可重试
  const vec = await embed(body)

  // 三个 DB 步骤同一事务:中途失败整体回滚,原反思条目保留。
  // 此前是三次独立写且先删后插——崩溃窗口内正式文档会从 KB 消失到重新 ingest。
  repo.transaction(() => {
    // 正式文档入库:先清旧分块再写,保证幂等(同 chunk 重复升格覆盖旧文件)
    repo.deleteKbDoc(rel)
    repo.insertKbEntry(rel, body, rel, vec)
    // 原反思 chunk 物理删除,避免 list / 检索双份残留
    repo.deleteKbChunk(chunkId)
  })

  return { ok: true, file: rel, content: entry.content }
}
