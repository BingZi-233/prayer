import { describe, expect, it } from "vitest"
import {
  formatAnnouncements,
  formatGroups,
  formatModels,
  formatPrice,
  formatRaw,
  type Announcements,
  type Pricing,
} from "@/plugins/packyapi/scripts/packy-mcp"

// 最小 mock:覆盖按量(quota_type=0)、按次(quota_type=1)、多分组、多端点。
const D: Pricing = {
  data: [
    {
      model_name: "claude-opus-4-8",
      quota_type: 0,
      model_ratio: 2.5,
      completion_ratio: 5,
      cache_ratio: 0.1,
      model_price: 0,
      enable_groups: ["cc", "cc-sale"],
      supported_endpoint_types: ["anthropic"],
    },
    {
      model_name: "gpt-image-1",
      quota_type: 1,
      model_ratio: 0,
      completion_ratio: 0,
      cache_ratio: 0,
      model_price: 0.04,
      enable_groups: ["cc"],
      supported_endpoint_types: ["openai"],
    },
  ],
  group_ratio: { cc: 2, "cc-sale": 0.8 },
  usable_group: { cc: "claude code 专用", "cc-sale": "便宜 cc" },
}

describe("formatPrice", () => {
  it("按量组 cc:in=model_ratio*gr*base", () => {
    const out = formatPrice(D, { group: "cc" })
    // in = 2.5 * 2 * 2 = 10; out = 10*5 = 50; cache = 10*0.1 = 1
    expect(out).toContain("claude-opus-4-8")
    expect(out).toMatch(/\$10\.00\s+\$50\.00\s+\$1\.00/)
  })

  it("给关键词列该模型全部可用分组", () => {
    const out = formatPrice(D, { keyword: "opus" })
    expect(out).toContain("cc")
    expect(out).toContain("cc-sale")
    // cc-sale: in = 2.5 * 0.8 * 2 = 4
    expect(out).toMatch(/\$4\.00/)
  })

  it("按次(quota_type=1):price/次 = model_price*gr", () => {
    const out = formatPrice(D, { keyword: "gpt-image", group: "cc" })
    // 0.04 * 2 = 0.08
    expect(out).toContain("$0.0800/次")
  })

  it("base 覆盖生效", () => {
    const out = formatPrice(D, { group: "cc", base: 1 })
    // in = 2.5 * 2 * 1 = 5
    expect(out).toMatch(/\$5\.00/)
  })

  it("无匹配返回提示", () => {
    expect(formatPrice(D, { keyword: "nope" })).toContain("无匹配")
  })
})

describe("formatModels", () => {
  it("默认 cc 组列全部", () => {
    const out = formatModels(D)
    expect(out).toContain("claude-opus-4-8")
    expect(out).toContain("gpt-image-1")
  })

  it("endpoint 过滤", () => {
    const out = formatModels(D, { endpoint: "anthropic" })
    expect(out).toContain("claude-opus-4-8")
    expect(out).not.toContain("gpt-image-1")
  })

  it("组过滤:cc-sale 仅 opus", () => {
    const out = formatModels(D, { group: "cc-sale" })
    expect(out).toContain("claude-opus-4-8")
    expect(out).not.toContain("gpt-image-1")
  })
})

describe("formatGroups", () => {
  it("按倍率升序列出并带说明", () => {
    const out = formatGroups(D)
    const ccSaleIdx = out.indexOf("cc-sale")
    const ccIdx = out.indexOf("\ncc ")
    expect(ccSaleIdx).toBeGreaterThan(-1)
    expect(ccSaleIdx).toBeLessThan(ccIdx) // 0.8 在 2 之前
    expect(out).toContain("claude code 专用")
  })
})

describe("formatRaw", () => {
  it("命中返回 JSON", () => {
    const out = formatRaw(D, "claude-opus-4-8")
    expect(JSON.parse(out).model_name).toBe("claude-opus-4-8")
  })
  it("缺 model", () => {
    expect(formatRaw(D)).toContain("需 model")
  })
  it("未找到", () => {
    expect(formatRaw(D, "xxx")).toContain("未找到")
  })
})

const A: Announcements = {
  data: [
    {
      id: 1,
      category: "model",
      type: "default",
      title: "老公告",
      title_en: "old",
      content: "旧内容 opus",
      content_en: "old",
      publishDate: "2026-06-01T00:00:00.000Z",
    },
    {
      id: 2,
      category: "group",
      type: "default",
      title: "新公告",
      title_en: "new",
      content: "新内容 sale",
      content_en: "new",
      publishDate: "2026-07-08T00:00:00.000Z",
    },
  ],
}

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
