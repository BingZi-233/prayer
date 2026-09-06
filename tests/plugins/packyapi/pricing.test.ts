import { describe, expect, it } from "vitest"
import {
  resolveGroups,
  resolvePrice,
  type MeteredPrice,
  type PerCallPrice,
  type Pricing,
} from "@/plugins/packyapi/scripts/pricing"
// 判别联合收窄的小 helper,按次计价专用
function perCall(d: Pricing, model: string, group: string): PerCallPrice {
  const p = resolvePrice(d, model, group)
  if (!p || p.quotaType !== 1) throw new Error(`${model}@${group} 不是按次计价`)
  return p
}
import { IN_PEAK_AM, IN_PEAK_PM, OFF_PEAK, P, WEEKEND } from "./fixture"

// 判别联合收窄的小helper:让断言不必写 `as` 或 `!`
function metered(model: string, group: string, base?: number): MeteredPrice {
  const p = resolvePrice(P, model, group, base === undefined ? {} : { base })
  if (!p || p.quotaType !== 0) throw new Error(`${model}@${group} 不是按量计价`)
  return p
}

// 与 metered() 同理,但接受任意 Pricing 变体(用于 {...P, peak_active: {...}} 这类构造)
function meteredOf(
  d: Pricing,
  model: string,
  group: string,
  now?: Date
): MeteredPrice {
  const p = resolvePrice(d, model, group, now === undefined ? {} : { now })
  if (!p || p.quotaType !== 0) throw new Error(`${model}@${group} 不是按量计价`)
  return p
}

describe("resolvePrice 基础计价", () => {
  it("无覆盖时用全局 model_ratio:in = model_ratio*gr*base", () => {
    const p = metered("claude-opus-5", "cc")
    // 2.5 * 2 * 2 = 10
    expect(p.input).toBeCloseTo(10)
    expect(p.output).toBeCloseTo(50) // 10 * 5
    expect(p.cacheRead).toBeCloseTo(1) // 10 * 0.1
    expect(p.ratioSource).toBe("global")
  })

  it("cache_creation_ratio_5m 存在时给出缓存写入价", () => {
    expect(metered("claude-opus-5", "cc").cacheWrite).toBeCloseTo(12.5)
  })

  it("cache_creation_ratio_5m 缺失时 cacheWrite 为 undefined", () => {
    expect(metered("glm-5.2", "glm-sale").cacheWrite).toBeUndefined()
  })

  it("cache_ratio 缺失时 cacheRead 为 undefined 而非 NaN", () => {
    const p = metered("gemini-3-pro-preview", "gemini-slb")
    expect(p.input).toBeCloseTo(6) // 1 * 3 * 2
    expect(p.output).toBeCloseTo(36)
    expect(p.cacheRead).toBeUndefined()
    expect(p.cacheRead).not.toBeNaN()
  })

  it("base 可覆盖", () => {
    expect(metered("claude-opus-5", "cc", 1).input).toBeCloseTo(5)
  })

  it("模型不存在返回 undefined", () => {
    expect(resolvePrice(P, "nope", "cc")).toBeUndefined()
  })

  it("data 为空数组时返回 undefined", () => {
    expect(
      resolvePrice({ ...P, data: [] }, "claude-opus-5", "cc")
    ).toBeUndefined()
  })
})

describe("resolvePrice 分组倍率覆盖(model_group_ratio)", () => {
  it("组内专属倍率压过全局 model_ratio", () => {
    const p = metered("glm-5.2", "glm-sale")
    // 覆盖前会算成 4*1*2 = 8(升级前的错误报价),覆盖后 0.5*1*2 = 1
    expect(p.input).toBeCloseTo(1)
    expect(p.output).toBeCloseTo(3.5)
    expect(p.ratioSource).toBe("group-override")
  })

  it("不同组各自取自己的覆盖值", () => {
    const p = metered("glm-5.2", "zai-officially")
    expect(p.input).toBeCloseTo(1.8) // 0.9 * 1 * 2
    expect(p.ratioSource).toBe("group-override")
  })

  it("该组无覆盖条目时回落全局", () => {
    const p = metered("claude-opus-5", "cc-sale")
    expect(p.input).toBeCloseTo(4) // 2.5 * 0.8 * 2
    expect(p.ratioSource).toBe("global")
  })

  it("覆盖值为 0 时保留 0,不因 falsy 回落全局", () => {
    const zero = {
      ...P,
      model_group_ratio: { cc: { "claude-opus-5": 0 } },
    }
    const p = resolvePrice(zero, "claude-opus-5", "cc")
    expect(p?.quotaType).toBe(0)
    expect((p as MeteredPrice).input).toBe(0)
    expect(p?.ratioSource).toBe("group-override")
  })

  it("覆盖值为 null 时回落全局,且 ratioSource 如实报 global", () => {
    const nulled = {
      ...P,
      model_group_ratio: {
        cc: { "claude-opus-5": null as unknown as number },
      },
    }
    const p = resolvePrice(nulled, "claude-opus-5", "cc")
    expect((p as MeteredPrice).input).toBeCloseTo(10)
    expect(p?.ratioSource).toBe("global")
  })
})

describe("resolvePrice 孤儿组与未知组(grSource)", () => {
  it("group_ratio 有定义时 grSource 为 defined", () => {
    expect(metered("gpt-5.6-sol", "codex").grSource).toBe("defined")
  })

  it("孤儿组(enable_groups 里有、group_ratio 里没有)倍率按 1 估算并标记", () => {
    const p = metered("gpt-5.6-sol", "hongjing")
    expect(p.input).toBeCloseTo(5) // 2.5 * 1 * 2
    expect(p.grSource).toBe("fallback-1")
  })
})

describe("resolvePrice 只为模型真实可用的组出价", () => {
  it("模型不在该组时返回 undefined,即使该组倍率有定义", () => {
    // glm-5.2 的 enable_groups 不含 cc。若不校验配对,会拿 cc 的倍率 2 乘全局
    // model_ratio 4 算出 16,而该模型在真实可用组 glm-sale 下只要 1
    expect(resolvePrice(P, "glm-5.2", "cc")).toBeUndefined()
    expect(metered("glm-5.2", "glm-sale").input).toBeCloseTo(1)
  })

  it("完全不存在的组名返回 undefined", () => {
    expect(resolvePrice(P, "glm-5.2", "no-such-group")).toBeUndefined()
  })

  it("孤儿组是模型真实声明的,照常出价", () => {
    expect(metered("gpt-5.6-sol", "hongjing").input).toBeCloseTo(5)
  })

  it("quota_type 不是 0 或 1 时不出价", () => {
    const weird = {
      ...P,
      data: P.data.map((m) =>
        m.model_name === "claude-opus-5" ? { ...m, quota_type: 2 } : m
      ),
    }
    expect(resolvePrice(weird, "claude-opus-5", "cc")).toBeUndefined()
  })
})

describe("resolvePrice 按次计价(quota_type=1)", () => {
  it("perCall = model_price * group_ratio,判别联合不暴露按量字段", () => {
    const p = resolvePrice(P, "gpt-image-2", "image")
    expect(p?.quotaType).toBe(1)
    expect((p as PerCallPrice).perCall).toBeCloseTo(0.4) // 0.08 * 5
    expect("input" in (p as object)).toBe(false)
  })
})

describe("resolvePrice 端点与厂商", () => {
  it("model_group_endpoints 覆盖优先于 supported_endpoint_types", () => {
    expect(resolvePrice(P, "claude-opus-5", "cc")?.endpoints).toEqual([
      "anthropic",
      "openai",
    ])
    expect(resolvePrice(P, "claude-opus-5", "cc-sale")?.endpoints).toEqual([
      "anthropic",
    ])
  })

  it("组级端点覆盖为空数组时保留空数组,不回落全局", () => {
    const none = {
      ...P,
      model_group_endpoints: { cc: { "claude-opus-5": [] } },
    }
    expect(resolvePrice(none, "claude-opus-5", "cc")?.endpoints).toEqual([])
  })

  it("vendor_id 映射到 vendors 名称", () => {
    expect(resolvePrice(P, "glm-5.2", "glm-sale")?.vendor).toBe("智谱")
  })

  it("vendors 里查不到时 vendor 为 undefined", () => {
    const noVendors = { ...P, vendors: [] }
    expect(
      resolvePrice(noVendors, "glm-5.2", "glm-sale")?.vendor
    ).toBeUndefined()
  })
})

describe("resolveGroups", () => {
  it("返回模型的 enable_groups,按名排序以保证输出确定", () => {
    expect(resolveGroups(P, "glm-5.2")).toEqual(["glm-sale", "zai-officially"])
    expect(resolveGroups(P, "gpt-5.6-sol")).toEqual(["codex", "hongjing"])
  })

  it("未知模型返回空数组", () => {
    expect(resolveGroups(P, "nope")).toEqual([])
  })
})

describe("resolvePrice 高峰浮动价(peak_pricing)", () => {
  // deepseek-v4-pro 平时价:组覆盖倍率 0.8 × gr 1 × base 2 = 1.6
  //   output = 1.6 * completion_ratio 3 = 4.8
  //   cacheRead = 1.6 * cache_ratio 0.0333 = 0.05328
  it("上午窗口内:token 价整体 × factor,并保留平时价", () => {
    const p = meteredOf(P, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
    expect(p.input).toBeCloseTo(3.2) // 1.6 × 2
    expect(p.output).toBeCloseTo(9.6) // 4.8 × 2
    expect(p.cacheRead).toBeCloseTo(0.10656, 5) // 0.05328 × 2
    expect(p.peak?.factor).toBe(2)
    expect(p.peak?.until).toBe("12:00")
    expect(p.peak?.offPeakInput).toBeCloseTo(1.6)
    expect(p.peak?.offPeakOutput).toBeCloseTo(4.8)
    // 高峰与分组倍率覆盖同时生效,互不干扰
    expect(p.ratioSource).toBe("group-override")
  })

  it("下午窗口内:命中第二个 window,until 为该窗口结束时刻", () => {
    const p = meteredOf(P, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_PM)
    expect(p.input).toBeCloseTo(3.2)
    expect(p.peak?.until).toBe("18:00")
  })

  it("工作日两窗口之间:不加价", () => {
    const p = meteredOf(P, "deepseek-v4-pro", "deepseek-officially", OFF_PEAK)
    expect(p.input).toBeCloseTo(1.6)
    expect(p.peak).toBeUndefined()
  })

  it("窗口结束时刻整点已不算高峰(左闭右开)", () => {
    // 2026-09-07T04:00:00Z = 周一 12:00 CST,正好是 09:00-12:00 的右端点
    const noon = new Date("2026-09-07T04:00:00Z")
    const p = meteredOf(P, "deepseek-v4-pro", "deepseek-officially", noon)
    expect(p.peak).toBeUndefined()
  })

  it("周末即使落在时间窗口内也不加价(weekdays 不含)", () => {
    const p = meteredOf(P, "deepseek-v4-pro", "deepseek-officially", WEEKEND)
    expect(p.input).toBeCloseTo(1.6)
    expect(p.peak).toBeUndefined()
  })

  it("规则未点名的模型不受影响", () => {
    const p = meteredOf(P, "claude-opus-5", "cc", IN_PEAK_AM)
    expect(p.input).toBeCloseTo(10)
    expect(p.peak).toBeUndefined()
  })

  // 注意不是「整体停用」:activePeak 先看 peak_active 再看 enabled,
  // 所以服务端下发的 peak_active 会压过 enabled: false(这是有意的策略)。
  it("peak_pricing.enabled 为 false 时本地规则停用", () => {
    const off = {
      ...P,
      peak_pricing: { ...P.peak_pricing!, enabled: false },
    }
    const p = meteredOf(
      off,
      "deepseek-v4-pro",
      "deepseek-officially",
      IN_PEAK_AM
    )
    expect(p.peak).toBeUndefined()
  })

  it("peak_active 含该模型时以其为权威,压过本地窗口计算", () => {
    const active = {
      ...P,
      peak_active: { "deepseek-v4-pro": { factor: 3, until: "23:00" } },
    }
    // 周末本地算不出高峰,但服务端说在高峰 → 以服务端为准
    const p = meteredOf(
      active,
      "deepseek-v4-pro",
      "deepseek-officially",
      WEEKEND
    )
    expect(p.input).toBeCloseTo(4.8) // 1.6 * 3
    expect(p.peak?.factor).toBe(3)
    expect(p.peak?.until).toBe("23:00")
  })

  // peak_active 来自外部 JSON 且语义无文档。这两条守住 typeof 校验 ——
  // 若有人把它改回 `if (fromServer)`,peak.factor 会带 undefined 走到文案里
  // 输出「×undefined」,而这两条测试会红。
  it("peak_active 条目缺 factor 时忽略它,回落本地规则", () => {
    const broken = {
      ...P,
      peak_active: { "deepseek-v4-pro": {} as { factor: number } },
    }
    // 周末:本地规则也算不出高峰 → 完全无高峰
    expect(
      meteredOf(broken, "deepseek-v4-pro", "deepseek-officially", WEEKEND).peak
    ).toBeUndefined()
    // 高峰时刻:回落到本地规则的 ×2
    const p = meteredOf(
      broken,
      "deepseek-v4-pro",
      "deepseek-officially",
      IN_PEAK_AM
    )
    expect(p.peak?.factor).toBe(2)
    expect(p.peak?.until).toBe("12:00")
  })

  it("peak_active 的 factor 是字符串时同样被拒", () => {
    const strFactor = {
      ...P,
      peak_active: {
        "deepseek-v4-pro": { factor: "3" as unknown as number },
      },
    }
    expect(
      meteredOf(strFactor, "deepseek-v4-pro", "deepseek-officially", WEEKEND)
        .peak
    ).toBeUndefined()
  })

  it("单条规则 enabled 为 false 时该规则不生效", () => {
    const off = {
      ...P,
      peak_pricing: {
        enabled: true,
        rules: [{ ...P.peak_pricing!.rules[0], enabled: false }],
      },
    }
    expect(
      meteredOf(off, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM).peak
    ).toBeUndefined()
  })

  it("多条规则:跳过不匹配的,命中后面匹配的", () => {
    const multi = {
      ...P,
      peak_pricing: {
        enabled: true,
        rules: [
          { ...P.peak_pricing!.rules[0], models: ["别的模型"] },
          P.peak_pricing!.rules[0],
        ],
      },
    }
    const p = meteredOf(
      multi,
      "deepseek-v4-pro",
      "deepseek-officially",
      IN_PEAK_AM
    )
    expect(p.peak?.factor).toBe(2)
  })

  it("cacheWrite 同样随高峰浮动", () => {
    // fixture 里带 cache_creation_ratio_5m 的模型(claude-opus-5 / gpt-5.6-sol)
    // 与高峰规则点名的模型(deepseek-v4-pro)不相交 —— 实盘也是如此,
    // deepseek 系没有这个字段。故用 peak_active 绕过窗口计算来验证。
    const active = {
      ...P,
      peak_active: { "claude-opus-5": { factor: 2 } },
    }
    const off = meteredOf(P, "claude-opus-5", "cc", OFF_PEAK)
    const on = meteredOf(active, "claude-opus-5", "cc", OFF_PEAK)
    expect(off.cacheWrite).toBeCloseTo(12.5) // 10 * 1.25
    expect(on.cacheWrite).toBeCloseTo(25) // (10*2) * 1.25
  })
})

describe("resolvePrice 高峰窗口的边界与畸形输入", () => {
  it("跨零点窗口(22:00-02:00)在零点两侧都命中", () => {
    const cross = {
      ...P,
      peak_pricing: {
        enabled: true,
        rules: [
          {
            ...P.peak_pricing!.rules[0],
            windows: ["22:00-02:00"],
            weekdays: [1, 2, 3, 4, 5, 6, 7],
          },
        ],
      },
    }
    const cst = (day: number, hour: number) =>
      new Date(Date.UTC(2026, 8, day, hour - 8, 0, 0)) // CST = UTC+8,无 DST
    const at = (day: number, hour: number) =>
      meteredOf(cross, "deepseek-v4-pro", "deepseek-officially", cst(day, hour))
    expect(at(7, 21).peak).toBeUndefined() // 21:00 窗口外
    expect(at(7, 22).peak?.factor).toBe(2) // 22:00 窗口起点(左闭)
    expect(at(7, 23).peak?.factor).toBe(2) // 23:00 零点前
    expect(at(8, 0).peak?.factor).toBe(2) // 次日 00:00 零点后
    expect(at(8, 1).peak?.factor).toBe(2) // 次日 01:00
    expect(at(8, 2).peak).toBeUndefined() // 次日 02:00 窗口终点(右开)
  })

  it("非法时区不抛异常,当作不命中", () => {
    const badTz = {
      ...P,
      peak_pricing: {
        enabled: true,
        rules: [{ ...P.peak_pricing!.rules[0], timezone: "Not/AZone" }],
      },
    }
    // 不兜住的话 Intl.DateTimeFormat 抛 RangeError,而 activePeak 在每个按量
    // 模型上都被调用 —— 一个模型的坏规则会让整张价格表挂掉
    expect(() =>
      resolvePrice(badTz, "deepseek-v4-pro", "deepseek-officially", {
        now: IN_PEAK_AM,
      })
    ).not.toThrow()
    expect(
      meteredOf(badTz, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
        .peak
    ).toBeUndefined()
  })

  it("畸形窗口一律不命中,不静默挪动时段", () => {
    const mk = (windows: string[]) => ({
      ...P,
      peak_pricing: {
        enabled: true,
        rules: [{ ...P.peak_pricing!.rules[0], windows }],
      },
    })
    for (const w of [["abc-def"], ["09:00"], [""], ["9-12"], ["09:60-12:00"]]) {
      expect(
        meteredOf(mk(w), "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
          .peak
      ).toBeUndefined()
    }
  })

  it("命中时带出规则时区,供文案消除「至 12:00」的歧义", () => {
    const p = meteredOf(P, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
    expect(p.peak?.timezone).toBe("Asia/Shanghai")
  })
})

describe("resolvePrice 阶梯价(tiers)", () => {
  it("换算为绝对价,output_ratio 独立于 ratio", () => {
    const p = metered("gpt-5.6-sol", "codex")
    // 基准 in = 2.5*0.5*2 = 2.5,out = 2.5*6 = 15
    expect(p.input).toBeCloseTo(2.5)
    expect(p.output).toBeCloseTo(15)
    expect(p.tiers).toHaveLength(1)
    expect(p.tiers![0].threshold).toBe(272000)
    expect(p.tiers![0].input).toBeCloseTo(5) // 2.5 * 2
    expect(p.tiers![0].output).toBeCloseTo(22.5) // 15 * 1.5
  })

  it("output_ratio 缺省时回落 ratio", () => {
    const noOut = {
      ...P,
      data: P.data.map((m) =>
        m.model_name === "gpt-5.6-sol"
          ? { ...m, tiers: [{ threshold: 100000, ratio: 3 }] }
          : m
      ),
    }
    const p = meteredOf(noOut, "gpt-5.6-sol", "codex")
    expect(p.tiers![0].input).toBeCloseTo(7.5) // 2.5 * 3
    expect(p.tiers![0].output).toBeCloseTo(45) // 15 * 3
  })

  it("无 tiers 字段时为 undefined", () => {
    expect(metered("claude-opus-5", "cc").tiers).toBeUndefined()
  })

  it("命中高峰时阶梯以高峰之后的价为基准,input/output 两腿口径一致", () => {
    // fixture 里没有「高峰规则 + tiers」同时命中的模型(peak_pricing 只点名
    // deepseek-v4-pro,它没有 tiers)。用 peak_active 强行给 gpt-5.6-sol 造一个
    // 高峰,验证阶梯换算用的是高峰后的 input/output,而不是高峰前的平时价。
    const withPeak = {
      ...P,
      peak_active: { "gpt-5.6-sol": { factor: 2 } },
    }
    const p = meteredOf(withPeak, "gpt-5.6-sol", "codex")
    // 平时 input=2.5/output=15,高峰 ×2 → input=5/output=30
    expect(p.input).toBeCloseTo(5)
    expect(p.output).toBeCloseTo(30)
    expect(p.tiers![0].input).toBeCloseTo(10) // 高峰后 input 5 * ratio 2
    expect(p.tiers![0].output).toBeCloseTo(45) // 高峰后 output 30 * output_ratio 1.5
  })
})

describe("resolvePrice 按次计价区间", () => {
  it("min/max 与 perCall 同乘 group_ratio", () => {
    const p = perCall(P, "gpt-image-2", "image")
    expect(p.perCall).toBeCloseTo(0.4) // 0.08 * 5
    expect(p.perCallMin).toBeCloseTo(0.0294) // 0.00588 * 5
    expect(p.perCallMax).toBeCloseTo(3.55785) // 0.71157 * 5
  })

  it("无区间字段的按次模型 min/max 为 undefined", () => {
    const noRange = {
      ...P,
      data: P.data.map((m) =>
        m.model_name === "gpt-image-2"
          ? { ...m, model_price_min: undefined, model_price_max: undefined }
          : m
      ),
    }
    const p = perCall(noRange, "gpt-image-2", "image")
    expect(p.perCall).toBeCloseTo(0.4)
    expect(p.perCallMin).toBeUndefined()
    expect(p.perCallMax).toBeUndefined()
  })
})
