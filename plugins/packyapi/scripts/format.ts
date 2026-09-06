/**
 * PackyAPI 输出层 —— 全部 format* 函数,把 pricing.ts 解析出的价格与
 * 原始数据渲染成极简结构化文本。只依赖 pricing.ts,不触网、不引 MCP SDK。
 *
 * 依赖方向单向:packy-mcp.ts → format.ts → pricing.ts。
 * 公告类型放这里而非 packy-mcp.ts:formatAnnouncements 是其唯一的结构化
 * 消费方,放这里可避免两个模块互相 import。
 */
import {
  DEFAULT_BASE,
  resolvePrice,
  type EffectivePrice,
  type Pricing,
} from "./pricing.ts"

export interface Announcement {
  id: number
  category: string
  type: string
  title: string
  title_en: string
  content: string
  content_en: string
  publishDate: string
}

export interface Announcements {
  data: Announcement[]
}

function grValue(d: Pricing, group: string): number {
  return d.group_ratio?.[group] ?? 1
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function padStart(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s
}

// —— 纯格式化函数:输入 Pricing + 参数,返回结构化文本(便于单测,不触网) ——

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
  // 阶梯是「整段重定价」而非「仅超出部分加价」—— 单次请求的**输入** token 超过
  // threshold 时,整个请求按该档单价结算,阈值处价格跳变(271999 与 272001 差一倍)。
  // 依据:实盘 5 个 gpt-5.x 的 {272000, 2, 1.5} 与 OpenAI 公开规则逐字吻合;
  // grok-4.5 的 200000/2x 与 Grok 公开规则一致;阿里云对 qwen 系明写「该请求的
  // 所有 Token 均按对应阶梯的单价结算」。「阶梯」二字最易被误读成累进,故写全。
  const tiers = p.tiers ?? []
  for (const t of tiers) {
    notes.push(
      `‡ ${p.model} 长上下文:单次请求输入超 ${t.threshold} tokens 时整个请求按 in $${t.input.toFixed(2)} / out $${t.output.toFixed(2)} 计价(非仅超出部分)`
    )
  }
  if (tiers.length > 1) {
    notes.push(`‡ ${p.model} 多档只取命中的最高一档,不累加`)
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
    // 去重后再按字符串排序:notes 是在 rows 排序之前、按 enable_groups 原始
    // 顺序 push 的,若不重新排序,同一模型多组倍率相同时(如 glm-5.2 在
    // glm-sale/zai-officially 下 gr 都是 1)反转 enable_groups 会让脚注顺序
    // 跟着变,即使表格行序本身已经靠第三级 tie-break 稳定住——「输出不依赖
    // 输入顺序」的承诺就只对表格成立、对脚注不成立了。
    out.push(...[...new Set(notes)].sort())
  }
  return out.join("\n")
}

export function formatModels(
  d: Pricing,
  opts: { group?: string; endpoint?: string } = {}
): string {
  const group = opts.group ?? "cc"
  const endpoint = opts.endpoint
  const names: string[] = []
  for (const m of d.data) {
    if (!m.enable_groups?.includes(group)) continue
    if (endpoint && !m.supported_endpoint_types?.includes(endpoint)) continue
    names.push(m.model_name)
  }
  const out: string[] = [
    `# group=${group}${endpoint ? ` endpoint=${endpoint}` : ""} — ${names.length} 个模型`,
  ]
  for (const n of names.sort((a, b) => a.localeCompare(b))) out.push(n)
  return out.join("\n")
}

export function formatGroups(d: Pricing): string {
  const gr = d.group_ratio ?? {}
  const desc = d.usable_group ?? {}
  const out: string[] = ["# 分组倍率(group_ratio)与说明"]
  for (const g of Object.keys(gr).sort((a, b) => gr[a] - gr[b])) {
    out.push(
      `${pad(g, 22)} x${pad(String(gr[g]), 5)} ${(desc[g] ?? "").trim()}`
    )
  }
  return out.join("\n")
}

export function formatRaw(d: Pricing, model?: string): string {
  if (!model) return "raw 需 model 参数"
  const m = d.data.find((x) => x.model_name === model)
  if (!m) return `未找到模型: ${model}`
  return JSON.stringify(m, null, 2)
}

export function formatAnnouncements(
  d: Announcements,
  opts: { keyword?: string; limit?: number } = {}
): string {
  const limit = opts.limit ?? 5
  const kw = (opts.keyword ?? "").toLowerCase()
  let list = [...(d.data ?? [])]
  if (kw) {
    list = list.filter(
      (a) =>
        a.title?.toLowerCase().includes(kw) ||
        a.content?.toLowerCase().includes(kw)
    )
  }
  // 按发布时间降序,取最近 limit 条
  list.sort((a, b) => (b.publishDate ?? "").localeCompare(a.publishDate ?? ""))
  const shown = list.slice(0, limit)
  if (shown.length === 0) {
    return `无公告(关键词=${kw || "无"})`
  }
  const out: string[] = [
    `# PackyAPI 公告 — 共 ${list.length} 条,列最近 ${shown.length} 条`,
  ]
  for (const a of shown) {
    const date = (a.publishDate ?? "").slice(0, 10)
    out.push("")
    out.push(`[${a.id}] ${a.title}  (${a.category}${date ? `, ${date}` : ""})`)
    out.push((a.content ?? "").trim())
  }
  return out.join("\n")
}
