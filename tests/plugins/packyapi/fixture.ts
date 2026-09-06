// 两个测试文件共享的 mock 数据。形状抄自 2026-09-06 实盘 /api/pricing,
// 裁到 5 个模型但覆盖全部计价分支:分组倍率覆盖、高峰价、阶梯价、
// 缓存写入价、按次计价区间、分组级端点覆盖、停用组。
// 注意:vitest 的 include 只匹配 tests/**/*.test.ts,本文件不会被当作测试收集。
import type { Pricing } from "@/plugins/packyapi/scripts/pricing"

export const P: Pricing = {
  data: [
    {
      model_name: "glm-5.2",
      vendor_id: 6,
      quota_type: 0,
      model_ratio: 4,
      completion_ratio: 3.5,
      cache_ratio: 0.25,
      model_price: 0,
      enable_groups: ["glm-sale", "zai-officially"],
      supported_endpoint_types: ["anthropic", "openai"],
    },
    {
      model_name: "claude-opus-5",
      vendor_id: 1,
      quota_type: 0,
      model_ratio: 2.5,
      completion_ratio: 5,
      cache_ratio: 0.1,
      cache_creation_ratio_5m: 1.25,
      model_price: 0,
      enable_groups: ["cc", "cc-sale"],
      supported_endpoint_types: ["anthropic", "openai"],
    },
    {
      model_name: "deepseek-v4-pro",
      vendor_id: 42,
      quota_type: 0,
      model_ratio: 0.8,
      completion_ratio: 2,
      cache_ratio: 0.1,
      model_price: 0,
      enable_groups: ["deepseek-officially"],
      supported_endpoint_types: ["openai"],
    },
    {
      model_name: "gpt-5.6-sol",
      vendor_id: 2,
      quota_type: 0,
      model_ratio: 0.625,
      completion_ratio: 8,
      cache_ratio: 0.1,
      model_price: 0,
      enable_groups: ["codex"],
      supported_endpoint_types: ["openai-response"],
      tiers: [{ threshold: 272000, ratio: 2, output_ratio: 1.5 }],
    },
    {
      model_name: "gpt-image-2",
      vendor_id: 2,
      quota_type: 1,
      model_ratio: 0,
      completion_ratio: 0,
      cache_ratio: 0,
      model_price: 0.08,
      model_price_min: 0.00588,
      model_price_max: 0.71157,
      image_ratio: 1.6,
      enable_groups: ["image"],
      supported_endpoint_types: ["image-generation"],
    },
  ],
  group_ratio: {
    cc: 2,
    "cc-sale": 0.8,
    "glm-sale": 1,
    "zai-officially": 1,
    "deepseek-officially": 1,
    codex: 0.5,
    image: 5,
    "legacy-off": 1,
  },
  usable_group: {
    cc: "claude code专用",
    "cc-sale": "便宜的 claude code 分组",
    "glm-sale": "便宜的glm分组,非逆向",
    "zai-officially": "智谱 API官方版本",
    "deepseek-officially": "deepseek官方渠道",
    codex: "codex专用",
    image: "官方稳定image 聚合",
    "legacy-off": "已停用的历史分组",
  },
  model_group_ratio: {
    "glm-sale": { "glm-5.2": 0.5 },
    "zai-officially": { "glm-5.2": 0.9 },
  },
  model_group_endpoints: {
    // claude-opus-5 全局支持 anthropic+openai,但 cc-sale 组只开 anthropic
    "cc-sale": { "claude-opus-5": ["anthropic"] },
  },
  peak_pricing: {
    enabled: true,
    rules: [
      {
        enabled: true,
        timezone: "Asia/Shanghai",
        windows: ["09:00-12:00", "14:00-18:00"],
        weekdays: [1, 2, 3, 4, 5],
        models: ["deepseek-v4-pro"],
        factor: 2,
      },
    ],
  },
  peak_active: {},
  inactive_groups: ["legacy-off"],
  supported_endpoint: {
    anthropic: { path: "/v1/messages", method: "POST" },
    openai: { path: "/v1/chat/completions", method: "POST" },
    "openai-response": { path: "/v1/responses", method: "POST" },
    "image-generation": {
      path: "/v1/images/generations",
      method: "POST",
      extra_paths: ["/v1/images/edits"],
    },
  },
  vendors: [
    { id: 1, name: "Anthropic" },
    { id: 2, name: "OpenAI" },
    { id: 6, name: "智谱" },
    { id: 42, name: "DeepSeek" },
  ],
  auto_groups: ["cc"],
}

// 固定时刻(已用 Intl 实测过对应的 Asia/Shanghai 本地时间)
export const IN_PEAK_AM = new Date("2026-09-07T02:00:00Z") // 周一 10:00 CST,落在 09:00-12:00
export const OFF_PEAK = new Date("2026-09-07T05:00:00Z") // 周一 13:00 CST,两窗口之间
export const IN_PEAK_PM = new Date("2026-09-07T07:00:00Z") // 周一 15:00 CST,落在 14:00-18:00
export const WEEKEND = new Date("2026-09-12T02:00:00Z") // 周六 10:00 CST,weekdays 不含
