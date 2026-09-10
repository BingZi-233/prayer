import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

type Layer =
  "core" | "model" | "channels" | "knowledge" | "conversation" | "composition"

/** 数值越大越靠上。文件只可 import 层号 <= 自己的层。 */
const RANK: Record<Layer, number> = {
  core: 0,
  model: 1,
  channels: 2,
  knowledge: 2,
  conversation: 3,
  composition: 4,
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "../..")
const LIB_DIR = join(REPO_ROOT, "lib")

/**
 * 前缀 -> 该文件最终归属的层。
 * 按「目标层」判定,不按磁盘当前位置:lib/channels/types.ts 眼下仍在
 * channels/ 下,但它最终去 lib/core/chat/,这里就记 core。搬迁中途的
 * 物理位置不一致不算违规,只有最终归属错位才算。
 * 顺序敏感:具体文件规则必须排在目录通配之前。
 */
const PREFIX_RULES: Array<[string, Layer]> = [
  ["lib/runtime.ts", "composition"],

  // core —— 目标位
  ["lib/core/", "core"],
  // core —— 当前位置
  ["lib/db/", "core"],
  ["lib/config/", "core"],
  ["lib/bus.ts", "core"],
  ["lib/logger.ts", "core"],
  ["lib/log-context.ts", "core"],
  ["lib/app-context.ts", "core"],
  ["lib/config-store.ts", "core"],
  ["lib/auth.ts", "core"],
  ["lib/settings-writer.ts", "core"],
  ["lib/concurrency.ts", "core"],
  ["lib/utils.ts", "core"],
  ["lib/brand.ts", "core"],
  ["lib/api.ts", "core"],
  ["lib/events.ts", "core"],
  ["lib/name-cache.ts", "core"],
  ["lib/name-cache-store.ts", "core"],
  ["lib/group-name.ts", "core"],
  // 通道词汇:目标 core/chat,当前位置仍在 channels/
  ["lib/channels/types.ts", "core"],
  ["lib/channels/ids.ts", "core"],
  ["lib/channels/enabled-chats.ts", "core"],

  // model
  ["lib/tools/embed.ts", "model"],
  ["lib/agent/sanitize-input.ts", "model"],
  ["lib/agent/json-output.ts", "model"],
  ["lib/agent/timeout.ts", "model"],
  ["lib/usage-stats.ts", "model"],
  ["lib/tool-stats.ts", "model"],
  ["lib/plugins/manager.ts", "model"],

  // knowledge
  ["lib/tools/kb.ts", "knowledge"],
  ["lib/kb-path.ts", "knowledge"],
  ["lib/agent/kb-prefetch.ts", "knowledge"],
  ["lib/agent/reflection-poller.ts", "knowledge"],
  ["lib/agent/reflection-compactor.ts", "knowledge"],
  ["lib/agent/reflection-promoter.ts", "knowledge"],
  ["lib/reflect-promote.ts", "knowledge"],
  ["lib/reflect-stats.ts", "knowledge"],

  // channels
  ["lib/channels/", "channels"],
  ["lib/onebot/", "channels"],

  // conversation(其余 agent/* 与两个装配模块)
  ["lib/agent/", "conversation"],
  ["lib/transcript.ts", "conversation"],
  ["lib/assemble.ts", "conversation"],
]

/**
 * 已退役的前缀。阶段 N 完成搬迁后,把该阶段的旧前缀填进来,
 * 「退役前缀已清空」用例会断言没有任何文件命中它。
 */
const RETIRED_PREFIXES: string[] = []

/**
 * 阶段间容忍的逆向依赖。removedBy 是消掉它的阶段标签。
 * 只应存在阶段间的临时条目,不得长期驻留。
 * 边的写法由 scanLib 产出:两端都去掉扩展名,用 " -> " 连接。
 */
const TOLERATED: Array<{ edge: string; removedBy: string }> = [
  { edge: "lib/agent/reflection-compactor -> lib/agent/agent", removedBy: "3" },
  { edge: "lib/agent/reflection-poller -> lib/agent/agent", removedBy: "3" },
  { edge: "lib/agent/reflection-promoter -> lib/agent/agent", removedBy: "3" },
]

/** 当前所处阶段。每阶段 PR 更新此常量。 */
const CURRENT_STAGE = "0"
const STAGE_ORDER = ["0", "1", "2a", "2b", "3", "4", "5", "6"]

function layerOf(rel: string): Layer | null {
  for (const [prefix, layer] of PREFIX_RULES) {
    const hit = prefix.endsWith("/") ? rel.startsWith(prefix) : rel === prefix
    if (hit) return layer
  }
  return null
}

const TS_EXTS = [".ts", ".tsx"]

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) listFiles(abs, out)
    else if (TS_EXTS.some((ext) => abs.endsWith(ext))) out.push(abs)
  }
  return out
}

function resolveSpecifier(fromAbs: string, spec: string): string | null {
  let rel: string
  if (spec.startsWith("@/")) rel = spec.slice(2)
  else if (spec.startsWith("."))
    rel = relative(REPO_ROOT, resolve(dirname(fromAbs), spec))
  else return null
  return rel.replace(/\.ts$/, "")
}

/** 解析出被导入文件真正的层,兼容 lib/x.ts 与 lib/x/index.ts 两种落点。 */
function layerAt(rel: string): Layer | null {
  for (const candidate of [`${rel}.ts`, rel, `${rel}/index.ts`]) {
    const layer = layerOf(candidate)
    if (layer) return layer
  }
  return null
}

/** 给定两个仓库内相对路径,判断是否构成逆向依赖。 */
function isViolation(fromRel: string, toRel: string): boolean {
  const from = layerOf(fromRel)
  const to = layerOf(toRel)
  if (!from || !to) throw new Error(`未归层: ${fromRel} 或 ${toRel}`)
  return RANK[to] > RANK[from]
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g

function scanLib(): string[] {
  const found: string[] = []
  for (const abs of listFiles(LIB_DIR)) {
    const rel = relative(REPO_ROOT, abs)
    const from = layerOf(rel)
    if (!from) continue
    const src = readFileSync(abs, "utf8")
    for (const match of src.matchAll(IMPORT_RE)) {
      const resolved = resolveSpecifier(abs, match[1])
      if (!resolved) continue
      const to = layerAt(resolved)
      if (!to) continue
      if (RANK[to] > RANK[from])
        found.push(`${rel.replace(/\.tsx?$/, "")} -> ${resolved}`)
    }
  }
  return [...new Set(found)].sort()
}

describe("分层结构契约", () => {
  it("lib 下每个文件都归属于某一层", () => {
    const unassigned = listFiles(LIB_DIR)
      .map((abs) => relative(REPO_ROOT, abs))
      .filter((rel) => layerOf(rel) === null)
    expect(unassigned).toEqual([])
  })

  it("已退役前缀没有任何文件命中", () => {
    const hits = listFiles(LIB_DIR)
      .map((abs) => relative(REPO_ROOT, abs))
      .filter((rel) => RETIRED_PREFIXES.some((p) => rel.startsWith(p)))
    expect(hits).toEqual([])
  })

  it("逆向依赖与容忍集合精确一致", () => {
    expect(scanLib()).toEqual(TOLERATED.map((t) => t.edge).sort())
  })

  it("没有早该消失的容忍条目", () => {
    const stale = TOLERATED.filter(
      (t) =>
        STAGE_ORDER.indexOf(t.removedBy) <= STAGE_ORDER.indexOf(CURRENT_STAGE)
    )
    expect(stale).toEqual([])
  })

  it("扫描器能识别逆向依赖(防止护栏因失灵而空过)", () => {
    // 合法的向下依赖
    expect(
      isViolation("lib/agent/reflection-poller.ts", "lib/tools/embed.ts")
    ).toBe(false)
    expect(isViolation("lib/tools/kb.ts", "lib/db/kb-sql.ts")).toBe(false)
    // 逆向:core 文件引传输实现
    expect(
      isViolation("lib/config/chats.ts", "lib/channels/tg/client.ts")
    ).toBe(true)
    // 逆向:知识层引会话层
    expect(
      isViolation("lib/agent/reflection-poller.ts", "lib/agent/agent.ts")
    ).toBe(true)
  })

  it("components/ 只依赖 core", () => {
    const bad: string[] = []
    for (const abs of listFiles(join(REPO_ROOT, "components"))) {
      const rel = relative(REPO_ROOT, abs)
      const src = readFileSync(abs, "utf8")
      for (const match of src.matchAll(IMPORT_RE)) {
        const resolved = resolveSpecifier(abs, match[1])
        if (!resolved || !resolved.startsWith("lib/")) continue
        const to = layerAt(resolved)
        if (to && RANK[to] > RANK.core) bad.push(`${rel} -> ${resolved}`)
      }
    }
    expect([...new Set(bad)].sort()).toEqual([])
  })
})
