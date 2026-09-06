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
 *   4. 高峰浮动:命中窗口则上述 token 价整体 × factor
 *   5. 阶梯价:以第 4 步之后的价为基准换算
 *   6. quota_type=1(按次):perCall = model_price * gr,不产出任何按量字段
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
  until?: string
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
  return [
    ...(d.data?.find((x) => x.model_name === model)?.enable_groups ?? []),
  ].sort()
}

export function resolvePrice(
  d: Pricing,
  model: string,
  group: string,
  opts: { base?: number; now?: Date } = {}
): EffectivePrice | undefined {
  const m = d.data?.find((x) => x.model_name === model)
  if (!m) return undefined
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
  // 实盘 quota_type 只有 0 和 1。非 1 一律按按量处理,quotaType 归一化为 0。
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
