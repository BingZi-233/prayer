import { describe, expect, it } from "vitest"
import { resolvePrice } from "@/plugins/packyapi/scripts/pricing"
import { P } from "./fixture"

describe("resolvePrice 基础计价", () => {
  it("无覆盖时用全局 model_ratio:in = model_ratio*gr*base", () => {
    const p = resolvePrice(P, "claude-opus-5", "cc")!
    // 2.5 * 2 * 2 = 10
    expect(p.input).toBeCloseTo(10)
    expect(p.output).toBeCloseTo(50) // 10 * 5
    expect(p.cacheRead).toBeCloseTo(1) // 10 * 0.1
    expect(p.ratioSource).toBe("global")
  })

  it("cache_creation_ratio_5m 存在时给出缓存写入价", () => {
    const p = resolvePrice(P, "claude-opus-5", "cc")!
    expect(p.cacheWrite).toBeCloseTo(12.5) // 10 * 1.25
  })

  it("cache_creation_ratio_5m 缺失时 cacheWrite 为 undefined", () => {
    const p = resolvePrice(P, "glm-5.2", "glm-sale")!
    expect(p.cacheWrite).toBeUndefined()
  })

  it("base 可覆盖", () => {
    const p = resolvePrice(P, "claude-opus-5", "cc", { base: 1 })!
    expect(p.input).toBeCloseTo(5)
  })

  it("模型不存在返回 undefined", () => {
    expect(resolvePrice(P, "nope", "cc")).toBeUndefined()
  })
})

describe("resolvePrice 分组倍率覆盖(model_group_ratio)", () => {
  it("组内专属倍率压过全局 model_ratio", () => {
    const p = resolvePrice(P, "glm-5.2", "glm-sale")!
    // 覆盖前会算成 4*1*2 = 8(升级前的错误报价),覆盖后 0.5*1*2 = 1
    expect(p.input).toBeCloseTo(1)
    expect(p.output).toBeCloseTo(3.5)
    expect(p.ratioSource).toBe("group-override")
  })

  it("不同组各自取自己的覆盖值", () => {
    const p = resolvePrice(P, "glm-5.2", "zai-officially")!
    expect(p.input).toBeCloseTo(1.8) // 0.9 * 1 * 2
    expect(p.ratioSource).toBe("group-override")
  })

  it("该组无覆盖条目时回落全局", () => {
    const p = resolvePrice(P, "claude-opus-5", "cc-sale")!
    expect(p.input).toBeCloseTo(4) // 2.5 * 0.8 * 2
    expect(p.ratioSource).toBe("global")
  })
})

describe("resolvePrice 按次计价(quota_type=1)", () => {
  it("perCall = model_price * group_ratio,按量字段为空", () => {
    const p = resolvePrice(P, "gpt-image-2", "image")!
    expect(p.quotaType).toBe(1)
    expect(p.perCall).toBeCloseTo(0.4) // 0.08 * 5
    expect(p.input).toBeUndefined()
    expect(p.output).toBeUndefined()
  })
})

describe("resolvePrice 端点与厂商", () => {
  it("model_group_endpoints 覆盖优先于 supported_endpoint_types", () => {
    expect(resolvePrice(P, "claude-opus-5", "cc")!.endpoints).toEqual([
      "anthropic",
      "openai",
    ])
    expect(resolvePrice(P, "claude-opus-5", "cc-sale")!.endpoints).toEqual([
      "anthropic",
    ])
  })

  it("vendor_id 映射到 vendors 名称", () => {
    expect(resolvePrice(P, "glm-5.2", "glm-sale")!.vendor).toBe("智谱")
  })

  it("vendors 里查不到时 vendor 为 undefined", () => {
    const noVendors = { ...P, vendors: [] }
    expect(
      resolvePrice(noVendors, "glm-5.2", "glm-sale")!.vendor
    ).toBeUndefined()
  })
})
