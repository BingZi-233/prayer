# packyapi 插件升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 `packyapi` 插件对部分模型高达 8 倍的报价错误,补全 `/api/pricing` 未接入的计价字段,并把两份已脱节的 reference 文档按实盘刷新。

**Architecture:** 把定价逻辑从 368 行的单文件 `packy-mcp.ts` 里抽成纯函数解析器 `pricing.ts`(模型 × 分组 × 时刻 → 实价),输出格式化抽成 `format.ts`,`packy-mcp.ts` 只留 MCP server 装配、fetch 与 action 分派。输出默认精简(表格列不变,只加行内标记 + 表尾脚注),全量信息集中到新 action `detail`。

**Tech Stack:** TypeScript(Node v24 原生 strip-types 直跑,**插件内部 import 必须带 `.ts` 扩展名**)、`@modelcontextprotocol/sdk`(stdio transport)、`zod`(入参 schema)、`vitest`(测试)、`Intl.DateTimeFormat`(时区判定,不引第三方依赖)。

**Spec:** `docs/superpowers/specs/2026-09-06-packyapi-upgrade-design.md`

---

## 起步须知(实现者必读)

这些是本仓库的硬约束,踩了会返工:

1. **Prettier 无分号 + 双引号**(`semi:false`, `singleQuote:false`, `trailingComma:es5`, `printWidth:80`)。本计划里的代码块已按此风格写。
   **格式化只跑你自己改的文件**:`pnpm prettier --write <你改的文件...>`,**不要跑 `pnpm format`** ——
   它是 `prettier --write "**/*.{ts,tsx}"`,会顺手重排 `tests/lib/transcript.test.ts`
   (仓库里唯一一处与本次无关的既存格式漂移),把无关改动混进你的提交。
2. **测试集中在 `tests/`**,镜像源码结构,**不与源码同目录**。vitest 的 `include` 只认 `tests/**/*.test.ts`。
3. **测试里用 `@/` 别名且不带扩展名**(如 `@/plugins/packyapi/scripts/pricing`),`@/*` 指向仓库根,没有 `src/`。
4. **插件脚本内部的相对 import 必须带 `.ts`**(如 `import { resolvePrice } from "./pricing.ts"`)—— 插件由 Node 直接 strip-types 运行,不经打包器。`tsconfig.json` 已开 `allowImportingTsExtensions: true`,typecheck 不会报错。已在 Node v24.16.0 实测通过。
5. **`tests/plugins/packyapi/fixture.ts` 不是测试文件**,vitest 不会收集它(`include` 只匹配 `*.test.ts`),两个测试文件共享它。
6. 单测命令:`pnpm vitest run tests/plugins/packyapi/pricing.test.ts`;按名跑:`pnpm vitest run -t "名字"`。
7. 三件套:`pnpm check`(= `typecheck` + `lint` + `test`)。无 CI,声称完成前必须手动跑。
8. 提交用 Conventional Commits + 中文正文。分支已是 `feat/packyapi-upgrade`。
9. **数组顺序断言只针对 fixture,不针对实盘。** 冻结的 fixture 字面量顺序可断言;从
   `/api/pricing` 拿到的 `data[]` / `enable_groups[]` / `vendors[]` 一律不假设顺序 ——
   面向用户的排序由我们自己保证(`resolveGroups` 有 `.sort()`,`formatPrice` 的排序有
   组名 tie-break),而不是依赖上游返回的次序。
   实测依据:连抓 7 次(间隔 1 秒)拿到 2 个不同响应体,把所有数组规范化排序后归一 ——
   即差异纯粹是顺序,数值零差异。**只抓 3 次很可能全同,不足以判定稳定。**
   例外:`supported_endpoint_types` 实测 0/67 不一致(九份快照),且 `anthropic,openai`
   这样的原始次序比字母序更符合阅读习惯,故 `endpoints` **有意原样透传不排序**。
10. **不要照抄计划里的数字而不算一遍。** 每个断言旁都写了算式(如 `2.5 * 0.5 * 2 = 2.5`),
    对不上就以 fixture 的字面值为准并在报告里指出 —— 计划里的手算也可能错。

## 文件结构

| 文件 | 职责 |
|---|---|
| `plugins/packyapi/scripts/pricing.ts`(新) | 定价领域:`Pricing`/`Model` 等类型 + `resolvePrice()` 纯函数解析器。**不触网、不格式化、不引 MCP SDK** |
| `plugins/packyapi/scripts/format.ts`(新) | 输出层:全部 `format*` 函数 + 公告类型。只依赖 `pricing.ts` |
| `plugins/packyapi/scripts/packy-mcp.ts`(改) | 装配层:MCP server 注册、两个 fetch、action 分派、类型再导出。从 368 行瘦到约 200 行 |
| `tests/plugins/packyapi/fixture.ts`(新) | 两个测试文件共享的 mock 数据与固定时刻 |
| `tests/plugins/packyapi/pricing.test.ts`(新) | 断言价格**数值**,不透过格式化文本反推 |
| `tests/plugins/packyapi/format.test.ts`(由 `packy-mcp.test.ts` 迁移) | 断言输出文本 |
| `plugins/packyapi/skills/packyapi/references/pricing-api.md`(重写) | 删掉会过时的分组倍率副本,补全字段与计价顺序 |
| `plugins/packyapi/skills/packyapi/references/docs-map.md`(重建) | 按实测 sitemap |
| `plugins/packyapi/skills/packyapi/SKILL.md`(改) | 工具表 + 已核实的配置指引 |
| `plugins/packyapi/README.md`(改) | action 表补齐 |
| `plugins/packyapi/.claude-plugin/plugin.json`(改) | `1.2.2` → `1.3.0` |

依赖方向单向:`packy-mcp.ts` → `format.ts` → `pricing.ts`。公告类型(`Announcement`/`Announcements`)放 `format.ts` —— 它是唯一的结构化消费方,放这里可避免 `packy-mcp.ts` 与 `format.ts` 互相 import。

---

### Task 1: `pricing.ts` 骨架、group-override 修价与字段可选性

这是本次升级的核心 bug 修复。`model_group_ratio` 提供分组级 `model_ratio` 覆盖,插件此前完全没读 —— 实盘 11 个 model×group 组合(8 个不同模型)受影响,其中 7 条被高估(最大 `glm-5.2`@`glm-sale` 高估 8 倍)、**4 条被低估**(如 `glm-5.3-flash`@`glm-sale` 报 $0.80 而实价 $1.00)。低估方向对客服场景更麻烦:客户按报价下单后发现实际扣费更高。

同时修掉一个**已在线上输出的** `$NaN`:实盘 67 个模型里 10 个没有 `cache_ratio` 字段(其中 7 个是 `quota_type=0`,会真的算出 `NaN`),现有代码把该字段当必填直接做乘法。`gemini-slb` 组 7 行里 5 行的 cache 列今天就是 `$NaN`。

**Files:**
- Create: `plugins/packyapi/scripts/pricing.ts`
- Create: `tests/plugins/packyapi/fixture.ts`
- Create: `tests/plugins/packyapi/pricing.test.ts`
- Modify: `plugins/packyapi/scripts/packy-mcp.ts`(删掉本地 `Model`/`Pricing` 定义改为 import + re-export;并给 `formatPrice` 里的 `cache_ratio` 加缺失守卫)

- [ ] **Step 1: 建共享 fixture**

创建 `tests/plugins/packyapi/fixture.ts`:

```ts
// 两个测试文件共享的 mock 数据。字段组合与数值取自 2026-09-06 实盘 /api/pricing,
// 裁到 6 个模型,覆盖全部计价分支:分组倍率覆盖、高峰价、阶梯价、缓存写入价、
// 缓存倍率缺失、按次计价区间、分组级端点覆盖、孤儿组、停用组。
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
      // 全局 2.25 会被 model_group_ratio 的 0.8 覆盖 —— 全局与覆盖值必须不同,
      // 否则这个模型永远测不出覆盖是否真的生效。
      model_name: "deepseek-v4-pro",
      vendor_id: 42,
      quota_type: 0,
      model_ratio: 2.25,
      completion_ratio: 3,
      cache_ratio: 0.0333,
      model_price: 0,
      enable_groups: ["deepseek-officially"],
      supported_endpoint_types: ["openai"],
    },
    {
      model_name: "gpt-5.6-sol",
      vendor_id: 2,
      quota_type: 0,
      model_ratio: 2.5,
      completion_ratio: 6,
      cache_ratio: 0.1,
      cache_creation_ratio_5m: 1.25,
      model_price: 0,
      // hongjing 故意不在 group_ratio / inactive_groups 里 —— 实盘就有这种「孤儿组」
      //(hongjing 6 个模型、test 2 个、default 1 个),倍率无处可查。
      enable_groups: ["codex", "hongjing"],
      supported_endpoint_types: ["openai-response"],
      tiers: [{ threshold: 272000, ratio: 2, output_ratio: 1.5 }],
    },
    {
      // 实盘没有 cache_ratio 字段 —— 覆盖 cacheRead 应为 undefined 而非 NaN 的分支。
      // 实盘同类模型共 10 个(7 个按量 + 3 个按次)。
      model_name: "gemini-3-pro-preview",
      vendor_id: 4,
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 6,
      model_price: 0,
      enable_groups: ["gemini-slb"],
      supported_endpoint_types: ["gemini", "openai"],
    },
    {
      model_name: "gpt-image-2",
      vendor_id: 2,
      quota_type: 1,
      model_ratio: 2.5,
      completion_ratio: 6,
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
    "gemini-slb": 3,
    image: 5,
    "legacy-off": 1,
  },
  usable_group: {
    cc: "claude code专用",
    // 前导空格与全角逗号是实盘原样。formatGroups 里那个 .trim() 靠这几条才有测试覆盖 ——
    // 若抄成已 trim 的版本,删掉 .trim() 测试也不会红。
    "cc-sale": " 便宜的 claude code 分组，可以养龙虾，缓存可能会有异常",
    "glm-sale": " 便宜的glm分组，非逆向",
    "zai-officially": " 智谱 API官方版本",
    "deepseek-officially": "deepseek官方渠道",
    codex: "codex专用",
    "gemini-slb": "gemini企业版本",
    image: "官方稳定image 聚合",
    "legacy-off": "已停用的历史分组",
  },
  model_group_ratio: {
    "glm-sale": { "glm-5.2": 0.5 },
    "zai-officially": { "glm-5.2": 0.9 },
    "deepseek-officially": { "deepseek-v4-pro": 0.8 },
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
  // 实盘当前是 [],legacy-off 是为覆盖停用组分支合成的
  inactive_groups: ["legacy-off"],
  supported_endpoint: {
    anthropic: { path: "/v1/messages", method: "POST" },
    openai: { path: "/v1/chat/completions", method: "POST" },
    "openai-response": { path: "/v1/responses", method: "POST" },
    gemini: {
      path: "/v1beta/models/{model}:generateContent",
      method: "POST",
    },
    "image-generation": {
      path: "/v1/images/generations",
      method: "POST",
      extra_paths: ["/v1/images/edits"],
    },
  },
  vendors: [
    { id: 1, name: "Anthropic" },
    { id: 2, name: "OpenAI" },
    { id: 4, name: "Google" },
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

export const A: Announcements = {
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
```

注意:末尾的 `A` 常量需要 `format.ts` 的 `Announcements` 类型,而 `format.ts` 在 Task 4 才创建。**本 Task 只写到 `export const WEEKEND` 为止,不要写 `A`**,Task 4 再把 `A` 与 `import type { Announcements } from "@/plugins/packyapi/scripts/format"` 一起补上。

参考数值(按 `base=2`,后续 Task 的断言都建立在这组数上):

| 模型 @ 组 | in | out | cacheRead | 备注 |
|---|---|---|---|---|
| `claude-opus-5` @ `cc` | 10 | 50 | 1 | cacheWrite 12.5 |
| `claude-opus-5` @ `cc-sale` | 4 | 20 | 0.4 | 端点被组级覆盖为仅 anthropic |
| `glm-5.2` @ `glm-sale` | 1 | 3.5 | 0.25 | 倍率覆盖 0.5(全局 4 会算成 8) |
| `glm-5.2` @ `zai-officially` | 1.8 | 6.3 | 0.45 | 倍率覆盖 0.9 |
| `deepseek-v4-pro` @ `deepseek-officially` | 1.6 | 4.8 | 0.05328 | 倍率覆盖 0.8;高峰 ×2 |
| `gpt-5.6-sol` @ `codex` | 2.5 | 15 | 0.25 | cacheWrite 3.125;阶梯 in 5 / out 22.5 |
| `gpt-5.6-sol` @ `hongjing` | 5 | 30 | 0.5 | 孤儿组,倍率按 1 估算 |
| `gemini-3-pro-preview` @ `gemini-slb` | 6 | 36 | **无** | 无 cache_ratio 字段 |
| `gpt-image-2` @ `image` | — | — | — | 按次 0.4/次。区间(`perCallMin`/`perCallMax` = 0.0294~3.55785)**由 Task 3 计算**,本 Task 的 `resolvePrice` 只产出 `perCall` |

- [ ] **Step 2: 写失败的测试**

创建 `tests/plugins/packyapi/pricing.test.ts`:

```ts
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
    expect(resolvePrice({ ...P, data: [] }, "claude-opus-5", "cc")).toBeUndefined()
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
    expect(resolvePrice(noVendors, "glm-5.2", "glm-sale")?.vendor).toBeUndefined()
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
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm vitest run tests/plugins/packyapi/pricing.test.ts
```

预期:FAIL,报错形如 `Failed to resolve import "@/plugins/packyapi/scripts/pricing"`。

- [ ] **Step 4: 写 `pricing.ts`**

创建 `plugins/packyapi/scripts/pricing.ts`。`activePeak` 与 tiers 在 Task 2/3 补,这一步先留纯计价:

```ts
/**
 * PackyAPI 定价解析器 —— 纯函数,不触网、不格式化。
 *
 * 唯一入口 resolvePrice(模型 × 分组 × 时刻 → 实价)。抽出来的原因:
 * 计价规则有四层叠加(分组倍率覆盖 → 高峰浮动 → 阶梯价 → 按次区间),
 * 内联在格式化函数里既无法单测数值,也压不住复杂度。
 *
 * 计价顺序(顺序即正确性,勿调换):
 *   1. ratio = model_group_ratio[组][模型] ?? model_ratio   ← 分组级覆盖
 *   2. gr    = group_ratio[组] ?? 1(缺失即「孤儿组」,见 grSource)
 *   3. input = ratio * gr * base(base 默认 2,即 $0.002/1K)
 *      output = input * completion_ratio
 *      cacheRead  = input * cache_ratio(字段缺失则无此价)
 *      cacheWrite = input * cache_creation_ratio_5m(字段缺失则无此价)
 *   4. 高峰浮动:命中窗口则上述 token 价整体 × factor —— **含 cacheRead / cacheWrite**。
 *      缓存价是否随高峰浮动无官方文档;此处按「缓存价是 input 的倍数,input 浮动则
 *      同步浮动」处理。这是我方推断,Task 8 的文档需向用户声明。
 *   5. 阶梯价:以第 4 步之后的价为基准换算
 *   6. quota_type=1(按次):perCall = model_price * gr,不产出任何按量字段,
 *      **且不参与高峰浮动**(activePeak 只在按量分支调用)。实盘高峰规则只点名 3 个
 *      按量模型,但 rules[].models 是外部字段 —— 平台把按次模型放进高峰规则时,
 *      perCall 会静默不浮动。
 *
 * 外部 API 的字段可选性以 2026-09-06 实盘 67 个模型普查为准:
 * cache_ratio 仅 57/67 存在,其余(model_ratio / completion_ratio / model_price /
 * enable_groups / supported_endpoint_types / quota_type / vendor_id)均 67/67 存在。
 */

export const DEFAULT_BASE = 2

export interface Tier {
  threshold: number
  ratio: number
  output_ratio?: number
}

export interface Model {
  model_name: string
  quota_type: number
  model_ratio: number
  completion_ratio: number
  model_price: number
  enable_groups: string[]
  supported_endpoint_types: string[]
  /** 仅 57/67 个模型有 —— 缺失时不产出 cacheRead,而不是算出 NaN */
  cache_ratio?: number
  vendor_id?: number
  cache_creation_ratio_5m?: number
  tiers?: Tier[]
  model_price_min?: number
  model_price_max?: number
  image_ratio?: number
}

export interface PeakRule {
  enabled: boolean
  timezone: string
  windows: string[]
  weekdays: number[]
  models: string[]
  factor: number
}

export interface Vendor {
  id: number
  name: string
  icon?: string
}

export interface EndpointSpec {
  path: string
  method: string
  extra_paths?: string[]
}

export interface Pricing {
  data: Model[]
  group_ratio: Record<string, number>
  usable_group: Record<string, string>
  model_group_ratio?: Record<string, Record<string, number>>
  model_group_endpoints?: Record<string, Record<string, string[]>>
  peak_pricing?: { enabled: boolean; rules: PeakRule[] }
  peak_active?: Record<string, { factor: number; until?: string }>
  inactive_groups?: string[]
  supported_endpoint?: Record<string, EndpointSpec>
  vendors?: Vendor[]
  auto_groups?: string[]
}

export interface TierPrice {
  threshold: number
  input: number
  output: number
}

export interface PeakState {
  factor: number
  /** 当前窗口结束时刻 "HH:MM"。跨零点窗口时指次日该时刻。 */
  until?: string
  /** 规则时区。仅当不是 Asia/Shanghai 时才需要在文案里点出,避免「至 12:00」产生歧义。 */
  timezone?: string
  offPeakInput: number
  offPeakOutput: number
}

interface PriceCommon {
  model: string
  group: string
  /** 倍率取自全局 model_ratio 还是该组的 model_group_ratio 覆盖 */
  ratioSource: "global" | "group-override"
  /**
   * group_ratio 是否定义了该组。fallback-1 表示按 1 估算 —— 实盘存在「孤儿组」:
   * 组出现在模型的 enable_groups 里,却不在 group_ratio / usable_group /
   * inactive_groups 任何一处(2026-09-06 实测 hongjing 6 个模型、test 2 个、
   * default 1 个)。这类组的真实倍率无处可查,报价只是估算,必须让上层能标注。
   */
  grSource: "defined" | "fallback-1"
  endpoints: string[]
  vendor?: string
}

/** quota_type=0(按量),价格单位 $/1M tokens */
export interface MeteredPrice extends PriceCommon {
  quotaType: 0
  base: number
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  peak?: PeakState
  tiers?: TierPrice[]
}

/** quota_type=1(按次) */
export interface PerCallPrice extends PriceCommon {
  quotaType: 1
  perCall: number
  perCallMin?: number
  perCallMax?: number
}

/**
 * 判别联合而非「全可选字段 + quotaType: number」:后者允许
 * { quotaType: 1, input: 5 } 这种非法状态,下游只能靠 p.input! 自律。
 * 分成两支后 TypeScript 在 if (p.quotaType === 1) 里自动收窄,格式化层不再需要非空断言。
 */
export type EffectivePrice = MeteredPrice | PerCallPrice

/** 模型可用的分组。排序以保证输出确定,不依赖外部 API 的数组顺序。 */
export function resolveGroups(d: Pricing, model: string): string[] {
  return [...(d.data?.find((x) => x.model_name === model)?.enable_groups ?? [])].sort()
}

export function resolvePrice(
  d: Pricing,
  model: string,
  group: string,
  opts: { base?: number; now?: Date } = {}
): EffectivePrice | undefined {
  const m = d.data?.find((x) => x.model_name === model)
  if (!m) return undefined
  // 该模型不在这个组里就不出价。resolvePrice 是唯一的计价入口,而 group 是 MCP
  // 工具的用户可控入参 —— 不校验配对的话,「glm-5.2 在 cc 组多少钱」会拿 cc 的
  // 倍率 2 乘全局 model_ratio 4 算出 $16.00/1M(该模型真实可用组 glm-sale 的价
  // 是 $1.00),而且 grSource 会是 "defined",输出里看不出任何异常。
  // 2026-09-06 实测这样的假报价组合有 1306 个,其中 1114 个完全无标记。
  if (!m.enable_groups?.includes(group)) return undefined
  // 实盘 quota_type 只有 0(按量,64 个)与 1(按次,3 个)。平台若新增第三种计费
  // 模式,宁可不出价 —— 拿 model_ratio 硬算出一个按 token 的价报出去比不报更糟。
  if (m.quota_type !== 0 && m.quota_type !== 1) return undefined
  const grDefined = d.group_ratio?.[group]
  const gr = grDefined ?? 1
  const override = d.model_group_ratio?.[group]?.[model]
  // typeof 检查而非 `override === undefined`:取值用 ?? 会让 null 回落到全局,
  // 若判定只看 undefined 就会出现「声称用了组覆盖、实际用的全局值」的谎报。
  const hasOverride = typeof override === "number"
  const ratio = hasOverride ? override : m.model_ratio
  const common: PriceCommon = {
    model,
    group,
    ratioSource: hasOverride ? "group-override" : "global",
    grSource: grDefined === undefined ? "fallback-1" : "defined",
    endpoints:
      d.model_group_endpoints?.[group]?.[model] ??
      m.supported_endpoint_types ??
      [],
    vendor: d.vendors?.find((v) => v.id === m.vendor_id)?.name,
  }
  if (m.quota_type === 1) {
    return { ...common, quotaType: 1, perCall: m.model_price * gr }
  }
  const base = opts.base ?? DEFAULT_BASE
  const input = ratio * gr * base
  return {
    ...common,
    quotaType: 0,
    base,
    input,
    output: input * m.completion_ratio,
    cacheRead: m.cache_ratio === undefined ? undefined : input * m.cache_ratio,
    cacheWrite:
      m.cache_creation_ratio_5m === undefined
        ? undefined
        : input * m.cache_creation_ratio_5m,
  }
}
```

> `base` 只出现在按量那一支 —— 按次计价用不到它,判别联合顺带消除了「按次结果里挂着一个
> 无意义的 base」这种状态。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm vitest run tests/plugins/packyapi/pricing.test.ts
```

预期:PASS,25 个用例全绿。

- [ ] **Step 6: `packy-mcp.ts` 改用 `pricing.ts` 的类型,并修掉线上的 `$NaN`**

删掉 `plugins/packyapi/scripts/packy-mcp.ts` 里本地的 `Model` 与 `Pricing` 两个 interface,替换为再导出。在 import 区加:

```ts
import type { Pricing } from "./pricing.ts"

export type { Model, Pricing } from "./pricing.ts"
```

`cache_ratio` 变为可选后,`tsc` 会精确报出两处必须加守卫的地方,其中一处是 `packy-mcp.ts` 里 `formatPrice` 的 cache 列。把那一行的裸乘法改成缺失时输出 `-`:

```ts
        const cache =
          m.cache_ratio === undefined ? "-" : `$${(inp * m.cache_ratio).toFixed(2)}`
```

并在拼 `rows.push([...])` 时用这个 `cache` 变量替换原来的 `` `$${(inp * m.cache_ratio).toFixed(2)}` ``。

> 这一步顺带消灭一个**已在线上输出**的缺陷:实盘 `gemini-slb` 组 7 行里 5 行的 cache 列当前是 `$NaN`。
> `formatPrice` 会在 Task 5 被整体重写到 `resolvePrice` 之上,但在那之前它仍是线上行为,现在就要修。

保留 `export const API` / `ANNOUNCE_API` 与其余代码不动。

- [ ] **Step 7: 全量验证**

```bash
pnpm prettier --write plugins/packyapi/scripts/pricing.ts plugins/packyapi/scripts/packy-mcp.ts tests/plugins/packyapi/*.ts
pnpm typecheck && pnpm vitest run tests/plugins/packyapi/
```

预期:typecheck 无输出(通过);两个测试文件全绿(旧的 `packy-mcp.test.ts` 也必须仍绿)。

格式化用 `pnpm prettier --write` 点名你改的文件,别跑 `pnpm format`(见起步须知第 1 条)。

- [ ] **Step 8: 用实盘数据自查修价方向**

```bash
cat > /tmp/t1-check.mjs <<'SCRIPT'
import { readFileSync } from "node:fs"
const { resolvePrice } = await import(
  "/Users/ziyou/projects/prayer/plugins/packyapi/scripts/pricing.ts"
)
const d = JSON.parse(readFileSync("/tmp/packy.json", "utf8"))
let nan = 0
for (const m of d.data)
  for (const g of m.enable_groups) {
    const p = resolvePrice(d, m.model_name, g)
    for (const [k, v] of Object.entries(p ?? {}))
      if (typeof v === "number" && Number.isNaN(v)) {
        nan++
        console.log("NaN:", m.model_name, g, k)
      }
  }
console.log("NaN 总数:", nan, "(应为 0)")
const glm = resolvePrice(d, "glm-5.2", "glm-sale")
console.log("glm-5.2@glm-sale input:", glm.input, "(应为 1,线上当前是 8)")
const gem = resolvePrice(d, "gemini-3-pro-preview", "gemini-slb")
console.log("gemini cacheRead:", gem.cacheRead, "(应为 undefined)")
console.log("孤儿组 grSource:", resolvePrice(d, "gpt-5.6-sol", "hongjing").grSource)
SCRIPT
curl -s --max-time 20 -H "User-Agent: packy-mcp" https://www.packyapi.ai/api/pricing -o /tmp/packy.json
node /tmp/t1-check.mjs
```

预期:`NaN 总数: 0`、`input: 1`、`cacheRead: undefined`、`grSource: fallback-1`。
把你看到的真实输出写进报告。

- [ ] **Step 9: 提交**

```bash
git add plugins/packyapi/scripts/pricing.ts plugins/packyapi/scripts/packy-mcp.ts tests/plugins/packyapi/
git commit -m "$(cat <<'EOF'
feat(packyapi): 抽出定价解析器,修正分组倍率覆盖与 cache_ratio 必填两处报价错误

一、分组倍率覆盖。/api/pricing 的 model_group_ratio 提供分组级 model_ratio
覆盖,插件此前完全没读。实盘 11 个 model×group 组合(8 个不同模型)受影响:
7 条被高估(最大 glm-5.2@glm-sale 报 $8/1M 而实价 $1/1M),4 条被**低估**
(如 glm-5.3-flash@glm-sale 报 $0.80 而实价 $1.00)。低估方向对客服场景更
麻烦 —— 客户按报价下单后发现实际扣费更高。cc 组不在覆盖表内,故 claude
code 主链路一直是准的,问题因此长期未被发现。

二、cache_ratio 被当作必填。实盘 67 个模型里 10 个没有该字段(7 个按量),
裸做乘法得到 NaN。gemini-slb 组 7 行里 5 行的 cache 列今天就在向用户输出
$NaN。改为可选并在两处取值点加守卫。

新增 pricing.ts 承载定价:纯函数 resolvePrice(模型 × 分组 × 时刻 → 实价),
不触网不格式化,价格可直接断言。EffectivePrice 用判别联合而非全可选字段,
避免下游靠非空断言自律。另接入 cache_creation_ratio_5m(缓存写入价)、
model_group_endpoints(分组级端点覆盖)、vendors(厂商名),并对实盘存在的
「孤儿组」(组在 enable_groups 里却无 group_ratio 定义,如 hongjing 6 个模型)
用 grSource 显式标记,不再静默按倍率 1 报出一个看似可信的假价。
EOF
)"
```

---

### Task 2: 高峰浮动价(时间感知)

实盘 `peak_pricing.enabled` 已是 `true`(旧 reference 文档写的 `false` 早已过时),规则为 `Asia/Shanghai` 周一至五 `09:00-12:00` 与 `14:00-18:00`,deepseek 三模型 `factor:2`。按调用时刻判断,命中则报当下实价并保留平时价供对照。

**Files:**
- Modify: `plugins/packyapi/scripts/pricing.ts`
- Modify: `tests/plugins/packyapi/pricing.test.ts`

- [ ] **Step 1: 写失败的测试**

把顶部那行 `import { P } from "./fixture"` 补成下面这样(ESM 的 import 必须在文件顶部,**不要**把它跟着测试块一起追加到末尾):

```ts
import { IN_PEAK_AM, IN_PEAK_PM, OFF_PEAK, P, WEEKEND } from "./fixture"
```

同时在 Task 1 建好的 `metered()` helper 旁再加一个收窄 helper,供需要传自定义 `Pricing` 的用例使用:

```ts
// 与 metered() 同理,但接受任意 Pricing 变体(用于 {...P, peak_active: {...}} 这类构造)
function meteredOf(d: Pricing, model: string, group: string, now?: Date): MeteredPrice {
  const p = resolvePrice(d, model, group, now === undefined ? {} : { now })
  if (!p || p.quotaType !== 0) throw new Error(`${model}@${group} 不是按量计价`)
  return p
}
```

`Pricing` 类型需一并加进顶部 import。再把这些 describe 块追加到文件末尾:

```ts
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
    const p = meteredOf(off, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
    expect(p.peak).toBeUndefined()
  })

  it("peak_active 含该模型时以其为权威,压过本地窗口计算", () => {
    const active = {
      ...P,
      peak_active: { "deepseek-v4-pro": { factor: 3, until: "23:00" } },
    }
    // 周末本地算不出高峰,但服务端说在高峰 → 以服务端为准
    const p = meteredOf(active, "deepseek-v4-pro", "deepseek-officially", WEEKEND)
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
    const p = meteredOf(broken, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
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
      meteredOf(strFactor, "deepseek-v4-pro", "deepseek-officially", WEEKEND).peak
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
    const p = meteredOf(multi, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
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
      meteredOf(badTz, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM).peak
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
        meteredOf(mk(w), "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM).peak
      ).toBeUndefined()
    }
  })

  it("命中时带出规则时区,供文案消除「至 12:00」的歧义", () => {
    const p = meteredOf(P, "deepseek-v4-pro", "deepseek-officially", IN_PEAK_AM)
    expect(p.peak?.timezone).toBe("Asia/Shanghai")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run -t "高峰浮动价"
```

预期:FAIL,`expected undefined to be 2`(`p.peak` 尚未实现)。

- [ ] **Step 3: 在 `pricing.ts` 实现窗口判定**

在 `resolvePrice` 之前插入:

```ts
const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

// 取目标时区下的 ISO 星期(1=周一)与自 00:00 起的分钟数。
// 用 Intl 而非第三方时区库:Node 自带完整 ICU,零依赖。
// 取的是目标时区的**当地挂钟时间**,窗口比较也在挂钟域 —— 所以「当地 09:00-12:00」
// 这个语义在 DST 前后都成立(spring-forward 当天当地 02:00 不存在,fall-back 当天
// 当地 01:00 出现两次且两次都算高峰,这正是「营业时段」该有的行为)。用 UTC 偏移
// 量硬算才会错。
function zoned(now: Date, timeZone: string): { weekday: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now)
  } catch {
    // rule.timezone 是外部字段且无校验,非法值(如 "Not/AZone"、"")会让
    // Intl.DateTimeFormat 抛 RangeError。activePeak 在每个按量模型上都被调用,
    // 不兜住的话一个模型的坏规则会让整张价格表抛异常 —— 连不相关的查询一起挂。
    // 这里 fail-closed:当作不命中。weekday 0 匹配不上任何 weekdays(rule.weekdays
    // 用 1-7),minutes NaN 也会被 hitWindow 的显式 NaN 判空拦掉 —— 双重保险。
    return { weekday: 0, minutes: NaN }
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return {
    weekday: ISO_WEEKDAY[get("weekday")] ?? 0,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  }
}

// 越界的时分返回 NaN,让下游比较恒假(fail-closed)。不校验的话 "09:60" 会被
// 算成 600 分钟 = 10:00,把窗口悄悄挪后一小时且不报错。
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":")
  const hh = Number(h)
  const mm = Number(m)
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return NaN
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN
  return hh * 60 + mm
}

// 命中则返回该窗口的结束时刻(如 "12:00")。
//
// 窗口左闭右开:12:00 整已不算在 09:00-12:00 内。
//
// 支持跨零点窗口(如 "22:00-02:00",夜间优惠/夜间高峰的自然写法):此时 from > to,
// 命中条件变成「>= from 或 < to」。不支持的话 `minutes >= 1320 && minutes < 120`
// 恒为 false —— 全时段都不命中,而且不报错不告警,等于静默按平时价报出错价。
// windows 是外部字段,平台随时可能这么写。
function hitWindow(windows: string[], minutes: number): string | undefined {
  for (const w of windows) {
    const [from, to] = w.split("-")
    if (!from || !to) continue
    const f = toMinutes(from)
    const t = toMinutes(to)
    // 必须显式判空,不能指望 `f <= t` 自然落空:当 f/t 恰好一个 NaN 一个合法值
    // 时(如 "09:60-12:00" → f=NaN, t=720),`f <= t` 为 false 会把它误判成
    // 跨零点窗口,而 else 分支的 `minutes < t` 单独成立时仍会算出 hit=true
    // ——「畸形窗口一律不命中」的承诺就破了。两侧必须都合法才继续判定。
    if (Number.isNaN(f) || Number.isNaN(t)) continue
    const hit =
      f <= t ? minutes >= f && minutes < t : minutes >= f || minutes < t
    if (hit) return to
  }
  return undefined
}

// peak_active 语义无官方文档(实盘为 {})。策略:非空且含该模型时以它为
// 权威,否则本地按 rules 算 —— 服务端将来给出权威值时自动接上。
//
// weekdays 起始值同样无文档。实盘规则为 [1,2,3,4,5],在 ISO(1=周一)与
// Date.getDay()(0=周日)两种约定下都等于周一至周五,故当前不受影响。
// 此处按 ISO 实现;将来出现含 0 / 6 / 7 的规则时需重新核实。
function activePeak(
  d: Pricing,
  model: string,
  now: Date
): { factor: number; until?: string; timezone?: string } | undefined {
  const fromServer = d.peak_active?.[model]
  // 显式校验 factor 而非 if (fromServer):peak_active 来自 as Pricing 强转的外部
  // JSON,语义无官方文档。缺 factor 时算术有 ?? 1 兜着,但 peak.factor 会带着
  // undefined 一路走到文案里输出「×undefined」—— 与 cache_ratio 那个 NaN 同型。
  if (typeof fromServer?.factor === "number") return fromServer
  if (!d.peak_pricing?.enabled) return undefined
  for (const rule of d.peak_pricing.rules ?? []) {
    if (!rule.enabled || !rule.models?.includes(model)) continue
    const { weekday, minutes } = zoned(now, rule.timezone)
    if (!rule.weekdays?.includes(weekday)) continue
    const until = hitWindow(rule.windows ?? [], minutes)
    if (until) return { factor: rule.factor, until, timezone: rule.timezone }
  }
  return undefined
}
```

- [ ] **Step 4: 接进 `resolvePrice` 的按量分支**

把 Task 1 里 `resolvePrice` 末尾的 return 块整体替换为:

```ts
  const base = opts.base ?? DEFAULT_BASE
  const offPeakInput = ratio * gr * base
  const offPeakOutput = offPeakInput * m.completion_ratio
  const peakHit = activePeak(d, model, opts.now ?? new Date())
  // 先算平时价,最后统一乘 factor —— input/output 提成局部变量共用,
  // 免得 Task 3 的 tiers 再写一遍 `offPeakOutput * (peakHit?.factor ?? 1)`,
  // 将来改高峰口径要改两处。
  const factor = peakHit?.factor ?? 1
  const input = offPeakInput * factor
  const output = offPeakOutput * factor
  return {
    ...common,
    quotaType: 0,
    base,
    input,
    output,
    // cacheRead / cacheWrite 用高峰后的 input —— 即缓存价同步参与高峰浮动。
    // 该假设无官方文档,理由见文件头计价顺序第 4 条。
    cacheRead: m.cache_ratio === undefined ? undefined : input * m.cache_ratio,
    cacheWrite:
      m.cache_creation_ratio_5m === undefined
        ? undefined
        : input * m.cache_creation_ratio_5m,
    peak: peakHit
      ? {
          factor: peakHit.factor,
          until: peakHit.until,
          timezone: peakHit.timezone,
          offPeakInput,
          offPeakOutput,
        }
      : undefined,
  }
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm vitest run tests/plugins/packyapi/pricing.test.ts
```

预期:PASS,42 个用例全绿(Task 1 的 25 个 + 本 Task 的 17 个)。

两处边界已在写计划前用 `Intl` 实测过,测试里各有一条对应用例:`12:00` 整不算高峰(窗口左闭右开),周末即使落在时段内也被 `weekdays` 拦下。

- [ ] **Step 6: 提交**

```bash
git add plugins/packyapi/scripts/pricing.ts tests/plugins/packyapi/pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(packyapi): 接入高峰浮动价,按调用时刻给出当下实价

实盘 peak_pricing.enabled 已是 true(reference 文档里写的 false 早已过时),
规则为 Asia/Shanghai 周一至五 09:00-12:00 与 14:00-18:00,deepseek 三模型
factor=2。此前插件完全不读该字段,高峰期用户问价会拿到偏低一半的报价。

时区判定用 Intl.DateTimeFormat 而非第三方库,Node 自带完整 ICU,零依赖。
窗口左闭右开(12:00 整已不算高峰)。peak_active 语义无官方文档,按
「非空且含该模型时以其为权威,否则本地按 rules 算」处理,服务端将来给出
权威值时自动接上。
EOF
)"
```

---

### Task 3: 阶梯价(tiers)与按次计价区间

`tiers` 实盘覆盖 17/67 个模型(长上下文超阈值后倍率变化)。实盘按次计价模型共 3 个,其中 2 个(`gpt-image-2`、`grok-imagine-image-2.0`)带 `model_price_min`/`max` 区间,`omni-moderation-latest` 无。

**Files:**
- Modify: `plugins/packyapi/scripts/pricing.ts`
- Modify: `tests/plugins/packyapi/pricing.test.ts`

- [ ] **Step 1: 写失败的测试**

追加到 `tests/plugins/packyapi/pricing.test.ts`:

复用 Task 1/2 建好的 `metered()` / `meteredOf()` helper。按次计价的用例另加一个收窄 helper:

```ts
function perCall(d: Pricing, model: string, group: string): PerCallPrice {
  const p = resolvePrice(d, model, group)
  if (!p || p.quotaType !== 1) throw new Error(`${model}@${group} 不是按次计价`)
  return p
}
```

```ts
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

  it("高峰与阶梯叠加时,input/output 两腿以同一个高峰后基准换算", () => {
    // 实盘没有同时命中高峰规则与 tiers 的模型(高峰只点名 3 个 deepseek,均无
    // tiers),但代码路径存在。用 peak_active 给 gpt-5.6-sol 强行造一个高峰。
    const both = {
      ...P,
      peak_active: { "gpt-5.6-sol": { factor: 2 } },
    }
    const off = metered("gpt-5.6-sol", "codex")
    const on = meteredOf(both, "gpt-5.6-sol", "codex")
    expect(off.input).toBeCloseTo(2.5)
    expect(off.output).toBeCloseTo(15)
    expect(on.input).toBeCloseTo(5) // 2.5 × 2
    expect(on.output).toBeCloseTo(30) // 15 × 2
    // 阶梯以高峰后价为基准:两腿都乘了同一个 factor,不会一腿平时一腿高峰
    expect(on.tiers![0].input).toBeCloseTo(10) // 5 × 2
    expect(on.tiers![0].output).toBeCloseTo(45) // 30 × 1.5
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run -t "阶梯价"
```

预期:FAIL,`expected undefined to have a length of 1`。

- [ ] **Step 3: 实现**

在 `pricing.ts` 的 `resolvePrice` 里,把按次分支替换为:

```ts
  if (m.quota_type === 1) {
    return {
      ...common,
      quotaType: 1,
      perCall: m.model_price * gr,
      perCallMin:
        m.model_price_min === undefined ? undefined : m.model_price_min * gr,
      perCallMax:
        m.model_price_max === undefined ? undefined : m.model_price_max * gr,
    }
  }
```

在按量分支的 return 里,`peak` 字段之后追加 `tiers`:

```ts
    tiers: m.tiers?.length
      ? m.tiers.map((t) => ({
          threshold: t.threshold,
          input: input * t.ratio,
          output: output * (t.output_ratio ?? t.ratio),
        }))
      : undefined,
```

> 直接复用 Task 2 提取的局部变量 `input` / `output`(它们已是高峰后的价),不要重新写
> `offPeakOutput * (peakHit?.factor ?? 1)` —— Task 2 提取这两个变量的注释里就写明了
> 「免得 Task 3 的 tiers 再写一遍,将来改高峰口径要改两处」。两种写法数值等价,但重写
> 一遍等于把同一个口径散到两处。
>
> 阶梯以第 4 步(高峰之后)的价为基准 —— spec 已记录该次序为无官方文档的假设。实盘
> `peak_pricing` 只覆盖 deepseek 三模型,而这三个模型均无 `tiers`,当前两者不重叠;
> 但代码路径存在,故测试用 `peak_active` 人工构造一个同时命中的用例(见 Step 1)。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/plugins/packyapi/pricing.test.ts
```

预期:PASS,48 个用例全绿(Task 1 的 25 + Task 2 的 17 + 本 Task 的 6)。

- [ ] **Step 5: 提交**

```bash
git add plugins/packyapi/scripts/pricing.ts tests/plugins/packyapi/pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(packyapi): 接入长上下文阶梯价与按次计价区间

tiers 实盘覆盖 17/67 个模型(超 threshold 后倍率变化,output_ratio 可与
input 的 ratio 不同,缺省则回落 ratio),model_price_min/max 覆盖 2 个图片
模型。此前两者都未读:长上下文场景报价偏低,图片模型只报一个固定价而不
给区间。

阶梯以高峰之后的价为基准换算。该叠加次序无官方文档,实盘 peak_pricing 只
覆盖 deepseek 三模型且它们均无 tiers,当前两者不重叠。
EOF
)"
```

---

### Task 4: 抽出 `format.ts`(纯搬运,行为不变)

这是一次**纯重构**:把全部 `format*` 函数从 `packy-mcp.ts` 原样搬到 `format.ts`,测试跟着改导入路径,断言一行不改。断言不改是这次搬运没走样的证据。

**Files:**
- Create: `plugins/packyapi/scripts/format.ts`
- Modify: `plugins/packyapi/scripts/packy-mcp.ts`
- Rename: `tests/plugins/packyapi/packy-mcp.test.ts` → `tests/plugins/packyapi/format.test.ts`
- Modify: `tests/plugins/packyapi/fixture.ts`(补回 `A` 与 `Announcements` 的 import)

- [ ] **Step 1: 建 `format.ts`,搬入现有格式化代码**

创建 `plugins/packyapi/scripts/format.ts`。把 `packy-mcp.ts` 第 60-234 行的这些内容**原样**搬过来:`Announcement` / `Announcements` 两个 interface、`grValue` / `pad` / `padStart` 三个辅助函数、`formatPrice` / `formatModels` / `formatGroups` / `formatRaw` / `formatAnnouncements` 五个格式化函数。文件头写:

```ts
/**
 * PackyAPI 输出层 —— 全部 format* 函数,把 pricing.ts 解析出的价格与
 * 原始数据渲染成极简结构化文本。只依赖 pricing.ts,不触网、不引 MCP SDK。
 *
 * 依赖方向单向:packy-mcp.ts → format.ts → pricing.ts。
 * 公告类型放这里而非 packy-mcp.ts:formatAnnouncements 是其唯一的结构化
 * 消费方,放这里可避免两个模块互相 import。
 */
import type { Pricing } from "./pricing.ts"
```

- [ ] **Step 2: `packy-mcp.ts` 改为从 `format.ts` 导入**

删掉刚搬走的那些定义,在 import 区加:

```ts
import {
  formatAnnouncements,
  formatGroups,
  formatModels,
  formatPrice,
  formatRaw,
  type Announcements,
} from "./format.ts"

export type { Announcement, Announcements } from "./format.ts"
export {
  formatAnnouncements,
  formatGroups,
  formatModels,
  formatPrice,
  formatRaw,
} from "./format.ts"
```

> 这些再导出是过渡用的,Task 7 会连同旧测试路径一起清掉。

- [ ] **Step 3: 迁移测试文件**

```bash
git mv tests/plugins/packyapi/packy-mcp.test.ts tests/plugins/packyapi/format.test.ts
```

把 `format.test.ts` 顶部的导入路径由 `@/plugins/packyapi/scripts/packy-mcp` 改为 `@/plugins/packyapi/scripts/format`,并把 `Pricing` 类型的导入改成从 `@/plugins/packyapi/scripts/pricing` 取:

```ts
import { describe, expect, it } from "vitest"
import {
  formatAnnouncements,
  formatGroups,
  formatModels,
  formatPrice,
  formatRaw,
  type Announcements,
} from "@/plugins/packyapi/scripts/format"
import type { Pricing } from "@/plugins/packyapi/scripts/pricing"
```

**其余内容(局部的 `D` / `A` 常量与全部断言)这一步一行都不要改。**

- [ ] **Step 4: 跑测试确认行为不变**

```bash
pnpm vitest run tests/plugins/packyapi/
```

预期:PASS。`pricing.test.ts` 48 个 + `format.test.ts` 16 个,断言未改动而全绿 —— 这就是搬运没走样的证据。

- [ ] **Step 5: 补齐 fixture 的公告部分**

`format.ts` 已存在,现在把 Task 1 Step 1 里暂缓的部分补进 `tests/plugins/packyapi/fixture.ts`:顶部加 `import type { Announcements } from "@/plugins/packyapi/scripts/format"`,文件末尾加上 Task 1 Step 1 给出的 `export const A: Announcements = {...}` 整块。

- [ ] **Step 6: 提交**

```bash
pnpm prettier --write plugins/packyapi/scripts/*.ts tests/plugins/packyapi/*.ts
git add plugins/packyapi/scripts/ tests/plugins/packyapi/
git commit -m "$(cat <<'EOF'
refactor(packyapi): 把格式化函数抽到 format.ts

packy-mcp.ts 原本装配、fetch、计价、格式化四件事挤在 368 行里,接入
model_group_ratio / peak_pricing / tiers 后会破 700 行。本次纯搬运,
format* 五个函数与公告类型原样移入 format.ts,测试断言一行未改而全绿。

依赖方向收敛为单向:packy-mcp.ts → format.ts → pricing.ts。
EOF
)"
```

---

### Task 5: `formatPrice` 接定价解析器 + 标记脚注 + 未知组候选

输出策略是「默认精简」:表格列数不变,只在模型名后缀标记,把解释集中到表尾脚注。

**Files:**
- Modify: `plugins/packyapi/scripts/format.ts`
- Modify: `tests/plugins/packyapi/format.test.ts`

- [ ] **Step 1: 把 `format.test.ts` 的本地 fixture 换成共享 fixture**

删掉 `format.test.ts` 里局部的 `const D: Pricing = {...}` 与 `const A: Announcements = {...}` 两块,改从共享 fixture 导入,并把断言里的 `D` 全部替换为 `P`:

```ts
import { describe, expect, it } from "vitest"
import {
  formatAnnouncements,
  formatGroups,
  formatModels,
  formatPrice,
  formatRaw,
} from "@/plugins/packyapi/scripts/format"
import { A, IN_PEAK_AM, OFF_PEAK, P } from "./fixture"
```

随之要调整的既有断言(共享 fixture 的模型名与分组和旧的 `D` 不同):

- `formatPrice` 的 `claude-opus-4-8` 全部改为 `claude-opus-5`,价格数值不变(`$10.00 / $50.00 / $1.00`、`cc-sale` 的 `$4.00`、`base:1` 的 `$5.00`)。
- 按次那条改为 `formatPrice(P, { keyword: "gpt-image", group: "image", now: OFF_PEAK })`,期望 `$0.4000/次`。
- `formatModels` 的 `gpt-image-1` 改为 `gpt-image-2`;「组过滤:cc-sale 仅 opus」改为断言 `formatModels(P, { group: "cc-sale" })` 含 `claude-opus-5` 且不含 `glm-5.2`。
- `formatRaw` 的 `claude-opus-4-8` 改为 `claude-opus-5`。
- 所有调用 `formatPrice` 的既有用例都补上 `now: OFF_PEAK`,免得测试结果随真实时钟漂移。

- [ ] **Step 2: 写失败的新测试**

追加到 `format.test.ts`:

```ts
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
    expect(out).toContain("deepseek-v4-pro*")
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
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm vitest run tests/plugins/packyapi/format.test.ts
```

预期:FAIL,`expected ... to contain "glm-5.2†"`。

- [ ] **Step 4: 重写 `formatPrice`**

在 `format.ts` 里,把 import 改为:

```ts
import {
  DEFAULT_BASE,
  resolvePrice,
  type EffectivePrice,
  type Pricing,
} from "./pricing.ts"
```

新增两个辅助函数,并整体替换 `formatPrice`:

```ts
// 一个组名「认识」的两种来源:group_ratio / inactive_groups 里有倍率定义,
// 或至少被某个模型的 enable_groups 引用(实盘的「孤儿组」只满足后者)。
// 两者皆无才算拼错,此时列出候选 —— 否则模型拿不到线索会转去抓 HTML 页面,
// 正是本插件要避免的。
function knownGroups(d: Pricing): string[] {
  return [
    ...new Set([
      ...Object.keys(d.group_ratio ?? {}),
      ...(d.inactive_groups ?? []),
      ...(d.data ?? []).flatMap((m) => m.enable_groups ?? []),
    ]),
  ].sort()
}

// 「至 12:00」只在规则时区是 Asia/Shanghai 时无歧义。timezone 是外部字段,
// 非 Asia/Shanghai 时点出来 —— 常见情形下输出长度不变,不破坏默认精简。
function tzSuffix(tz?: string): string {
  return !tz || tz === "Asia/Shanghai" ? "" : ` ${tz}`
}

// 行内标记:† 分组倍率覆盖 / * 高峰中 / ‡ 有阶梯价 / § 孤儿组倍率按 1 估算。
// 只标不解释,解释集中到表尾脚注 —— 常见问答的 token 不因此上涨。
function marksOf(p: EffectivePrice): string {
  return [
    p.ratioSource === "group-override" ? "†" : "",
    p.quotaType === 0 && p.peak ? "*" : "",
    p.quotaType === 0 && p.tiers?.length ? "‡" : "",
    p.grSource === "fallback-1" ? "§" : "",
  ].join("")
}

function notesOf(p: EffectivePrice, m: { model_ratio: number }): string[] {
  const notes: string[] = []
  if (p.ratioSource === "group-override") {
    notes.push(
      `† ${p.model} 在组 ${p.group} 有专属倍率(model_group_ratio),已覆盖全局 model_ratio ${m.model_ratio}`
    )
  }
  if (p.grSource === "fallback-1") {
    notes.push(
      `§ 组 ${p.group} 在 group_ratio 里倍率无定义,上表按 1 估算 —— 实际计费可能不同,请以平台为准`
    )
  }
  if (p.quotaType !== 0) return notes
  if (p.peak) {
    notes.push(
      `* ${p.model} 高峰中(×${p.peak.factor}${
        p.peak.until ? `,至 ${p.peak.until}${tzSuffix(p.peak.timezone)}` : ""
      });平时 in $${p.peak.offPeakInput.toFixed(2)} / out $${p.peak.offPeakOutput.toFixed(2)}`
    )
  }
  for (const t of p.tiers ?? []) {
    notes.push(
      `‡ ${p.model} 长上下文阶梯:>${t.threshold} tokens 时 in $${t.input.toFixed(2)} / out $${t.output.toFixed(2)}`
    )
  }
  return notes
}

export function formatPrice(
  d: Pricing,
  opts: {
    keyword?: string
    group?: string
    base?: number
    now?: Date
  } = {}
): string {
  const groupArg = opts.group
  const base = opts.base ?? DEFAULT_BASE
  const kw = (opts.keyword ?? "").toLowerCase()
  const now = opts.now ?? new Date()
  const known = knownGroups(d)
  if (groupArg && !known.includes(groupArg)) {
    return `未知分组 ${groupArg}。可用分组:${known.join("、")}`
  }
  const rows: string[][] = []
  const notes: string[] = []
  for (const m of d.data) {
    if (kw && !m.model_name.toLowerCase().includes(kw)) continue
    let groups: string[]
    if (groupArg) {
      if (!m.enable_groups?.includes(groupArg)) continue
      groups = [groupArg]
    } else if (kw) {
      groups = m.enable_groups ?? []
    } else {
      groups = m.enable_groups?.includes("cc") ? ["cc"] : []
    }
    for (const g of groups) {
      const p = resolvePrice(d, m.model_name, g, { base, now })
      if (!p) continue
      const name = `${m.model_name}${marksOf(p)}`
      const ep = p.endpoints.join(",")
      if (p.quotaType === 1) {
        // 判别联合已收窄,perCall 在这一支是必填,无需非空断言
        rows.push([name, g, `$${p.perCall.toFixed(4)}/次`, "-", "-", ep])
      } else {
        rows.push([
          name,
          g,
          `$${p.input.toFixed(2)}`,
          `$${p.output.toFixed(2)}`,
          // cache_ratio 实盘 10/67 缺失,缺失时出 - 而不是 $NaN
          p.cacheRead === undefined ? "-" : `$${p.cacheRead.toFixed(2)}`,
          ep,
        ])
      }
      notes.push(...notesOf(p, m))
    }
  }
  if (rows.length === 0) {
    return `无匹配(group=${groupArg ?? "自动"}, 关键词=${kw || "无"})`
  }
  const scope = groupArg
    ? `组 ${groupArg}(倍率 ${grValue(d, groupArg)})`
    : kw
      ? "各分组"
      : "组 cc"
  const out: string[] = [`# ${scope}, base ${base} — 单位 $/1M tokens`]
  out.push(
    `${pad("model", 32)} ${pad("group", 18)} ${padStart("in", 8)} ${padStart("out", 9)} ${padStart("cache", 8)}  endpoints`
  )
  // 第三级 tie-break 按组名:前两级(模型名、组倍率)在同模型多组时会同时打平,
  // 没有它行序就落到 d.data / enable_groups 的原始数组顺序上,输出不确定。
  const sorted = rows.sort(
    (a, b) =>
      a[0].localeCompare(b[0]) ||
      grValue(d, a[1]) - grValue(d, b[1]) ||
      a[1].localeCompare(b[1])
  )
  for (const r of sorted) {
    out.push(
      `${pad(r[0], 32)} ${pad(r[1], 18)} ${padStart(r[2], 8)} ${padStart(r[3], 9)} ${padStart(r[4], 8)}  ${r[5]}`
    )
  }
  if (notes.length) {
    out.push("")
    out.push(...[...new Set(notes)])
  }
  return out.join("\n")
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm vitest run tests/plugins/packyapi/
```

预期:PASS,`pricing.test.ts` 48 个 + `format.test.ts` 28 个全绿(原有 16 + 本 Task 新增 12)。

- [ ] **Step 6: 提交**

```bash
pnpm prettier --write plugins/packyapi/scripts/*.ts tests/plugins/packyapi/*.ts
git add plugins/packyapi/scripts/format.ts tests/plugins/packyapi/
git commit -m "$(cat <<'EOF'
feat(packyapi): price 输出接定价解析器,加行内标记与表尾脚注

formatPrice 改为逐行调 resolvePrice,于是分组倍率覆盖、高峰浮动、阶梯价、
cache_ratio 缺失四项修正同时体现在 price 输出上。glm-5.2 在 glm-sale 组
从 $8.00 变为正确的 $1.00;gemini-slb 组的 $NaN 变为 -。

保持默认精简:表格列数不变,命中特殊计价的行只在模型名后缀 †(倍率覆盖)
/ *(高峰中)/ ‡(有阶梯)/ §(孤儿组倍率按 1 估算),解释集中到表尾脚注
去重后输出。常见问答的 token 不因此上涨。

另两处修正:

- 传入不认识的分组名时列出可用分组。此前只回「无匹配」,模型拿不到线索会
  转去抓 HTML 页面 —— 正是本插件要避免的。判定「认识」时把仅被 enable_groups
  引用的孤儿组也算进去,否则 hongjing 这类组会被误报为拼错。
- 排序补第三级 tie-break(组名)。前两级在同模型多组且倍率相同时会同时打平
  (实盘 glm 系三个模型正是如此),行序会落到 API 返回的数组顺序上。
EOF
)"
```

---

### Task 6: `formatModels` 厂商过滤与端点覆盖、`formatGroups` 停用标记

**Files:**
- Modify: `plugins/packyapi/scripts/format.ts`
- Modify: `tests/plugins/packyapi/format.test.ts`

- [ ] **Step 1: 写失败的测试**

追加到 `format.test.ts`:

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run -t "厂商与端点"
```

预期:FAIL,`Object literal may only specify known properties, and 'vendor' does not exist`(typecheck 层)或断言失败。

- [ ] **Step 3: 实现**

`format.ts` 里替换 `formatModels`:

```ts
export function formatModels(
  d: Pricing,
  opts: { group?: string; endpoint?: string; vendor?: string } = {}
): string {
  const group = opts.group ?? "cc"
  const endpoint = opts.endpoint
  const vendorKw = (opts.vendor ?? "").toLowerCase()
  const names: string[] = []
  for (const m of d.data) {
    if (!m.enable_groups?.includes(group)) continue
    // 端点走分组级覆盖优先 —— 同一模型在不同组开放的端点可能不同
    const eps =
      d.model_group_endpoints?.[group]?.[m.model_name] ??
      m.supported_endpoint_types ??
      []
    if (endpoint && !eps.includes(endpoint)) continue
    if (vendorKw) {
      const vn = d.vendors?.find((v) => v.id === m.vendor_id)?.name ?? ""
      if (!vn.toLowerCase().includes(vendorKw)) continue
    }
    names.push(m.model_name)
  }
  const head = `# group=${group}${endpoint ? ` endpoint=${endpoint}` : ""}${
    opts.vendor ? ` vendor=${opts.vendor}` : ""
  } — ${names.length} 个模型`
  if (names.length === 0 && vendorKw) {
    const all = [...new Set((d.vendors ?? []).map((v) => v.name))].sort()
    return `${head}\n无匹配厂商。可用厂商:${all.join("、")}`
  }
  const out: string[] = [head]
  for (const n of names.sort((a, b) => a.localeCompare(b))) out.push(n)
  return out.join("\n")
}
```

替换 `formatGroups`:

```ts
export function formatGroups(d: Pricing): string {
  const gr = d.group_ratio ?? {}
  const desc = d.usable_group ?? {}
  const off = new Set(d.inactive_groups ?? [])
  const out: string[] = ["# 分组倍率(group_ratio)与说明"]
  for (const g of Object.keys(gr).sort((a, b) => gr[a] - gr[b])) {
    const tag = off.has(g) ? "[停用] " : ""
    out.push(
      `${pad(g, 22)} x${pad(String(gr[g]), 5)} ${tag}${(desc[g] ?? "").trim()}`
    )
  }
  return out.join("\n")
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/plugins/packyapi/
```

预期:PASS,`format.test.ts` 32 个用例全绿。

- [ ] **Step 5: 提交**

```bash
pnpm prettier --write plugins/packyapi/scripts/*.ts tests/plugins/packyapi/*.ts
git add plugins/packyapi/scripts/format.ts tests/plugins/packyapi/format.test.ts
git commit -m "$(cat <<'EOF'
feat(packyapi): models 支持按厂商过滤,端点过滤改走分组级覆盖

vendors + vendor_id 此前未接入,「列出全部 Anthropic 模型」这类问题答不了。
新增 vendor 参数(子串、不区分大小写),无匹配时列出可用厂商名。

endpoint 过滤原先只看 supported_endpoint_types,忽略了
model_group_endpoints 的分组级覆盖 —— 同一模型在不同组开放的端点可能不同,
过滤结果因此可能偏多。groups 输出为 inactive_groups 内的组加 [停用] 标记。
EOF
)"
```

---

### Task 7: `formatDetail` 与 `packy-mcp.ts` 接线

「按需展开」的落点。`detail` 出单模型全量计价,`price` 表保持原样。

**Files:**
- Modify: `plugins/packyapi/scripts/format.ts`
- Modify: `plugins/packyapi/scripts/packy-mcp.ts`
- Modify: `tests/plugins/packyapi/format.test.ts`

- [ ] **Step 1: 写失败的测试**

把 `formatDetail` 加进顶部那组 `@/plugins/packyapi/scripts/format` 的具名导入里(ESM 的 import 必须在文件顶部,**不要**跟着测试块追加到末尾),再把这个 describe 块追加到文件末尾:

```ts
describe("formatDetail", () => {
  it("缺 model 参数给出指引", () => {
    expect(formatDetail(P)).toContain("需 model 参数")
  })

  it("未找到时给相近候选", () => {
    const out = formatDetail(P, { model: "opus" })
    expect(out).toContain("未找到模型")
    expect(out).toContain("claude-opus-5")
  })

  it("默认遍历该模型全部可用分组,含厂商与端点路径", () => {
    const out = formatDetail(P, { model: "claude-opus-5", now: OFF_PEAK })
    expect(out).toContain("Anthropic")
    expect(out).toContain("## 组 cc")
    expect(out).toContain("## 组 cc-sale")
    expect(out).toContain("$10.00")
    expect(out).toContain("$12.50") // 缓存写入 10 * 1.25
    expect(out).toContain("/v1/messages")
  })

  it("group 锁定单组", () => {
    const out = formatDetail(P, {
      model: "claude-opus-5",
      group: "cc",
      now: OFF_PEAK,
    })
    expect(out).toContain("## 组 cc")
    expect(out).not.toContain("## 组 cc-sale")
  })

  it("无缓存写入价时显式标注「无」", () => {
    const out = formatDetail(P, { model: "glm-5.2", now: OFF_PEAK })
    expect(out).toContain("缓存写 无")
  })

  it("倍率覆盖时说明来源与被覆盖的全局值", () => {
    const out = formatDetail(P, { model: "glm-5.2", now: OFF_PEAK })
    expect(out).toContain("model_group_ratio")
    expect(out).toContain("4") // 被覆盖的全局 model_ratio
  })

  it("高峰中出高峰行与平时价", () => {
    const out = formatDetail(P, {
      model: "deepseek-v4-pro",
      now: IN_PEAK_AM,
    })
    expect(out).toContain("高峰中 ×2")
    expect(out).toContain("至 12:00")
    expect(out).toContain("$1.60")
  })

  it("阶梯价逐行列出", () => {
    const out = formatDetail(P, { model: "gpt-5.6-sol", now: OFF_PEAK })
    expect(out).toContain("阶梯 >272000")
    expect(out).toContain("$5.00") // 阶梯 in:2.5 × 2
    expect(out).toContain("$22.50") // 阶梯 out:15 × 1.5
  })

  it("无 cache_ratio 时缓存读标注「无」而非 NaN", () => {
    const out = formatDetail(P, {
      model: "gemini-3-pro-preview",
      now: OFF_PEAK,
    })
    expect(out).toContain("缓存读 无")
    expect(out).not.toContain("NaN")
  })

  it("模型不提供的组给出明确提示与可用分组,而非静默空壳", () => {
    const out = formatDetail(P, {
      model: "glm-5.2",
      group: "cc",
      now: OFF_PEAK,
    })
    expect(out).toContain("不在该组提供")
    expect(out).toContain("glm-sale")
    // 不能出现拿 cc 倍率硬算的假价
    expect(out).not.toContain("$16.00")
  })

  it("孤儿组标注倍率无定义,并照样出该组的估算价", () => {
    const out = formatDetail(P, { model: "gpt-5.6-sol", now: OFF_PEAK })
    expect(out).toContain("## 组 hongjing")
    expect(out).toContain("倍率无定义")
    expect(out).toContain("$5.00")
  })

  it("按次模型出单价与区间", () => {
    const out = formatDetail(P, { model: "gpt-image-2", now: OFF_PEAK })
    expect(out).toContain("按次 $0.4000/次")
    expect(out).toContain("$0.0294")
    expect(out).toContain("$3.5579")
  })

  it("有 image_ratio 时原样带出,无则不出该行", () => {
    expect(formatDetail(P, { model: "gpt-image-2", now: OFF_PEAK })).toContain(
      "image_ratio 1.6"
    )
    expect(
      formatDetail(P, { model: "claude-opus-5", now: OFF_PEAK })
    ).not.toContain("image_ratio")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm vitest run -t "formatDetail"
```

预期:FAIL,`formatDetail is not a function`。

- [ ] **Step 3: 实现 `formatDetail`**

`formatDetail` 要用 `resolveGroups`,把它加进 `format.ts` 顶部那组 `./pricing.ts` 的具名导入里。然后追加:

```ts
function endpointPath(d: Pricing, ep: string): string {
  const s = d.supported_endpoint?.[ep]
  return s ? `(${s.method} ${s.path})` : ""
}

export function formatDetail(
  d: Pricing,
  opts: { model?: string; group?: string; base?: number; now?: Date } = {}
): string {
  const want = opts.model
  if (!want) return "detail 需 model 参数;用 action=models 查确切模型 ID"
  const m = d.data?.find((x) => x.model_name === want)
  if (!m) {
    const near = (d.data ?? [])
      .map((x) => x.model_name)
      .filter((n) => n.toLowerCase().includes(want.toLowerCase()))
      .slice(0, 8)
    return near.length
      ? `未找到模型: ${want};相近候选:${near.join("、")}`
      : `未找到模型: ${want};用 action=models 查全部 ID`
  }
  const base = opts.base ?? DEFAULT_BASE
  const now = opts.now ?? new Date()
  // 不给 group 时遍历全部可用组;排序以保证输出确定,不依赖外部 API 的数组顺序
  const groups = opts.group ? [opts.group] : resolveGroups(d, m.model_name)
  const vendor = d.vendors?.find((v) => v.id === m.vendor_id)?.name ?? "未知"
  const out: string[] = [
    `# ${m.model_name}  厂商 ${vendor}  计价 ${
      m.quota_type === 1 ? "按次" : "按量"
    }  base ${base}`,
  ]
  for (const g of groups) {
    const p = resolvePrice(d, m.model_name, g, { base, now })
    // resolvePrice 对「该模型不在这个组里」返回 undefined(见 Task 1)。
    // 这里不能静默跳过 —— 用户点名问了这个组,得告诉他该模型不提供,
    // 并给出它真实可用的组,否则只会看到一个没有任何组的空壳输出。
    if (!p) {
      out.push("")
      out.push(
        `## 组 ${g}:${m.model_name} 不在该组提供。可用分组:${resolveGroups(d, m.model_name).join("、")}`
      )
      continue
    }
    out.push("")
    out.push(
      `## 组 ${g}(倍率 x${grValue(d, g)})${
        d.inactive_groups?.includes(g) ? " [停用]" : ""
      }`
    )
    if (p.grSource === "fallback-1") {
      out.push(`注意:组 ${g} 在 group_ratio 里倍率无定义,下列价格按 1 估算`)
    }
    if (p.quotaType === 1) {
      out.push(`按次 $${p.perCall.toFixed(4)}/次`)
      if (p.perCallMin !== undefined && p.perCallMax !== undefined) {
        out.push(
          `区间 $${p.perCallMin.toFixed(4)} ~ $${p.perCallMax.toFixed(4)}/次`
        )
      }
      // image_ratio 的确切语义无官方文档,原样带出而不臆造公式
      if (m.image_ratio !== undefined) {
        out.push(`image_ratio ${m.image_ratio}(图片计价倍率,语义见官方文档)`)
      }
    } else {
      out.push(
        `输入 $${p.input.toFixed(2)}  输出 $${p.output.toFixed(2)}  缓存读 ${
          p.cacheRead === undefined ? "无" : `$${p.cacheRead.toFixed(2)}`
        }  缓存写 ${
          p.cacheWrite === undefined ? "无" : `$${p.cacheWrite.toFixed(2)}`
        }  (单位 $/1M tokens)`
      )
    }
    if (p.ratioSource === "group-override") {
      out.push(
        `倍率来源 model_group_ratio(该组专属),已覆盖全局 model_ratio ${m.model_ratio}`
      )
    }
    if (p.peak) {
      out.push(
        `高峰中 ×${p.peak.factor}${
          p.peak.until ? `,至 ${p.peak.until}${tzSuffix(p.peak.timezone)}` : ""
        };平时 in $${p.peak.offPeakInput.toFixed(2)} / out $${p.peak.offPeakOutput.toFixed(2)}`
      )
    }
    for (const t of p.tiers ?? []) {
      out.push(
        `阶梯 >${t.threshold} tokens:in $${t.input.toFixed(2)} / out $${t.output.toFixed(2)}`
      )
    }
    out.push(
      `端点 ${p.endpoints.map((e) => `${e}${endpointPath(d, e)}`).join("  ")}`
    )
  }
  return out.join("\n")
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm vitest run tests/plugins/packyapi/format.test.ts
```

预期:PASS,`format.test.ts` 45 个用例全绿(Task 6 后的 32 + 本 Task 新增 13)。

- [ ] **Step 5: `packy-mcp.ts` 接线新 action 与参数**

把 `server.registerTool("packy", ...)` 的 `description`、`inputSchema` 与 handler 改为:

```ts
server.registerTool(
  "packy",
  {
    title: "PackyAPI 价格/模型查询",
    description:
      "查询 PackyAPI(Claude/OpenAI/Gemini 兼容的 AI API 中转平台)的模型价格、可用模型 ID、分组倍率、单模型完整计价与平台公告。底层读公开 JSON /api/pricing,本地计价,输出极简结构化文本 —— 比抓 HTML 页面省 token 且精确。计价已计入分组级倍率覆盖(model_group_ratio)与高峰浮动价(peak_pricing),价格单位 $/1M tokens。要单模型的完整计价(缓存写入价、长上下文阶梯价、端点路径、厂商)用 action=detail。",
    inputSchema: {
      action: z
        .enum([
          "price",
          "models",
          "groups",
          "raw",
          "announcements",
          "detail",
        ])
        .describe(
          "查询类型:price=计价表($/1M tokens,含 input/output/cache) / models=列可用模型 ID / groups=列全部分组倍率与说明 / raw=单模型完整原始 JSON / announcements=平台公告(上新、变更、通知) / detail=单模型全量计价(各分组实价 + 缓存写入 + 阶梯价 + 高峰状态 + 端点路径 + 厂商)"
        ),
      keyword: z
        .string()
        .optional()
        .describe(
          "仅 price:按模型名子串过滤(不区分大小写);给了则列该模型在各可用分组下的价格,未给则默认只列 cc 组"
        ),
      group: z
        .string()
        .optional()
        .describe(
          "price/models/detail:锁定单个分组(如 cc、codex),用 action=groups 可查全部分组名"
        ),
      endpoint: z
        .string()
        .optional()
        .describe(
          "仅 models:按端点类型过滤,取值 anthropic / openai / openai-response / gemini / image-generation"
        ),
      vendor: z
        .string()
        .optional()
        .describe(
          "仅 models:按厂商名子串过滤(不区分大小写),如 Anthropic / OpenAI / DeepSeek"
        ),
      base: z
        .number()
        .optional()
        .describe(
          "price/detail:计价 base 系数,默认 2(即 $0.002/1K);input$ = 倍率×group_ratio×base"
        ),
      model: z
        .string()
        .optional()
        .describe(
          "raw/detail:精确模型 ID(必填,须与 models 列出的完全一致)"
        ),
      limit: z
        .number()
        .optional()
        .describe(
          "仅 announcements:列出最近几条公告,默认 5;keyword 可同时按标题/正文子串过滤"
        ),
    },
  },
  async ({ action, keyword, group, endpoint, vendor, base, model, limit }) => {
    // announcements 走独立 API,不读 pricing
    if (action === "announcements") {
      try {
        const a = await fetchAnnouncements()
        return {
          content: [
            { type: "text", text: formatAnnouncements(a, { keyword, limit }) },
          ],
        }
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: "text", text: `取公告失败: ${(e as Error).message}` },
          ],
        }
      }
    }
    let d: Pricing
    try {
      d = await fetchPricing()
    } catch (e) {
      return {
        isError: true,
        content: [
          { type: "text", text: `取 API 失败: ${(e as Error).message}` },
        ],
      }
    }
    // 格式化整体包 try/catch:resolvePrice 会对每个按量模型调 activePeak,
    // 而 rule.timezone 等字段来自无校验的外部 JSON。单个模型的坏数据不该让
    // 整次工具调用以未捕获异常收场。
    let text: string
    try {
    switch (action) {
      case "price":
        text = formatPrice(d, { keyword, group, base })
        break
      case "models":
        text = formatModels(d, { group, endpoint, vendor })
        break
      case "groups":
        text = formatGroups(d)
        break
      case "detail":
        if (!model) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "detail 需 model 参数;用 action=models 查确切模型 ID",
              },
            ],
          }
        }
        text = formatDetail(d, { model, group, base })
        break
      case "raw":
        if (!model) {
          return {
            isError: true,
            content: [{ type: "text", text: "raw 需 model 参数" }],
          }
        }
        text = formatRaw(d, model)
        break
    }
    } catch (e) {
      return {
        isError: true,
        content: [
          { type: "text", text: `格式化失败: ${(e as Error).message}` },
        ],
      }
    }
    return { content: [{ type: "text", text }] }
  }
)
```

同时把 import 里补上 `formatDetail`,并**删掉 Task 4 Step 2 加的那组 `export { formatAnnouncements, ... } from "./format.ts"` 过渡再导出**(测试已直接从 `format.ts` 导入,不再需要)。类型再导出(`export type { Model, Pricing }`、`export type { Announcement, Announcements }`)保留 —— 它们描述的是 fetch 的返回形状,属于本模块的公开契约。

- [ ] **Step 6: 全量验证**

```bash
pnpm prettier --write plugins/packyapi/scripts/*.ts tests/plugins/packyapi/*.ts
pnpm check
```

预期:typecheck 通过、lint 无新增错误、全部测试绿。

> 注:`pnpm lint` 在本仓库有**存量**告警(与本次改动无关)。只需确认没有新增来自 `plugins/packyapi/**` 或 `tests/plugins/packyapi/**` 的报错。

- [ ] **Step 7: 提交**

```bash
git add plugins/packyapi/scripts/ tests/plugins/packyapi/
git commit -m "$(cat <<'EOF'
feat(packyapi): 新增 detail action,出单模型全量计价

price 表要保持精简,但缓存写入价、长上下文阶梯、高峰状态、端点路径、厂商
这些信息又确实要能查到。拆一个 detail action 承接:给 model 就出该模型在
各可用分组下的完整计价,给 group 则锁单组。price 表因此维持原有列数。

同时把 vendor 参数接进 models,并给 detail/raw 缺 model 参数时的错误提示
指向 action=models。
EOF
)"
```

---

### Task 8: 刷新文档与插件版本

**Files:**
- Rewrite: `plugins/packyapi/skills/packyapi/references/pricing-api.md`
- Rewrite: `plugins/packyapi/skills/packyapi/references/docs-map.md`
- Modify: `plugins/packyapi/skills/packyapi/SKILL.md`
- Modify: `plugins/packyapi/README.md`
- Modify: `plugins/packyapi/.claude-plugin/plugin.json`

- [ ] **Step 1: 重写 `pricing-api.md`**

整份替换。关键决策:**删掉分组倍率表** —— 它是本次文档失准的根因,而且官方文档页 `docs/token/2-group.html` 本身也滞后于 API(其目录里仍列着实盘已消失的 `CC-expensive`/`claude-sale`),所以任何静态副本都会过时。

```markdown
# PackyAPI 计价 API 参考

## 端点

`GET https://www.packyapi.ai/api/pricing` — 公开,无需 auth,返回 JSON。
`GET https://www.packyapi.ai/api/announcements` — 公开,平台公告。

`/api/models` 需鉴权(匿名返回 `401 未登录`),故模型与价格一律走 `/api/pricing`。

## 顶层字段

| 字段 | 说明 |
|---|---|
| `data[]` | 模型列表(见下) |
| `group_ratio` | 分组倍率 map |
| `usable_group` | 分组中文说明 |
| `model_group_ratio` | **分组级 `model_ratio` 覆盖**,形如 `{组: {模型: 倍率}}`。命中时压过 `data[].model_ratio` |
| `model_group_endpoints` | 分组级 `supported_endpoint_types` 覆盖,形如 `{组: {模型: [端点]}}` |
| `peak_pricing` | 高峰浮动价规则:`{enabled, rules:[{enabled, timezone, windows, weekdays, models, factor}]}` |
| `peak_active` | 服务端下发的当前生效高峰状态(语义无官方文档,实测常为 `{}`) |
| `inactive_groups` | 已停用的分组名 |
| `supported_endpoint` | 协议 → `{path, method, extra_paths?}` |
| `vendors` | `[{id, name, icon}]`,与 `data[].vendor_id` 关联 |
| `auto_groups` | 默认组 |
| `success` | 请求状态 |

## `data[]` 每模型字段

| 字段 | 说明 |
|---|---|
| `model_name` | 模型 ID(填 `ANTHROPIC_MODEL` 等) |
| `quota_type` | 0=按量(token),1=按次(固定价) |
| `model_ratio` | 全局输入倍率;**可被 `model_group_ratio` 按组覆盖** |
| `completion_ratio` | 输出/输入 倍数 |
| `cache_ratio` | 缓存**读取**/输入 倍数。**仅 57/67 个模型有** —— 缺失时不存在缓存读价,不要当 0 或直接做乘法(会得到 NaN) |
| `cache_creation_ratio_5m` | 缓存**写入**/输入 倍数(仅部分模型有,claude 系为 1.25) |
| `tiers` | 长上下文阶梯价 `[{threshold, ratio, output_ratio?}]`,超过 `threshold` tokens 后倍率变化;`output_ratio` 缺省则回落 `ratio` |
| `model_price` | 按次单价(`quota_type=1` 时用) |
| `model_price_min` / `model_price_max` | 按次价格区间(图片类模型) |
| `image_ratio` | 图片计价倍率 |
| `vendor_id` | 关联 `vendors` |
| `enable_groups` | 该模型可用的分组 |
| `supported_endpoint_types` | 端点类型;**可被 `model_group_endpoints` 按组覆盖** |
| `owner_by` | 实测全为空串,可忽略 |

## 计价顺序(顺序即正确性)

设 `base = 2`(= $0.002/1K tokens,new-api 默认单位):

1. `ratio = model_group_ratio[组][模型] ?? model_ratio` ← 漏这步会算错,某些组差 8 倍
2. `gr = group_ratio[组] ?? 1`
3. 按量(`quota_type=0`,$/1M tokens):
   ```
   input      = ratio * gr * base
   output     = input * completion_ratio
   cacheRead  = input * cache_ratio
   cacheWrite = input * cache_creation_ratio_5m   (字段缺失则无此价)
   ```
4. 高峰浮动:命中 `peak_pricing` 规则的时间窗口时,上述 token 价整体 `× factor`。
   窗口按 `timezone` 判定,左闭右开(`12:00` 整已不在 `09:00-12:00` 内)。
   `peak_active` 含该模型时以它为权威。
5. 阶梯价:`tiers` 以第 4 步之后的价为基准换算
   (`input × ratio`,`output × (output_ratio ?? ratio)`)。
6. 按次(`quota_type=1`):`perCall = model_price * gr`,`min`/`max` 同乘 `gr`。

## 分组倍率与「孤儿组」

**不要在此处静态记录倍率** —— 分组会增删、倍率会变,官方文档页 `docs/token/2-group.html`
本身也滞后于 API。实时值一律用 `packy` 工具的 `action=groups`。

另需注意:`data[].enable_groups` 引用的组名 **多于** `group_ratio` 定义的组。
2026-09-06 实测 `enable_groups` 出现 21 个组,而 `group_ratio` / `usable_group` 各只有 18 个 ——
`hongjing`(6 个模型)、`test`(2 个)、`default`(1 个)三个组倍率无处可查。
这类「孤儿组」的报价只能按倍率 1 估算,`packy` 的 `price` / `detail` 会用 `§` 标记并加脚注说明。
不要把这类估算价当作平台的正式报价。
```

- [ ] **Step 2: 重建 `docs-map.md`**

整份替换。改动:删 2 条已死链(`cli/4-gemini.html`、`ccswitch/4-gemini.html`,sitemap 均已无);补 12 个新页;文末删掉不存在的 `/packy-price`、`/packy-models` 斜杠命令,改指 `packy` 工具。

```markdown
# PackyAPI 官方文档地图(sitemap 定位)

站点:`https://docs.packyapi.ai`(VuePress,无 llms.txt)。按主题定位到**单个** URL 后再 WebFetch。
刷新全量列表:`curl -s https://docs.packyapi.ai/sitemap.xml | grep -oE '<loc>[^<]+'`

> 本表核对于 2026-09-06。Gemini 的 CLI 配置页与 CC-Switch 页已下线,只剩 FAQ。

## 注册 / 入门 `docs/register/`
| 主题 | URL |
|---|---|
| 注册 | `/docs/register/1-register.html` |
| 登录 | `/docs/register/2-login.html` |
| 充值额度 | `/docs/register/3-quota.html` |
| 创建令牌 token | `/docs/register/4-token.html` |
| **环境变量配置** | `/docs/register/5-env.html` |
| CLI 接入 | `/docs/register/6-cli.html` |

## CLI 配置 `docs/cli/`(接 Claude/Codex 首选看这里)
| 主题 | URL |
|---|---|
| 环境检查(通用步骤) | `/docs/cli/1-env.html` |
| **Claude Code** | `/docs/cli/2-claude.html` |
| Codex | `/docs/cli/3-codex.html` |
| 缓存修复 | `/docs/cli/5-cache-fix.html` |
| Grok Build | `/docs/cli/6-grok-build.html` |
| Kimi Code | `/docs/cli/7-kimi-code.html` |

## CC-Switch 工具 `docs/ccswitch/`
通用 `/1-common.html` · Claude `/2-claude.html` · Codex `/3-codex.html` ·
Claude Desktop `/4-claude-desktop.html` · 用量查询 `/4-usage-query.html` ·
CLI `/5-ccs_cli.html` · Codex App `/6-codex-app.html`

## 令牌与分组 `docs/token/`
简介 `/docs/token/1-intro.html` · 分组说明 `/docs/token/2-group.html`

> 分组页的倍率会滞后于 API。要准确值用 `packy` 工具 `{ "action": "groups" }`。

## 常见问题 `docs/faq/`
Claude Code `/docs/faq/CC.html` · Codex `/docs/faq/Codex.html` ·
Gemini `/docs/faq/Gemini.html` · Grok Build `/docs/faq/GrokBuild.html`

## 进阶接入 `docs/advanced/`
AionUI · AllApiHub · ChatGPTClaudeCode · ClaudeDesktop · DeepSeekClaudeCode ·
DeepSeekCodex · Hermes · OpenClaw · OpenCode · WorkBuddy
(URL 形如 `/docs/advanced/<名>.html`)

## 绘图 `docs/paint/`
Banana `/docs/paint/Banana.html` · GPTImage `/docs/paint/GPTImage.html`

## 其它
监控 `/docs/Monitor.html` · 服务条款 `/docs/tos/TOS.html` ·
AUP `/docs/tos/aup.html` · 使用条款 `/docs/tos/use.html` ·
专项条款 `/docs/tos/service-specific-terms.html`

---
**定价/模型不要查文档** —— 用 `packy` 工具(实时 JSON API,更准更省)。
```

- [ ] **Step 3: 更新 `SKILL.md`**

三处改动。

一、把工具表整块替换为:

```markdown
| action | 参数 | 作用 |
|---|---|---|
| `price` | `keyword?` `group?` `base?` | 计价表($/1M tokens);给 `keyword` 自动列该模型全部可用分组,`group` 锁单组。已计入分组倍率覆盖与高峰浮动价 |
| `detail` | `model`(必填) `group?` `base?` | 单模型全量计价:各分组实价、缓存读/写、长上下文阶梯、高峰状态、端点路径、厂商 |
| `models` | `group?` `endpoint?` `vendor?` | 列可用模型 ID,可按端点或厂商过滤 |
| `groups` | — | 分组倍率与说明(实时,含 `[停用]` 标记) |
| `raw` | `model`(必填) | 单模型原始 JSON |
| `announcements` | `limit?` `keyword?` | 平台公告(上新/变更/通知),默认最近 5 条,按发布时间降序 |

`price` 输出里模型名后的标记:`†` 该组有专属倍率(已覆盖全局)、`*` 当前处于高峰浮动价、
`‡` 有长上下文阶梯价。表尾脚注给出具体数值。
```

示例调用参数那段追加两行:

```markdown
- 单模型全量计价:`{ "action": "detail", "model": "claude-opus-5" }`
- 列 Anthropic 厂商模型:`{ "action": "models", "vendor": "Anthropic" }`
```

二、配置段替换为(已于 2026-09-06 用 WebFetch 核实官方 `docs/cli/2-claude.html`):

```markdown
## 配置 Claude Agent SDK / Claude Code(走 PackyAPI)

```
ANTHROPIC_BASE_URL=https://cf.api.fan
ANTHROPIC_AUTH_TOKEN=<在「令牌管理」建的 token,选 cc 组>
```

官方文档 `docs/cli/2-claude.html` 写明中转站地址固定为 `https://cf.api.fan`,不带 `/v1`。
SDK/CLI 原生读这两个 env → 无需改代码。模型 ID 用 `packy` 工具
`{ "action": "models", "endpoint": "anthropic" }` 查最新。

`slb-v1.api.fan` 曾作为直连端点,当前官方文档已不再提及 —— 仅作备用,可用性自行验证。
主站域名 `www.packyapi.ai` 仅供网页访问,不要作为 base_url。

端点协议与路径(取自 `/api/pricing` 的 `supported_endpoint`):

| 协议 | 路径 |
|---|---|
| `anthropic` | `POST /v1/messages` |
| `openai` | `POST /v1/chat/completions` |
| `openai-response` | `POST /v1/responses` |
| `gemini` | `POST /v1beta/models/{model}:generateContent` |
| `image-generation` | `POST /v1/images/generations`(另有 `/v1/images/edits`) |

OpenAI 协议场景(Codex 等)base_url 末尾需带 `/v1`,即 `https://cf.api.fan/v1`。
```

三、「铁律」那段把「价格 / 模型 / 分组」一行改为:

```markdown
- 价格 / 模型 / 分组 / 端点路径 → 一律用 MCP 工具 `packy`,底层读公开 JSON `https://www.packyapi.ai/api/pricing`。
  连官方文档的分组页都滞后于 API,别去那儿查倍率。
```

- [ ] **Step 4: 更新 `README.md` 的 action 表**

替换为:

```markdown
| action | 参数 | 作用 |
|---|---|---|
| `price` | `keyword?` `group?` `base?` | 计价($/1M tokens),含分组倍率覆盖与高峰浮动价 |
| `detail` | `model` `group?` `base?` | 单模型全量计价(缓存读/写、阶梯价、高峰、端点、厂商) |
| `models` | `group?` `endpoint?` `vendor?` | 列可用模型 ID |
| `groups` | — | 分组倍率与说明 |
| `raw` | `model` | 单模型原始 JSON |
| `announcements` | `limit?` `keyword?` | 平台公告 |
```

- [ ] **Step 5: 提版本**

`plugins/packyapi/.claude-plugin/plugin.json`:

```json
{
  "name": "packyapi",
  "version": "1.3.0",
  "description": "查询 PackyAPI 模型价格、可用模型、平台公告与文档,MCP server 走公开 JSON API,本地计价(含分组倍率覆盖、高峰浮动价、长上下文阶梯价),省 token、高精确",
  "author": { "name": "prayer" },
  "skills": "./skills",
  "mcpServers": {
    "packyapi": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/packy-mcp.ts"]
    }
  }
}
```

MCP server 的 `version` 由 `pluginVersion()` 读这个文件得来,不用手改。

- [ ] **Step 6: 核对文档里没有被写成本机绝对路径的 URL**

`~/docs/...` 这类以波浪号开头的相对写法在某些工具链里会被展开成 `/Users/<你>/...`。落盘后确认文档里没有本机路径,且 Claude Code 那行是 `/docs/cli/2-claude.html`:

```bash
grep -rn '/Users/' plugins/packyapi/skills/ plugins/packyapi/README.md
grep -n '2-claude' plugins/packyapi/skills/packyapi/references/docs-map.md
```

预期:第一条命令**无输出**;第二条输出两行 —— CLI 配置表的 `` `/docs/cli/2-claude.html` `` 与 CC-Switch 段的 `` `/2-claude.html` ``。

- [ ] **Step 7: 提交**

```bash
git add plugins/packyapi/
git commit -m "$(cat <<'EOF'
docs(packyapi): 按实盘刷新 reference 与 skill,提版本至 1.3.0

pricing-api.md 删掉分组倍率表 —— 它是本次文档失准的根因:deepseek-officially
由 0.25 变 1,cc-expensive 与 claude-sale 已从实盘消失,新增 12 个组未列。
官方文档页 docs/token/2-group.html 本身也滞后于 API(目录里仍列着已消失的
两个组),所以任何静态副本都会过时,一律指向 action=groups。同时补全 12 个
顶层字段、15 个 data[] 字段与含四层叠加的完整计价顺序。

docs-map.md 按 sitemap 重建:删 2 条死链(cli/4-gemini、ccswitch/4-gemini,
Gemini 的配置页已下线只剩 FAQ),补 12 个新页,文末改指 packy 工具
(原先指向的 /packy-price、/packy-models 斜杠命令并不存在)。

SKILL.md 的 base_url 已用 WebFetch 核实官方 docs/cli/2-claude.html:固定为
https://cf.api.fan 不带 /v1;slb-v1.api.fan 官方已不再提及,由「直连推荐」
降级为备用。另补 supported_endpoint 的 5 条协议路径。
EOF
)"
```

---

### Task 9: 实盘冒烟与收尾验证

前八个 Task 都在 mock 数据上验证。这一步用真实 API 确认修正确实生效。

**Files:** 无(只读验证)

- [ ] **Step 1: 确认 Node 能直跑拆分后的插件**

```bash
node --input-type=module -e '
const m = await import("./plugins/packyapi/scripts/format.ts")
console.log("format 导出:", Object.keys(m).sort().join(", "))
'
```

预期:输出含 `formatAnnouncements, formatDetail, formatGroups, formatModels, formatPrice, formatRaw`。这验证了 strip-types 下跨文件 `.ts` import 在真实 Node 里可用 —— vitest 走的是自己的解析器,不能替代这一步。

- [ ] **Step 2: 用实盘数据抽查修正后的报价**

```bash
node --input-type=module -e '
const { formatPrice, formatDetail } = await import("./plugins/packyapi/scripts/format.ts")
const d = await (await fetch("https://www.packyapi.ai/api/pricing", {
  headers: { "User-Agent": "packy-mcp" },
})).json()
console.log("=== glm-5.2 各组(升级前 glm-sale 报 $8.00)===")
console.log(formatPrice(d, { keyword: "glm-5.2" }))
console.log()
console.log("=== deepseek-v4-pro detail ===")
console.log(formatDetail(d, { model: "deepseek-v4-pro" }))
'
```

再加一段全量扫描,确认整个实盘数据集上没有 `NaN` 漏网:

```bash
cat > /tmp/t9-scan.mjs <<'SCRIPT'
import { readFileSync } from "node:fs"
const { formatPrice, formatDetail } = await import(
  "/Users/ziyou/projects/prayer/plugins/packyapi/scripts/format.ts"
)
const d = JSON.parse(readFileSync("/tmp/packy.json", "utf8"))
const groups = [...new Set(d.data.flatMap((m) => m.enable_groups))]
let bad = 0
for (const g of groups) {
  const out = formatPrice(d, { group: g })
  if (out.includes("NaN")) {
    bad++
    console.log("NaN in group:", g)
  }
}
for (const m of d.data) {
  if (formatDetail(d, { model: m.model_name }).includes("NaN")) {
    bad++
    console.log("NaN in detail:", m.model_name)
  }
}
console.log(`扫描 ${groups.length} 个组 + ${d.data.length} 个模型 detail,含 NaN 的:${bad}(应为 0)`)
console.log("\n=== gemini-slb 组(升级前 7 行里 5 行是 $NaN)===")
console.log(formatPrice(d, { group: "gemini-slb" }))
console.log("\n=== 孤儿组 hongjing ===")
console.log(formatPrice(d, { group: "hongjing" }))
SCRIPT
node /tmp/t9-scan.mjs
```

预期:
- `glm-5.2` 在 `glm-sale` 组一行为 `glm-5.2†` 且 in 为 `$1.00`(不是 `$8.00`);`zai-officially` 组为 `$1.80`;脚注出现 `model_group_ratio`。
- 全量扫描 `含 NaN 的:0`;`gemini-slb` 组的 cache 列是 `-` 而非 `$NaN`。
- `hongjing` 组每行带 `§`,脚注出现「倍率无定义」,且不报「未知分组」。
- `deepseek-v4-pro` 的 detail 在工作日 09:00-12:00 或 14:00-18:00(北京时间)运行时出「高峰中 ×2」行与平时价;其它时段无高峰行。**两种结果都算通过** —— 记下运行时刻与看到的分支。

把你看到的真实输出写进报告,尤其是那个 `含 NaN 的:N` 的实际数字。

- [ ] **Step 3: stdio 冒烟,确认 MCP server 起得来且 detail 工具已注册**

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node plugins/packyapi/scripts/packy-mcp.ts 2>&1 | head -5
```

预期:第一行响应含 `"serverInfo":{"name":"packyapi","version":"1.3.0"}`(版本号证明 `pluginVersion()` 读到了新的 `plugin.json`);`tools/list` 的响应里 `action` 的 enum 含 `detail`,且参数含 `vendor`。

- [ ] **Step 4: 三件套**

```bash
pnpm check
```

预期:typecheck 通过;lint 无**新增**错误(存量告警与本次改动无关,逐条确认报错文件不在 `plugins/packyapi/**` 与 `tests/plugins/packyapi/**`);全部测试绿。

记下最终测试数:`pricing.test.ts` 48 个 + `format.test.ts` 45 个 = 93 个,加上仓库其余用例。

- [ ] **Step 5: 确认没有遗留文件**

```bash
git status --short
ls tests/plugins/packyapi/
```

预期:工作区干净;`tests/plugins/packyapi/` 下只有 `fixture.ts`、`format.test.ts`、`pricing.test.ts` —— 旧的 `packy-mcp.test.ts` 应已被 `git mv` 掉。

- [ ] **Step 6: 如有未提交改动则提交**

若前几步做了修补:

```bash
pnpm prettier --write plugins/packyapi/scripts/*.ts tests/plugins/packyapi/*.ts
git add -A
git commit -m "test(packyapi): 实盘冒烟后的收尾修补"
```

若工作区已干净则跳过。

---

## 验收清单

- [ ] `pnpm check` 全绿,`plugins/packyapi/**` 与 `tests/plugins/packyapi/**` 无新增 lint 报错
- [ ] `glm-5.2` 在 `glm-sale` 组实盘报 `$1.00/1M`(升级前 `$8.00`)
- [ ] 实盘全量扫描(21 个组的 `price` + 67 个模型的 `detail`)输出中 **`NaN` 出现 0 次**;`gemini-slb` 组 cache 列为 `-`
- [ ] 孤儿组(`hongjing` / `test` / `default`)报价带 `§` 标记与「倍率无定义」脚注,且不被误报为「未知分组」
- [ ] `packy(action=detail, model=glm-5.2, group=cc)` 这类「模型不在该组」的查询不出价,而是提示可用分组(实盘该类组合 1306 个)
- [ ] `deepseek-v4-pro` 在高峰窗口内报价为平时价 2 倍并带脚注,窗口外不加价
- [ ] `packy-mcp.ts` 能被 Node 直跑,`tools/list` 返回的 server version 为 `1.3.0`,action enum 含 `detail`
- [ ] `price` 表格列数与升级前一致(默认精简未被破坏)
- [ ] `pricing-api.md` 内不再有静态分组倍率表,且标注了 `cache_ratio` 的可选性与孤儿组
- [ ] `docs-map.md` 内无 `cli/4-gemini.html` 与 `ccswitch/4-gemini.html`

## 明确不做(记录在案,避免被当成遗漏)

- **不在 API 边界做 schema 校验。** `packy-mcp.ts` 的 `(await res.json()) as Pricing` 是无校验强转,理想解法是用仓库已有的 `zod` 在边界校验一次,而不是在下游到处补 `?.`。但这会把一个 67 模型、12 个顶层字段的外部载荷全部建模,范围远超本次「修报价 + 补字段 + 刷文档」。本次改为:把实测得到的字段可选性如实写进 `Model` / `Pricing` 类型(见 Task 1),让 `tsc` 在下游强制处理缺失分支 —— 这已经能挡住本次发现的 `NaN` 一类问题。校验留作独立任务。
- **不接 `owner_by`。** 实盘 67/67 存在但值全为空字符串,`formatRaw` 走 `JSON.stringify` 原样输出,不影响任何断言。
