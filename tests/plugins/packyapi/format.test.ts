import { describe, expect, it } from "vitest"
import {
  formatAnnouncements,
  formatGroups,
  formatModels,
  formatPrice,
  formatRaw,
} from "@/plugins/packyapi/scripts/format"
import { A, IN_PEAK_AM, OFF_PEAK, P } from "./fixture"

describe("formatPrice", () => {
  it("按量组 cc:in=model_ratio*gr*base", () => {
    const out = formatPrice(P, { group: "cc", now: OFF_PEAK })
    // in = 2.5 * 2 * 2 = 10; out = 10*5 = 50; cache = 10*0.1 = 1
    expect(out).toContain("claude-opus-5")
    expect(out).toMatch(/\$10\.00\s+\$50\.00\s+\$1\.00/)
  })

  it("给关键词列该模型全部可用分组", () => {
    const out = formatPrice(P, { keyword: "opus", now: OFF_PEAK })
    expect(out).toContain("cc")
    expect(out).toContain("cc-sale")
    // cc-sale: in = 2.5 * 0.8 * 2 = 4
    expect(out).toMatch(/\$4\.00/)
  })

  it("按次(quota_type=1):price/次 = model_price*gr", () => {
    const out = formatPrice(P, {
      keyword: "gpt-image",
      group: "image",
      now: OFF_PEAK,
    })
    // 0.08 * 5 = 0.4
    expect(out).toContain("$0.4000/次")
  })

  it("base 覆盖生效", () => {
    const out = formatPrice(P, { group: "cc", base: 1, now: OFF_PEAK })
    // in = 2.5 * 2 * 1 = 5
    expect(out).toMatch(/\$5\.00/)
  })

  it("无匹配返回提示", () => {
    expect(formatPrice(P, { keyword: "nope", now: OFF_PEAK })).toContain(
      "无匹配"
    )
  })
})

describe("formatPrice 标记与脚注", () => {
  it("分组倍率覆盖的行标 †,脚注说明来源", () => {
    const out = formatPrice(P, { keyword: "glm", now: OFF_PEAK })
    expect(out).toContain("glm-5.2†")
    // 覆盖后 0.5*1*2 = 1.00,而非全局 model_ratio 算出的 8.00
    expect(out).toContain("$1.00")
    expect(out).not.toContain("$8.00")
    expect(out).toContain("model_group_ratio")
  })

  it("高峰中的行标 *,脚注给倍率、结束时刻与平时价", () => {
    const out = formatPrice(P, {
      group: "deepseek-officially",
      now: IN_PEAK_AM,
    })
    // deepseek-officially 对 deepseek-v4-pro 还有 model_group_ratio 覆盖(0.8 vs
    // 全局 2.25),所以该行同时带 † 与 *,不是单独的 *。
    expect(out).toContain("deepseek-v4-pro†*")
    expect(out).toContain("$3.20")
    expect(out).toContain("×2")
    expect(out).toContain("12:00")
    expect(out).toContain("$1.60")
  })

  it("非高峰时段不出 * 标记也不出脚注", () => {
    const out = formatPrice(P, {
      group: "deepseek-officially",
      now: OFF_PEAK,
    })
    expect(out).toContain("$1.60")
    expect(out).not.toContain("deepseek-v4-pro*")
    expect(out).not.toContain("高峰")
  })

  it("有阶梯价的行标 ‡,脚注给阈值与阶梯价", () => {
    const out = formatPrice(P, { group: "codex", now: OFF_PEAK })
    expect(out).toContain("gpt-5.6-sol‡")
    expect(out).toContain("$2.50") // 基准 in
    expect(out).toContain("272000")
    expect(out).toContain("$5.00") // 阶梯 in
    expect(out).toContain("$22.50") // 阶梯 out
  })

  it("孤儿组的行标 §,脚注说明倍率无定义、按 1 估算", () => {
    const out = formatPrice(P, { group: "hongjing", now: OFF_PEAK })
    expect(out).toContain("gpt-5.6-sol")
    expect(out).toMatch(/gpt-5\.6-sol[†*‡§]*§/)
    expect(out).toContain("$5.00") // 2.5 × 1(估算)× 2
    expect(out).toContain("倍率无定义")
  })

  it("group_ratio 有定义的组不出 § 标记", () => {
    const out = formatPrice(P, { group: "cc", now: OFF_PEAK })
    expect(out).not.toContain("§")
    expect(out).not.toContain("倍率无定义")
  })

  it("cache_ratio 缺失的模型 cache 列出 -,不出 NaN", () => {
    const out = formatPrice(P, { group: "gemini-slb", now: OFF_PEAK })
    expect(out).toContain("gemini-3-pro-preview")
    expect(out).toContain("$6.00")
    expect(out).toContain("$36.00")
    expect(out).not.toContain("NaN")
  })

  it("无特殊计价的行不带任何标记", () => {
    const out = formatPrice(P, { group: "cc", now: OFF_PEAK })
    expect(out).toContain("claude-opus-5 ")
    expect(out).not.toMatch(/claude-opus-5[†*‡§]/)
  })

  it("多档阶梯脚注按 threshold 数值升序,不是字符串字典序", () => {
    const multi = {
      ...P,
      data: P.data.map((m) =>
        m.model_name === "gpt-5.6-sol"
          ? {
              ...m,
              tiers: [
                { threshold: 32000, ratio: 2 },
                { threshold: 128000, ratio: 4 },
              ],
            }
          : m
      ),
    }
    const out = formatPrice(multi, { group: "codex", now: OFF_PEAK })
    // 字典序会把 128000 排到 32000 前面
    expect(out.indexOf("超 32000")).toBeLessThan(out.indexOf("超 128000"))
  })

  it("同模型同倍率的多行按组名稳定排序,不依赖输入顺序", () => {
    // glm-5.2 在 glm-sale 与 zai-officially 下 gr 均为 1 —— 主键与次键都打平,
    // 若无第三级 tie-break,行序会由 API 返回的数组顺序决定
    const out = formatPrice(P, { keyword: "glm-5.2", now: OFF_PEAK })
    const reversed = formatPrice(
      {
        ...P,
        data: P.data.map((m) =>
          m.model_name === "glm-5.2"
            ? { ...m, enable_groups: [...m.enable_groups].reverse() }
            : m
        ),
      },
      { keyword: "glm-5.2", now: OFF_PEAK }
    )
    expect(out).toBe(reversed)
    expect(out.indexOf("glm-sale")).toBeLessThan(out.indexOf("zai-officially"))
  })
})

describe("formatPrice 未知分组", () => {
  it("给出可用组名候选,而非只回无匹配", () => {
    const out = formatPrice(P, { group: "not-a-group", now: OFF_PEAK })
    expect(out).toContain("not-a-group")
    expect(out).toContain("cc")
    expect(out).toContain("codex")
  })

  it("停用组视为已知,不进候选提示分支", () => {
    const out = formatPrice(P, { group: "legacy-off", now: OFF_PEAK })
    expect(out).toContain("无匹配")
    expect(out).not.toContain("可用分组")
  })

  it("孤儿组视为已知:模型声明了它,应出价而非报未知", () => {
    const out = formatPrice(P, { group: "hongjing", now: OFF_PEAK })
    expect(out).not.toContain("未知分组")
  })
})

describe("formatModels", () => {
  it("默认 cc 组列全部", () => {
    // 共享 fixture 里只有 claude-opus-5 在 cc 组(gpt-image-2 只在 image 组),
    // 与旧局部 mock 不同——不能照抄旧断言检查 gpt-image 系模型出现在 cc 组。
    const out = formatModels(P)
    expect(out).toContain("claude-opus-5")
    expect(out).toContain("1 个模型")
  })

  it("endpoint 过滤", () => {
    const out = formatModels(P, { endpoint: "anthropic" })
    expect(out).toContain("claude-opus-5")
    expect(out).not.toContain("gpt-image-2")
  })

  it("组过滤:cc-sale 仅 opus", () => {
    const out = formatModels(P, { group: "cc-sale" })
    expect(out).toContain("claude-opus-5")
    expect(out).not.toContain("glm-5.2")
  })
})

describe("formatGroups", () => {
  it("按倍率升序列出并带说明", () => {
    const out = formatGroups(P)
    const ccSaleIdx = out.indexOf("cc-sale")
    const ccIdx = out.indexOf("\ncc ")
    expect(ccSaleIdx).toBeGreaterThan(-1)
    expect(ccSaleIdx).toBeLessThan(ccIdx) // 0.8 在 2 之前
    expect(out).toContain("claude code专用")
  })
})

describe("formatModels 厂商与端点", () => {
  it("vendor 过滤,不区分大小写", () => {
    const out = formatModels(P, { group: "image", vendor: "openai" })
    expect(out).toContain("gpt-image-2")
    expect(out).not.toContain("glm-5.2")
  })

  it("vendor 无匹配时给出可用厂商名", () => {
    const out = formatModels(P, { group: "cc", vendor: "nope" })
    expect(out).toContain("Anthropic")
  })

  it("endpoint 过滤走分组级覆盖:cc-sale 下 opus 只开 anthropic", () => {
    expect(formatModels(P, { group: "cc", endpoint: "openai" })).toContain(
      "claude-opus-5"
    )
    expect(
      formatModels(P, { group: "cc-sale", endpoint: "openai" })
    ).not.toContain("claude-opus-5")
  })
})

describe("formatGroups 停用标记", () => {
  it("inactive_groups 内的组标 [停用]", () => {
    const out = formatGroups(P)
    expect(out).toMatch(/legacy-off\s+x1\s+\[停用\]/)
    expect(out).not.toMatch(/\ncc\s+x2\s+\[停用\]/)
  })
})

describe("formatRaw", () => {
  it("命中返回 JSON", () => {
    const out = formatRaw(P, "claude-opus-5")
    expect(JSON.parse(out).model_name).toBe("claude-opus-5")
  })
  it("缺 model", () => {
    expect(formatRaw(P)).toContain("需 model")
  })
  it("未找到", () => {
    expect(formatRaw(P, "xxx")).toContain("未找到")
  })
})

describe("formatAnnouncements", () => {
  it("按发布时间降序,新公告在前", () => {
    const out = formatAnnouncements(A)
    expect(out.indexOf("新公告")).toBeLessThan(out.indexOf("老公告"))
    expect(out).toContain("2026-07-08")
    expect(out).toContain("[2] 新公告")
  })

  it("limit 截断", () => {
    const out = formatAnnouncements(A, { limit: 1 })
    expect(out).toContain("新公告")
    expect(out).not.toContain("老公告")
  })

  it("keyword 过滤标题/正文", () => {
    const out = formatAnnouncements(A, { keyword: "sale" })
    expect(out).toContain("新公告")
    expect(out).not.toContain("老公告")
  })

  it("无匹配返回提示", () => {
    expect(formatAnnouncements(A, { keyword: "nope" })).toContain("无公告")
  })
})
