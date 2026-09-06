import { describe, expect, it } from "vitest"
import {
  resolveGroups,
  resolvePrice,
  type MeteredPrice,
  type PerCallPrice,
} from "@/plugins/packyapi/scripts/pricing"
import { P } from "./fixture"

// 判别联合收窄的小helper:让断言不必写 `as` 或 `!`
function metered(model: string, group: string, base?: number): MeteredPrice {
  const p = resolvePrice(P, model, group, base === undefined ? {} : { base })
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
