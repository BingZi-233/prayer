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
 * 按「目标层」判定,不按磁盘当前位置:阶段 4 会把 lib/tools/kb.ts 迁往
 * lib/knowledge/,它现在映射到的层就是 knowledge。搬迁中途的物理位置不一致
 * 不算违规,只有最终归属错位才算。
 * 顺序敏感:具体文件规则必须排在目录通配之前。
 *
 * 目录规则必须以 `/` 结尾,精确文件规则不带尾斜杠。`layerOf` 与
 * 「每条精确文件规则都命中真实存在的文件」这条断言都靠这个约定区分两者,
 * 所以谁漏写或多写尾斜杠,断言语义就悄悄变了。
 */
const PREFIX_RULES: Array<[string, Layer]> = [
  ["lib/runtime.ts", "composition"],

  // core —— 目标位
  ["lib/core/", "core"],

  // model
  ["lib/model/", "model"],

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

  // conversation(其余 agent/* 与两个装配模块)
  ["lib/agent/", "conversation"],
  ["lib/transcript.ts", "conversation"],
  ["lib/assemble.ts", "conversation"],
]

/**
 * 已退役的路径前缀。搬迁完成后把该阶段的旧前缀填进来 ——
 * **目录前缀与精确文件前缀都要登记**,「退役前缀没有任何文件命中」用例
 * 会断言没有文件命中它们。
 *
 * 为什么精确文件项也不能省(曾一度只留目录项,是个错误):
 * 退役一条精确文件规则后,若它的**父目录规则仍然存活**,有人把该文件放回去
 * 会被那条目录规则**静默地**归成父目录那一层。此时「退役前缀无命中」
 * 没有该项而放行,
 * 「每条精确规则命中真实文件」查的是规则不是文件,「lib 下每个文件都归属于
 * 某一层」又因规则命中而通过 —— 三条都拦不住,只有这份登记能。
 *
 * 例外情形(父目录无存活规则时)确实可由那两条断言间接拦住,但这需要每次
 * 退役时判断父目录是否还活着,判断错就静默失效。**统一全登记,不做区分。**
 *
 * **这份清单是有界的,别当迁移脚手架删掉。** 上限就是重构前 `lib/` 的文件数,
 * 阶段 4 之后不再增长(粗估 40~45 项封顶)。它是永久的回归护栏 —— 防止有人
 * 把文件挪回重构前的位置,那个位置在层级规则里已被有意作废。
 *
 * **它有一个无法自证的盲区:没人能检测出「你忘了登记某条墓碑」。** 若搬走的
 * 旧路径其父目录规则仍存活(例如 `lib/agent/reflection-poller.ts` 落在活的
 * `lib/agent/`→conversation 之下),漏登记就是真洞 —— 文件被放回去会被静默
 * 归成父目录那一层。父目录已死的漏登记则由「每文件归层」兜住。任何墓碑方案
 * 都有这个盲区,只能靠搬迁时逐条核对,写在这里是为了防后手误判。
 */
const RETIRED_PREFIXES: string[] = [
  "lib/onebot/",
  "lib/db/",
  "lib/config/",
  "lib/bus.ts",
  "lib/logger.ts",
  "lib/log-context.ts",
  "lib/app-context.ts",
  "lib/config-store.ts",
  "lib/auth.ts",
  "lib/settings-writer.ts",
  "lib/concurrency.ts",
  "lib/utils.ts",
  "lib/brand.ts",
  "lib/api.ts",
  "lib/events.ts",
  "lib/name-cache.ts",
  "lib/name-cache-store.ts",
  "lib/group-name.ts",
  "lib/channels/types.ts",
  "lib/channels/ids.ts",
  "lib/channels/enabled-chats.ts",
  "lib/agent/sanitize-input.ts",
  "lib/agent/json-output.ts",
  "lib/agent/timeout.ts",
  "lib/tools/embed.ts",
  "lib/usage-stats.ts",
  "lib/tool-stats.ts",
  "lib/plugins/manager.ts",
  "lib/plugins/",
]

/**
 * 阶段间容忍的逆向依赖。removedBy 是消掉它的阶段标签。
 * 只应存在阶段间的临时条目,不得长期驻留。
 * 边的写法由 scanLib 产出:两端都去掉扩展名,用 " -> " 连接。
 */
const TOLERATED: Array<{ edge: string; removedBy: string }> = []

/** 当前所处阶段。每阶段 PR 更新此常量。 */
const CURRENT_STAGE = "3b"
const STAGE_ORDER = ["0", "1", "2a", "2b", "3a", "3b", "4", "5", "6"]

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

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g

/** 扫描单个文件的源码,产出它引发的逆向依赖边。 */
function collectViolations(fromRel: string, source: string): string[] {
  const from = layerOf(fromRel)
  if (!from) return []
  const abs = join(REPO_ROOT, fromRel)
  const out: string[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    const resolved = resolveSpecifier(abs, match[1])
    if (!resolved) continue
    const to = layerAt(resolved)
    if (!to) continue
    if (RANK[to] > RANK[from])
      out.push(`${fromRel.replace(/\.tsx?$/, "")} -> ${resolved}`)
  }
  return out
}

function scanLib(): string[] {
  const found: string[] = []
  for (const abs of listFiles(LIB_DIR)) {
    const rel = relative(REPO_ROOT, abs)
    found.push(...collectViolations(rel, readFileSync(abs, "utf8")))
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

  it("每条精确文件规则都命中真实存在的文件", () => {
    const files = new Set(
      listFiles(LIB_DIR).map((abs) => relative(REPO_ROOT, abs))
    )
    const dead = PREFIX_RULES.filter(([p]) => !p.endsWith("/"))
      .map(([p]) => p)
      .filter((p) => !files.has(p))
    expect(dead).toEqual([])
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

  it("扫描管线能识别逆向依赖(防止护栏因失灵而空过)", () => {
    const expectEdge = "lib/core/config/chats -> lib/channels/qq/client"
    // 静态 import
    expect(
      collectViolations(
        "lib/core/config/chats.ts",
        `import { OneBotClient } from "../../channels/qq/client"`
      )
    ).toEqual([expectEdge])
    // 动态 import
    expect(
      collectViolations(
        "lib/core/config/chats.ts",
        `const m = await import("../../channels/qq/client")`
      )
    ).toEqual([expectEdge])
    // require
    expect(
      collectViolations(
        "lib/core/config/chats.ts",
        `const m = require("../../channels/qq/client")`
      )
    ).toEqual([expectEdge])
    // 合法方向不报
    expect(
      collectViolations(
        "lib/tools/kb.ts",
        `import { x } from "../core/db/kb-sql"`
      )
    ).toEqual([])
  })

  it("关键路径的分类符合目标层", () => {
    expect(layerOf("lib/core/config/chats.ts")).toBe("core")
    expect(layerOf("lib/core/chat/types.ts")).toBe("core")
    expect(layerOf("lib/channels/qq/members-fetch.ts")).toBe("channels")
    expect(layerOf("lib/model/embed.ts")).toBe("model")
    expect(layerOf("lib/tools/kb.ts")).toBe("knowledge")
    expect(layerOf("lib/agent/agent.ts")).toBe("conversation")
    expect(layerOf("lib/runtime.ts")).toBe("composition")
  })

  it("父目录规则与自身层别不同的文件,其精确规则不得被删", () => {
    // 这些文件靠**精确规则**定层,而它们的父目录规则指向**另一个层**。
    // 一旦精确规则被误删,文件会静默落回父目录那一层,而上面那三条检查
    // 全都抓不到:规则没了「精确规则命中真实文件」查不到,文件仍有归属
    // 「每文件归层」照过,层别变化又不产生逆向依赖。只有钉在这里能拦。
    const exactUnderLiveDir: Array<[string, Layer]> = [
      ["lib/agent/kb-prefetch.ts", "knowledge"],
      ["lib/agent/reflection-poller.ts", "knowledge"],
      ["lib/agent/reflection-compactor.ts", "knowledge"],
      ["lib/agent/reflection-promoter.ts", "knowledge"],
    ]
    for (const [rel, layer] of exactUnderLiveDir) {
      expect(layerOf(rel), rel).toBe(layer)
    }
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
