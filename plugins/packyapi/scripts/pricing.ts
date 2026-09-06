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
 *   4. 高峰浮动:命中窗口则上述 token 价整体 × factor(含 cacheRead/cacheWrite ——
 *      缓存价同步参与高峰浮动是我方推断,无官方文档,实盘暂无样本可验证)
 *   5. 阶梯价:以第 4 步之后的价为基准换算
 *   6. quota_type=1(按次):perCall = model_price * gr,不产出任何按量字段,
 *      高峰浮动不作用于按次计价(peak_pricing 的 rules 目前只点名按量模型)
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
  return [
    ...(d.data?.find((x) => x.model_name === model)?.enable_groups ?? []),
  ].sort()
}

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
function zoned(
  now: Date,
  timeZone: string
): { weekday: number; minutes: number } {
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
    // 这里 fail-closed:当作不命中。weekday 0 匹配不上任何 weekdays,
    // minutes NaN 也让 hitWindow 的比较恒假,双重保险。
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
}
