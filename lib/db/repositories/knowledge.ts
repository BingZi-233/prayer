import type { SqliteContext } from "../context.ts"
import type { KbHit } from "../models.ts"
import { KB_SEARCH_SQL } from "../../tools/kb.ts"

/** 知识分块和向量的物理存储；删除时维护关联数据的一致性。 */
export class KnowledgeRepository {
  constructor(private readonly sql: SqliteContext) {}

  // KB 原子写入:chunk + 向量同一事务,避免 embed/向量插入失败时残留孤儿 chunk
  insertKbEntry(
    doc: string,
    content: string,
    source: string,
    embedding: Float32Array
  ): number {
    return this.sql.transaction(() => {
      const id = this.insertKbChunk(doc, content, source)
      this.insertKbVec(id, embedding)
      return id
    })
  }

  insertKbChunk(doc: string, content: string, source: string): number {
    const info = this.sql
      .prepare("INSERT INTO kb_chunks (doc, content, source) VALUES (?, ?, ?)")
      .run(doc, content, source)
    return Number(info.lastInsertRowid)
  }

  insertKbVec(chunkId: number, embedding: Float32Array): void {
    this.sql
      .prepare("INSERT INTO kb_vec (chunk_id, embedding) VALUES (?, ?)")
      .run(BigInt(chunkId), Buffer.from(embedding.buffer))
  }

  // 向量库预览:总量(chunks 与已建向量数,便于发现漏 embed 的孤儿 chunk)
  kbTotals(): { chunks: number; vecs: number } {
    const chunks = this.sql
      .prepare<{
        n: number
      }>("SELECT COUNT(*) n FROM kb_chunks")
      .get()!.n
    const vecs = this.sql
      .prepare<{ n: number }>("SELECT COUNT(*) n FROM kb_vec")
      .get()!.n
    return { chunks, vecs }
  }

  // 按 doc 分组的 chunk 数,doc 升序(与文件列表同一相对路径标识)
  kbDocStats(): { doc: string; chunks: number }[] {
    return this.sql
      .prepare<{ doc: string; chunks: number }>(
        "SELECT doc, COUNT(*) chunks FROM kb_chunks GROUP BY doc ORDER BY doc"
      )
      .all()
  }

  // 单 doc 的分块内容,按 id 升序(即入库/切分顺序)
  kbChunksByDoc(doc: string): { id: number; content: string }[] {
    return this.sql
      .prepare<{ id: number; content: string }>(
        "SELECT id, content FROM kb_chunks WHERE doc = ? ORDER BY id"
      )
      .all(doc)
  }

  // 删文档对应的全部 chunk+vec(文件删除 / 重建前清理用)。返回删除的 chunk 数。
  deleteKbDoc(doc: string): number {
    return this.sql.transaction(() => {
      const ids = this.sql
        .prepare<{
          id: number
        }>("SELECT id FROM kb_chunks WHERE doc = ?")
        .all(doc)
        .map((r) => r.id)
      if (!ids.length) return 0
      const ph = ids.map(() => "?").join(",")
      this.sql
        .prepare(`DELETE FROM kb_vec WHERE chunk_id IN (${ph})`)
        .run(...ids)
      const info = this.sql
        .prepare(`DELETE FROM kb_chunks WHERE id IN (${ph})`)
        .run(...ids)
      return info.changes
    })
  }

  // 单 chunk 物理删除:kb_vec + kb_chunks + reflection_meta 三表联动,事务内完成。
  // 用于反思条目升格后清理原 human-reflection chunk(避免列表/检索双重残留)。
  // 返回是否实际删除(0 = 无此 id)。
  deleteKbChunk(chunkId: number): boolean {
    return this.sql.transaction(() => {
      this.sql.prepare("DELETE FROM kb_vec WHERE chunk_id = ?").run(chunkId)
      const info = this.sql
        .prepare("DELETE FROM kb_chunks WHERE id = ?")
        .run(chunkId)
      this.sql
        .prepare("DELETE FROM reflection_meta WHERE chunk_id = ?")
        .run(chunkId)
      return info.changes > 0
    })
  }

  // 重命名文档:同步更新 doc;source 若等于旧路径也一并改(文件入库时 source=路径)。
  renameKbDoc(from: string, to: string): number {
    const info = this.sql
      .prepare(
        `UPDATE kb_chunks
         SET doc = ?,
             source = CASE WHEN source = ? THEN ? ELSE source END
         WHERE doc = ?`
      )
      .run(to, from, to, from)
    return info.changes
  }

  // 向量近邻检索。驳回/已升格的反思不参与命中:
  // - rejected:人工纠错须立刻从检索消失
  // - promoted:知识已固化到正式文档(promoted/*.md),避免与正式 chunk 重复占 top-k
  // 无 meta / 非反思文档一律视为可检索(沉淀默认 approved)。
  searchKb(query: Float32Array, k: number): KbHit[] {
    const rows = this.sql
      .prepare<KbHit>(KB_SEARCH_SQL)
      .all(Buffer.from(query.buffer), k)
    return rows
  }

  // 只在基础文档(doc != human-reflection)里做向量近邻,供压缩整理取权威上下文。
  // vec0 KNN 混合反思与基础条目;反思聚集时前 N 名可能被反思占满,故逐步放大候选池
  // 直到凑够 k 条基础条目或达上限(2000),避免静默少取。
  searchBaseKb(query: Float32Array, k: number): KbHit[] {
    const buf = Buffer.from(query.buffer)
    const stmt = this.sql.prepare<KbHit>(
      `SELECT c.id, c.content, c.source, v.distance
       FROM kb_vec v JOIN kb_chunks c ON c.id = v.chunk_id
       WHERE v.embedding MATCH ? AND k = ?
         AND c.doc != 'human-reflection'
       ORDER BY v.distance`
    )
    for (const cand of [k * 4, k * 16, 2000]) {
      const rows = stmt.all(buf, cand)
      if (rows.length >= k || cand >= 2000) return rows.slice(0, k)
    }
    return []
  }
}
