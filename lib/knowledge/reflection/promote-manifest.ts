import { createHash } from "node:crypto"
import { DEFAULT_KB_CHUNK_MAX_CHARS } from "./compact-chunks"

/**
 * 升格台账的文件名。`.md.disabled` 不匹配 isKbRelPath(只认 .md/.txt),
 * 所以台账自身永远不会被 pnpm ingest 吃成语料;runIngest 的 prune 也不会碰它。
 */
export function promoteManifestRel(date: string, chunkId: number): string {
  return `_meta/${date}-promote-${chunkId}-manifest.md.disabled`
}

/** merge 前的字节快照文件名。与 manifest 同目录同后缀规则。 */
export function promoteSnapshotRel(date: string, chunkId: number): string {
  return `_meta/${date}-promote-${chunkId}-pre-edit.md.disabled`
}

/** 升格单元里的核验日期按 UTC 取,避免部署时区差异让同一条记录反复变动。 */
export function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")
}

/**
 * 台账的消费方有两类:自动/手动升格(Task 6 的 applyPromote)与历史升格文件迁移
 * (把旧 promoted/ 文件归入 retrieval/)。两者的记录字段一致,差别只在 decision
 * 行的措辞与是否有迁移缘由,所以用 variant 区分而不是各写一份正文。
 *
 * 所有路径字段一律是「相对 docs/kb 的 posix 路径」,渲染时统一加 `docs/kb/` 前缀。
 * 混着裸相对路径和全路径会让同一份审计记录自相矛盾——正是台账要防的事。
 */
export interface PromoteManifestInput {
  chunkId: number
  /** promotion=升格流程;migration=历史升格文件迁回 retrieval/ */
  variant: "promotion" | "migration"
  decision: "merge" | "new"
  /** 目标文档 */
  target: string
  /** merge 前的目标文档;新建时为 null */
  originalPath: string | null
  /** 被下线的旧文档;未发生下线时为 null */
  retiredPath: string | null
  /** 迁移缘由;仅 migration 变体渲染 */
  relocationReason: string | null
  /** pre-edit 字节快照 */
  preEditSnapshot: string | null
  preSha256: string | null
  postSha256: string
  sourceStatus: string
  volatility: string
  chunks: readonly string[]
  embeddedChunks: number
  dimension: number | null
  rolledBack: boolean
  date: string
}

/** 相对 docs/kb 的路径 → 台账里的全路径;缺失时用对应文案。 */
function kbPath(rel: string | null, absent: string): string {
  return rel === null ? absent : `docs/kb/${rel}`
}

function decisionText(
  variant: PromoteManifestInput["variant"],
  decision: PromoteManifestInput["decision"]
): string {
  if (variant === "migration")
    return decision === "merge"
      ? "merge（历史迁移：原 promoted/ 文件并入既有 canonical 文档）"
      : "new（历史迁移：原 promoted/ 文件改建 retrieval/ 文档）"
  return decision === "merge"
    ? "merge（追加到既有 canonical 文档，非新建文件）"
    : "new（新建 retrieval/ 文档）"
}

/**
 * 授权与执行段必须跟着变体走。升格是 in-process 写文件 + 同事务写向量,所以
 * ingest 不需要;历史迁移只改磁盘、向量要等显式授权后重建,写成"不需要"就是
 * 假记录——而且与它自己那行「本次写入向量段数：0」自相矛盾。
 */
function authBlock(variant: PromoteManifestInput["variant"]): string {
  return variant === "migration"
    ? `- db_write：迁移脚本直接改磁盘（不经 applyPromote）
- pnpm ingest：需要（本次只改文档,向量待用户显式授权后重建）`
    : `- db_write：in-process applyPromote（文件与向量同一轮，失败自带回滚）
- pnpm ingest：不需要（向量已随本次事务写入 kb_vec）`
}

/**
 * 生成升格台账正文。纯函数、不碰磁盘:正文与两侧 SHA-256 在写盘前就已确定,
 * 所以"台账先于活跃语料"是可满足的,不需要先写文件再回填摘要。
 */
export function promoteManifest(input: PromoteManifestInput): string {
  const lens = input.chunks.map((c) => c.length)
  const longest = lens.length ? Math.max(...lens) : 0
  const withinLimit = longest <= DEFAULT_KB_CHUNK_MAX_CHARS
  const migrationBlock =
    input.variant === "migration"
      ? `## 迁移说明

- 缘由：${input.relocationReason ?? "未说明"}
- 退役为：${kbPath(input.retiredPath, "无（未发生下线）")}

`
      : ""

  return `# ${input.date} 升格反思 #${input.chunkId} — 变更清单

- intent：反思 #${input.chunkId} 升格为正式知识单元
- decision：${decisionText(input.variant, input.decision)}
- target：${kbPath(input.target, "无")}
- original_path：${kbPath(input.originalPath, "无（新建文件）")}
- active_path：${kbPath(input.target, "无")}
- retired_path：${kbPath(input.retiredPath, "无（未发生迁移/下线）")}
- pre-edit snapshot：${kbPath(input.preEditSnapshot, "无（新建文件）")}
- pre-edit SHA-256：${input.preSha256 ?? "无（新建文件）"}
- post-edit SHA-256：${input.postSha256}
- result：${
    input.rolledBack
      ? "rolled_back（DB 写入失败，文件已回滚，原反思条目保留待下轮重试）"
      : "committed"
  }

${migrationBlock}## source_status

- 来源：${input.sourceStatus}
- 动态性：${input.volatility}
- 说明：来源为「QQ 群客服会话反思 #id」表示结论来自群内客服会话，非官方文档逐条核实；
  涉及价格、模型、分组、公告等动态值时以条目自身的动态性声明为准，不视为长期事实。

## 结构预检

- blank-line 单元切分：整份文档 ${input.chunks.length} 段，各段字符数 ${
    lens.join(" / ") || "无"
  }，最长 ${longest}。
- 无 ISOLATED_HEADING（升格单元标题行紧跟正文，无空行）。
- 单段上限 ${DEFAULT_KB_CHUNK_MAX_CHARS} 字符：${
    withinLimit ? "通过" : `超限（最长 ${longest}）`
  }。
- 落盘路径 retrieval/ 前缀：${
    input.target.startsWith("retrieval/") ? "是" : "否（异常，需人工核查）"
  }。

## Embedding

- 模型：Xenova/bge-small-zh-v1.5（mean pooling，normalize）
- 索引向量维度：${input.dimension ?? "未知（空索引）"}
- 本次写入向量段数：${input.embeddedChunks}

## 授权与执行

${authBlock(input.variant)}
`
}
