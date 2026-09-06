/**
 * PackyAPI 定价解析器 —— 纯函数,不触网、不格式化。
 *
 * 唯一入口 resolvePrice(模型 × 分组 × 时刻 → 实价)。抽出来的原因:
 * 计价规则有四层叠加(分组倍率覆盖 → 高峰浮动 → 阶梯价 → 按次区间),
 * 内联在格式化函数里既无法单测数值,也压不住复杂度。
 *
 * 计价顺序(顺序即正确性,勿调换):
 *   1. ratio = model_group_ratio[组][模型] ?? model_ratio   ← 分组级覆盖
 *   2. gr    = group_ratio[组] ?? 1
 *   3. input = ratio * gr * base(base 默认 2,即 $0.002/1K)
 *      output = input * completion_ratio
 *      cacheRead  = input * cache_ratio
 *      cacheWrite = input * cache_creation_ratio_5m(字段缺失则无此价)
 *   4. 高峰浮动:命中窗口则上述 token 价整体 × factor
 *   5. 阶梯价:以第 4 步之后的价为基准换算
 *   6. quota_type=1(按次):perCall = model_price * gr,按量字段全部为空
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
  cache_ratio: number
  model_price: number
  enable_groups: string[]
  supported_endpoint_types: string[]
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
  until?: string
  offPeakInput: number
  offPeakOutput: number
}

export interface EffectivePrice {
  model: string
  group: string
  quotaType: number
  base: number
  /** quota_type=0(按量),单位 $/1M tokens */
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  /** quota_type=1(按次) */
  perCall?: number
  perCallMin?: number
  perCallMax?: number
  ratioSource: "global" | "group-override"
  peak?: PeakState
  tiers?: TierPrice[]
  endpoints: string[]
  vendor?: string
}

export function resolveGroups(d: Pricing, model: string): string[] {
  return d.data?.find((x) => x.model_name === model)?.enable_groups ?? []
}

export function resolvePrice(
  d: Pricing,
  model: string,
  group: string,
  opts: { base?: number; now?: Date } = {}
): EffectivePrice | undefined {
  const m = d.data?.find((x) => x.model_name === model)
  if (!m) return undefined
  const base = opts.base ?? DEFAULT_BASE
  const gr = d.group_ratio?.[group] ?? 1
  const override = d.model_group_ratio?.[group]?.[model]
  const ratio = override ?? m.model_ratio
  const common = {
    model,
    group,
    quotaType: m.quota_type,
    base,
    ratioSource:
      override === undefined
        ? ("global" as const)
        : ("group-override" as const),
    endpoints:
      d.model_group_endpoints?.[group]?.[model] ??
      m.supported_endpoint_types ??
      [],
    vendor: d.vendors?.find((v) => v.id === m.vendor_id)?.name,
  }
  if (m.quota_type === 1) {
    return { ...common, perCall: m.model_price * gr }
  }
  const input = ratio * gr * base
  return {
    ...common,
    input,
    output: input * m.completion_ratio,
    cacheRead: input * m.cache_ratio,
    cacheWrite:
      m.cache_creation_ratio_5m === undefined
        ? undefined
        : input * m.cache_creation_ratio_5m,
  }
}
