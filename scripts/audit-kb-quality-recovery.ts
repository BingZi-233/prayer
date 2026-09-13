import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { embed as productionEmbed } from "../lib/model/embed.ts"
import { splitCompactedFaq } from "../lib/knowledge/reflection/compact-chunks.ts"

export interface CorpusFile {
  path: string
  text: string
}

export interface CorpusAuditIssue {
  code: "OVERSIZED_UNIT" | "DUPLICATE_PATH"
  path: string
  detail: string
}

export interface CorpusAuditReport {
  status: "PASS" | "FAIL"
  files: number
  units: number
  minChars: number | null
  maxChars: number | null
  issues: CorpusAuditIssue[]
}

export interface CorpusAuditOptions {
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 500

function rawUnits(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((unit) => unit.trim())
    .filter(Boolean)
}

function normalizedUnit(text: string): string {
  return text.replace(/\s+/g, " ").trim().normalize("NFKC").toLocaleLowerCase()
}

/**
 * 只读结构审计：不会改文件，也不会触碰 SQLite。重复检测保留路径信息，
 * 以便发现 promoted/archive 与当前 retrieval 同时可见的旧知识。
 */
export function auditCorpusFiles(
  files: CorpusFile[],
  options: CorpusAuditOptions = {}
): CorpusAuditReport {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new RangeError("maxChars must be a positive finite number")
  }

  const issues: CorpusAuditIssue[] = []
  const occurrences = new Map<string, Set<string>>()
  const lengths: number[] = []
  let units = 0

  for (const file of files) {
    for (const unit of rawUnits(file.text)) {
      const key = normalizedUnit(unit)
      const paths = occurrences.get(key) ?? new Set<string>()
      paths.add(file.path)
      occurrences.set(key, paths)
      if (unit.length > maxChars) {
        issues.push({
          code: "OVERSIZED_UNIT",
          path: file.path,
          detail: `unit has ${unit.length} chars; limit is ${maxChars}`,
        })
      }
      const chunks = splitCompactedFaq(unit, maxChars)
      units += chunks.length
      lengths.push(...chunks.map((chunk) => chunk.length))
    }
  }

  for (const [unit, paths] of occurrences) {
    if (paths.size < 2) continue
    const listed = [...paths].sort()
    issues.push({
      code: "DUPLICATE_PATH",
      path: listed.join(","),
      detail: `same normalized unit appears in ${listed.length} paths (${unit.slice(0, 80)})`,
    })
  }

  return {
    status: issues.length === 0 ? "PASS" : "FAIL",
    files: files.length,
    units,
    minChars: lengths.length ? Math.min(...lengths) : null,
    maxChars: lengths.length ? Math.max(...lengths) : null,
    issues,
  }
}

export function readMarkdownCorpus(root: string): CorpusFile[] {
  const files = readdirSync(root, { recursive: true })
    .map((entry) => String(entry).split(sep).join("/"))
    .filter((entry) => entry.endsWith(".md"))
    .filter((entry) => statSync(join(root, entry)).isFile())
    .sort()
  return files.map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }))
}

export interface TokenSummary {
  model: string
  units: number
  maxTokens: number
  overLimit: number
}

/** Run the same tokenizer family used by the retrieval validation workflow. */
export async function tokenizeCorpus(
  files: CorpusFile[],
  maxTokens = 512
): Promise<TokenSummary> {
  const { AutoTokenizer } = await import("@huggingface/transformers")
  const model = "Xenova/bge-small-zh-v1.5"
  const tokenizer = await AutoTokenizer.from_pretrained(model)
  let units = 0
  let max = 0
  let overLimit = 0
  for (const file of files) {
    for (const unit of rawUnits(file.text).flatMap((value) =>
      splitCompactedFaq(value)
    )) {
      const encoded = tokenizer(unit, {
        add_special_tokens: true,
        truncation: false,
      }) as unknown as {
        input_ids: { data: ArrayLike<number | bigint>; dims?: number[] }
      }
      const ids = encoded.input_ids.data
      const sequenceLength = encoded.input_ids.dims?.length
        ? encoded.input_ids.dims[encoded.input_ids.dims.length - 1]
        : ids.length
      units++
      max = Math.max(max, sequenceLength)
      if (sequenceLength > maxTokens) overLimit++
    }
  }
  return { model, units, maxTokens: max, overLimit }
}

export interface RetrievalHit {
  path: string
  distance: number
  text: string
}

export interface RetrievalSummary {
  query: string
  hits: RetrievalHit[]
  dynamicReflectionHits: number
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  if (!Number.isFinite(dot) || aa === 0 || bb === 0) return Number.POSITIVE_INFINITY
  return 1 - dot / Math.sqrt(aa * bb)
}

/**
 * 用生产 embedding 函数做纯内存 top-k 回放；不运行 ingest，也不写数据库。
 */
export async function retrievalSmoke(
  files: CorpusFile[],
  queries: string[],
  embed: (text: string) => Promise<Float32Array> = productionEmbed,
  topK = 5
): Promise<RetrievalSummary[]> {
  const chunks: { path: string; text: string; vector: Float32Array }[] = []
  for (const file of files) {
    for (const text of rawUnits(file.text).flatMap((unit) =>
      splitCompactedFaq(unit)
    )) {
      chunks.push({ path: file.path, text, vector: await embed(text) })
    }
  }
  const out: RetrievalSummary[] = []
  for (const query of queries) {
    const vector = await embed(query)
    const hits = chunks
      .map((chunk) => ({
        path: chunk.path,
        text: chunk.text,
        distance: cosineDistance(vector, chunk.vector),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topK)
    out.push({
      query,
      hits,
      dynamicReflectionHits: hits.filter((hit) =>
        /human-reflection|promoted|reflection/i.test(hit.path)
      ).length,
    })
  }
  return out
}

const DEFAULT_QUERIES = [
  "API 503 QPS TPM 401 调用报错排查",
  "Codex 登录 API key base_url 配置",
  "CC Switch 修改配置后不生效",
  "发票 退款 余额 用量",
  "图像生成 401 403 404 编辑错误",
]

async function main(): Promise<void> {
  const root = process.argv[2] ?? "docs/kb/retrieval"
  const files = readMarkdownCorpus(root)
  const structure = auditCorpusFiles(files)
  const tokens = await tokenizeCorpus(files)
  const retrieval = await retrievalSmoke(files, DEFAULT_QUERIES)
  console.log(
    JSON.stringify(
      {
        root,
        structure,
        tokenizer: tokens,
        embedding: { model: "Xenova/bge-small-zh-v1.5", expectedDimension: 512 },
        retrieval,
        note: "read-only; production ingest and persistent DB writes were not run",
      },
      null,
      2
    )
  )
  if (structure.status !== "PASS" || tokens.overLimit > 0) process.exitCode = 1
}

if (process.argv[1]?.endsWith("audit-kb-quality-recovery.ts")) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
