import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  toolStats,
  kbCoverage,
  shortToolName,
  bindToolStatsPersistence,
  RUN_TOTAL_TOOL,
  KB_PREFETCH_TOOL,
  KB_GROUNDED_TOOL,
} from "@/lib/model/stats/tool"

const KB = "mcp__plugin_cs_cs__kb_search"
const PACKY = "mcp__plugin_packyapi_packyapi__packy"

beforeEach(() => {
  toolStats.setPersist(undefined)
  toolStats.reset()
})

describe("toolStats.recordRun", () => {
  it("同一 run 内同工具多次调用 → runs +1、calls +N", () => {
    toolStats.recordRun("agent", { [KB]: 2, [PACKY]: 1 })
    const s = toolStats.snapshot().agent
    expect(s[KB]).toEqual({ runs: 1, calls: 2 })
    expect(s[PACKY]).toEqual({ runs: 1, calls: 1 })
  })

  it("自动补 __run__ 行:runs=1,calls=本 run 全部调用之和", () => {
    toolStats.recordRun("agent", { [KB]: 2, [PACKY]: 1 })
    expect(toolStats.snapshot().agent[RUN_TOTAL_TOOL]).toEqual({
      runs: 1,
      calls: 3,
    })
  })

  it("无工具调用的 run 也计入 __run__", () => {
    toolStats.recordRun("agent", {})
    expect(toolStats.snapshot().agent[RUN_TOTAL_TOOL]).toEqual({
      runs: 1,
      calls: 0,
    })
  })

  it("多次 run 累加", () => {
    toolStats.recordRun("agent", { [KB]: 1 })
    toolStats.recordRun("agent", { [KB]: 3 })
    expect(toolStats.snapshot().agent[KB]).toEqual({ runs: 2, calls: 4 })
  })

  it("次数 <= 0 的工具不入账", () => {
    toolStats.recordRun("agent", { [KB]: 0 })
    expect(toolStats.snapshot().agent[KB]).toBeUndefined()
  })

  it("snapshot 是深拷贝,改它不影响内部状态", () => {
    toolStats.recordRun("agent", { [KB]: 1 })
    const snap = toolStats.snapshot()
    snap.agent[KB].calls = 999
    expect(toolStats.snapshot().agent[KB].calls).toBe(1)
  })

  it("reset 清空", () => {
    toolStats.recordRun("agent", { [KB]: 1 })
    toolStats.reset()
    expect(toolStats.snapshot()).toEqual({})
  })
})

describe("kbCoverage", () => {
  it("按 __kb_grounded__ / __run__ 算比率,并拆出两个来源", () => {
    toolStats.recordRun("agent", {
      [KB]: 1,
      [KB_PREFETCH_TOOL]: 1,
      [KB_GROUNDED_TOOL]: 1,
    })
    toolStats.recordRun("agent", {
      [KB_PREFETCH_TOOL]: 1,
      [KB_GROUNDED_TOOL]: 1,
    })
    toolStats.recordRun("agent", {})
    const c = kbCoverage(toolStats.snapshot().agent)
    expect(c).toEqual({
      totalRuns: 3,
      groundedRuns: 2,
      searchRuns: 1,
      prefetchRuns: 2,
      ratio: 2 / 3,
    })
  })

  it("无数据时 ratio 为 0(不是 NaN)", () => {
    expect(kbCoverage(undefined).ratio).toBe(0)
    expect(kbCoverage({}).ratio).toBe(0)
  })
})

describe("shortToolName", () => {
  it("剥掉 MCP 前缀", () => {
    expect(shortToolName(KB)).toBe("kb_search")
    expect(shortToolName(PACKY)).toBe("packy")
  })

  it("非 MCP 名原样返回", () => {
    expect(shortToolName("Skill")).toBe("Skill")
    expect(shortToolName(RUN_TOTAL_TOOL)).toBe(RUN_TOTAL_TOOL)
  })
})

describe("bindToolStatsPersistence", () => {
  it("把整 run 的行交给 repo", () => {
    const addToolStatsDaily = vi.fn()
    const unbind = bindToolStatsPersistence({ addToolStatsDaily } as never)
    toolStats.recordRun("agent", { [KB]: 2 })
    expect(addToolStatsDaily).toHaveBeenCalledTimes(1)
    const [, site, rows] = addToolStatsDaily.mock.calls[0]
    expect(site).toBe("agent")
    expect(rows).toEqual([
      { tool: KB, runs: 1, calls: 2 },
      { tool: RUN_TOTAL_TOOL, runs: 1, calls: 2 },
    ])
    unbind()
    toolStats.recordRun("agent", { [KB]: 1 })
    expect(addToolStatsDaily).toHaveBeenCalledTimes(1)
  })

  it("持久化抛错不冒泡,内存计数照常", () => {
    bindToolStatsPersistence({
      addToolStatsDaily: () => {
        throw new Error("db closed")
      },
    } as never)
    expect(() => toolStats.recordRun("agent", { [KB]: 1 })).not.toThrow()
    expect(toolStats.snapshot().agent[KB]).toEqual({ runs: 1, calls: 1 })
  })
})
