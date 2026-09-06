# packyapi 插件升级设计(修正报价 + 补全字段 + 刷新文档)

日期:2026-09-06
分支:`feat/packyapi-upgrade`
版本:plugin `1.2.2` → `1.3.0`

## 目标

`packyapi` 插件当前对部分模型**报价错误**,且忽略了实盘 `/api/pricing` 里近半数计价相关字段,附带的两份 reference 文档已与线上脱节。本次升级:

1. 修正报价 —— 接入 `model_group_ratio`(分组级倍率覆盖)与 `peak_pricing`(高峰浮动价)。
2. 补全字段 —— `tiers`、`cache_creation_ratio_5m`、`vendors`/`vendor_id`、`model_group_endpoints`、`model_price_min/max`、`image_ratio`、`inactive_groups`、`supported_endpoint`。
3. 刷新文档 —— `docs-map.md` 按实测 sitemap 重建,`pricing-api.md` 删除会过时的实时数据副本,`SKILL.md` 配置指引按官方文档核实。

约束:插件卖点是省 token,`price` 常见问答的输出长度不得明显上涨 —— 新信息**默认精简、按需展开**。

## 背景 / 现状

`plugins/packyapi/scripts/packy-mcp.ts`(368 行,单文件)暴露单工具 `packy(action, ...)`,action 为 `price` / `models` / `groups` / `raw` / `announcements`。计价在 `formatPrice` 内联,公式:

```
input  $/1M = model_ratio * group_ratio * base   (base 默认 2)
output $/1M = input * completion_ratio
cache  $/1M = input * cache_ratio
quota_type=1: price/次 = model_price * group_ratio
```

### 2026-09-06 实盘核对(`GET https://www.packyapi.ai/api/pricing`,67 模型)

顶层字段实际为 12 个,插件只读 3 个(`data` / `group_ratio` / `usable_group`):

| 字段 | 插件是否读 | 实盘值要点 |
|---|---|---|
| `model_group_ratio` | ✗ | 分组级 `model_ratio` 覆盖,覆盖 `deepseek-officially`(3 模型)、`glm-sale`(3)、`zai-officially`(5) |
| `peak_pricing` | ✗ | `enabled:true`,规则:`Asia/Shanghai` 周一至五 `09:00-12:00`/`14:00-18:00`,deepseek 三模型 `factor:2` |
| `peak_active` | ✗ | 实盘 `{}`,字段语义无文档 |
| `model_group_endpoints` | ✗ | 分组级 `supported_endpoint_types` 覆盖 |
| `inactive_groups` | ✗ | 实盘 `[]` |
| `supported_endpoint` | ✗ | 协议 → `{path, method}`,5 条:`anthropic`/`openai`/`openai-response`/`gemini`/`image-generation` |
| `vendors` | ✗ | 13 条 `{id, name, icon}` |
| `auto_groups` | ✗ | `["cc"]` |
| `success` | ✗ | `true` |

`data[]` 每模型字段实际 15 个,插件只读 8 个。未读的:

| 字段 | 覆盖 | 含义 |
|---|---|---|
| `tiers` | 17/67 | 长上下文阶梯价,`{threshold, ratio, output_ratio?}` |
| `cache_creation_ratio_5m` | 15/67 | 缓存**写入**倍率(claude 系为 `1.25`) |
| `vendor_id` | 67/67 | 关联 `vendors` |
| `model_price_min` / `model_price_max` | 2/67 | 按次计价的价格区间 |
| `image_ratio` | 1/67 | 图片计价倍率 |
| `owner_by` | 67/67 | 实盘全为空串,**不接入** |

### 报价错误的具体量级

`glm-5.2` 全局 `model_ratio=4`,但 `model_group_ratio["glm-sale"]["glm-5.2"]=0.5`。`glm-sale` 组 `group_ratio=1`,`base=2`:

- 插件当前报 `in = 4 * 1 * 2 = $8.00/1M`
- 实价 `in = 0.5 * 1 * 2 = $1.00/1M`
- **8 倍高估**

`cc` 组不在 `model_group_ratio` 内,故 claude code 主链路报价仍准 —— 这是问题此前未被发现的原因。

### 文档脱节

- sitemap 实测新增 12 页未收录:`cli/6-grok-build`、`cli/7-kimi-code`、`ccswitch/4-usage-query`、`ccswitch/4-claude-desktop`、`ccswitch/6-codex-app`、`advanced/AllApiHub`、`advanced/DeepSeekCodex`、`advanced/WorkBuddy`、`faq/GrokBuild`、`tos/aup`、`tos/use`、`tos/service-specific-terms`。
- 已死链 2 条:`cli/4-gemini.html` 与 `ccswitch/4-gemini.html`,sitemap 均已无 —— Gemini 的 CLI 配置与 CC-Switch 页面已下线(`faq/Gemini.html` 仍在)。
- 文末指向不存在的 `/packy-price`、`/packy-models` 斜杠命令。
- `pricing-api.md` 的分组倍率表全面失准:`deepseek-officially` 由 `0.25` 变 `1`;`cc-expensive`、`claude-sale` 已从实盘消失;实盘新增 12 组未列。同文档称 `peak_pricing` 为 `enabled:false`,实盘已 `true`。
- 官方文档页 `docs/token/2-group.html` 的目录中**仍列着实盘已消失的 `CC-expensive` / `claude-sale`** —— 官方文档本身也滞后于 API。故**分组数据的唯一真源是 `/api/pricing`**,任何静态副本都会过时。
- 官方 `docs/cli/2-claude.html` 明确写「中转站地址,固定为 `https://cf.api.fan`」(不带 `/v1`),且**当前已不再提及 `slb-v1.api.fan`**,而 `SKILL.md` 仍将其列为「直连推荐」。

## 决策(已确认)

1. **范围**:三项全做(修价 + 补字段 + 刷文档)。
2. **输出策略**:默认精简,新信息按需展开 —— `price` 表格列不变,命中特殊计价的行加后缀标记 + 表尾脚注;全量信息集中到新 action `detail`。
3. **peak_pricing 表现**:时间感知,按调用时刻判断是否落在高峰窗口,命中则报当下实价并注明「高峰中(×N,至 HH:MM)」与平时价。
4. **文档深度**:URL 表按 sitemap 重建,并 WebFetch 关键配置页正文核实 `SKILL.md` 的 base_url/env 指引(已完成核实,见上)。
5. **架构**:拆出纯函数定价解析器,与格式化、server 装配三分。

### 架构备选与取舍

- **(取)纯函数解析器 + 拆文件**:`pricing.ts` 只做「模型 × 分组 × 时刻 → 实价」,`format.ts` 只做输出,`packy-mcp.ts` 只做 server 注册与 fetch。定价成唯一真源,`price` 与 `detail` 共用;测试可直接断言价格数值。理由:单文件已 368 行,接入 override + peak + tiers 会破 700 行;且现有测试只能透过格式化文本反推价格,断言脆弱。
- (弃)单文件内加函数:改动最小,但定价与格式化继续纠缠,700 行单文件。
- (弃)定价逻辑挪进 repo `lib/` 由插件 dynamic import(照 `cs` 插件做法):packyapi 与 prayer 业务无关,属反向依赖,且插件失去便携性。

已实测 Node v24.16.0 的 strip-types 支持静态 `import { x } from "./dep.ts"`,拆文件可行。

## 设计

### 文件结构

```
plugins/packyapi/
  .claude-plugin/plugin.json                  version 1.3.0, description 更新
  scripts/packy-mcp.ts                        server 注册 + fetch + action 分派
  scripts/pricing.ts                          新:定价解析器(纯函数,不触网)
  scripts/format.ts                           新:全部 format* 输出函数
  skills/packyapi/SKILL.md                    工具表 + 配置指引更新
  skills/packyapi/references/pricing-api.md   重写
  skills/packyapi/references/docs-map.md      按 sitemap 重建
  README.md                                   action 表补齐
tests/plugins/packyapi/pricing.test.ts        新
tests/plugins/packyapi/format.test.ts         由 packy-mcp.test.ts 迁移并扩展
```

`packy-mcp.ts` 保留 `API` / `ANNOUNCE_API` / `FETCH_TIMEOUT_MS` 与两个 fetch 函数;类型 `Model` / `Pricing` / `Announcement` / `Announcements` 迁至 `pricing.ts` 并由 `packy-mcp.ts` 重导出,保持外部 import 兼容。

### `pricing.ts` —— 定价解析器

```ts
export interface TierPrice {
  threshold: number   // 单次请求的输入 token 数超过它后生效(整段重定价)
  input: number       // $/1M,已换算为绝对价
  output: number
}

export interface PeakState {
  factor: number
  until?: string          // 当前窗口结束时刻,如 "12:00"
  offPeakInput: number    // 平时价,供对照
  offPeakOutput: number
}

export interface EffectivePrice {
  model: string
  group: string
  quotaType: number
  base: number
  // quota_type=0(按量,$/1M tokens)
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number     // cache_creation_ratio_5m 缺失时为 undefined
  // quota_type=1(按次)
  perCall?: number
  perCallMin?: number
  perCallMax?: number
  // 修饰信息
  ratioSource: "global" | "group-override"
  peak?: PeakState
  tiers?: TierPrice[]
  endpoints: string[]
  vendor?: string
}

export function resolvePrice(
  d: Pricing,
  model: string,
  group: string,
  opts?: { base?: number; now?: Date }
): EffectivePrice | undefined
```

解析顺序(逐步,顺序即正确性):

1. `ratio = d.model_group_ratio?.[group]?.[model] ?? m.model_ratio`,命中覆盖时 `ratioSource = "group-override"`。
2. `gr = d.group_ratio?.[group] ?? 1`。
3. `base` 默认 `2`。`input = ratio * gr * base`;`output = input * completion_ratio`;`cacheRead = input * cache_ratio`;`cacheWrite = cache_creation_ratio_5m ? input * cache_creation_ratio_5m : undefined`。
4. peak:遍历 `d.peak_pricing?.rules`,取 `rule.enabled && rule.models.includes(model)` 且 `now` 在 `rule.timezone` 下命中 `rule.weekdays` 与任一 `rule.windows` 的规则。命中则 `input`/`output`/`cacheRead`/`cacheWrite` 全部乘 `rule.factor`,并把乘前的 `input`/`output` 存入 `peak.offPeakInput/offPeakOutput`,`peak.until` 取该窗口结束时刻。
5. `peak_active` 优先:若 `d.peak_active` 非空且含该模型,以其为权威(取其 factor),否则用第 4 步的本地计算。服务端将来给出权威值时自动生效。
6. tiers:`m.tiers` 每条 `{threshold, ratio, output_ratio}` 换算为 `{threshold, input: input * ratio, output: output * (output_ratio ?? ratio)}`。基准为第 4 步之后的价(高峰与阶梯叠加)。
7. `quota_type === 1`:`perCall = model_price * gr`,`perCallMin`/`perCallMax` 由 `model_price_min`/`model_price_max` 同乘 `gr`(缺失则 undefined)。此时按量字段全部 undefined。
8. `endpoints = d.model_group_endpoints?.[group]?.[model] ?? m.supported_endpoint_types ?? []`。
9. `vendor = d.vendors?.find(v => v.id === m.vendor_id)?.name`。

时区判定不引依赖:`Intl.DateTimeFormat("en-US", { timeZone: rule.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })` 取目标时区的星期与 `HH:mm`,再与 `weekdays`(1=周一 … 7=周日,按 ISO)和 `windows` 字符串比对。Node 自带完整 ICU。

配套导出 `resolveGroups(d, model)` —— 返回某模型的可用分组列表(`enable_groups`),供 `price` 的 keyword 分支与 `detail` 复用。

### action 行为

| action | 变化 |
|---|---|
| `price` | 表格列不变(model/group/in/out/cache/endpoints)。命中 group-override 的行标 `†`、高峰中标 `*`、有 tiers 标 `‡`,表尾一次性输出脚注(含高峰倍率、窗口结束时刻、平时价、阶梯阈值)。默认仍只列 `cc` 组 |
| `models` | 新增 `vendor` 参数,按厂商名不区分大小写过滤;`endpoint` 过滤改用 `model_group_endpoints` 覆盖优先 |
| `groups` | `inactive_groups` 内的组标 `[停用]`,其余不变(倍率升序 + 说明) |
| `raw` | 不变,原始 JSON |
| `announcements` | 不变 |
| **`detail`(新)** | `detail model=X [group=] [base=]`。给 `group` 则只出该组,否则遍历该模型全部 `enable_groups`。输出:各分组实价(in/out/cache 读/cache 写)、tiers 阶梯表、peak 状态、端点及其 `supported_endpoint` 路径与方法、厂商名、`quota_type`、按次区间。这是「按需展开」的唯一落点 |

不新增 `endpoints` action:`supported_endpoint` 仅 5 条静态映射,并入 `detail` 输出与 `SKILL.md` 即够。

`price` 与 `models` 的 `group` 参数校验:传入的组不在 `group_ratio` 也不在 `inactive_groups` 时,输出「无匹配」外追加可用组名列表 —— 现状只回「无匹配」,模型拿不到线索会转去抓 HTML 页面。

### 错误处理

- 沿用 `FETCH_TIMEOUT_MS = 10_000` 硬超时(agent run 总超时 180s,一次挂起的调用会拖死整条消息处理)。
- `detail` 缺 `model` 参数 → `isError`,提示用 `models` 查确切 ID。
- `detail` 的 `model` 未命中 → 提示未找到并给出名称子串相近的候选(复用 `price` 的子串匹配)。
- fetch 失败沿用现有 `isError` + 原始 message。

### 测试

`tests/plugins/packyapi/pricing.test.ts`(纯函数,不触网):

- `model_group_ratio` 覆盖压过全局 `model_ratio`,`ratioSource` 标记正确
- peak 窗口内(命中)、窗口外同日、周末(`weekdays` 不含)三种时刻,注入固定 `now`
- `peak_active` 非空时压过本地 rules 计算
- tiers 换算,含 `output_ratio` 缺省回落 `ratio`
- `cache_creation_ratio_5m` 缺失时 `cacheWrite` 为 undefined
- `quota_type=1` 的 `perCall` 与 min/max 同乘 `group_ratio`
- `model_group_endpoints` 覆盖优先于 `supported_endpoint_types`
- `vendor_id` → `vendors` 名称映射;未知 id 时 `vendor` 为 undefined

`tests/plugins/packyapi/format.test.ts`:现有 `formatPrice` / `formatModels` / `formatGroups` / `formatRaw` / `formatAnnouncements` 五组断言迁移,新增脚注标记、`detail` 输出、`[停用]` 标记、`vendor` 过滤、未知 group 给候选。

mock 数据扩展到覆盖 `model_group_ratio`、`peak_pricing`、`peak_active`、`tiers`、`cache_creation_ratio_5m`、`model_group_endpoints`、`vendors`、`inactive_groups`、`supported_endpoint`、`model_price_min/max`。

### 文档改动

- **`pricing-api.md`** 重写:删除分组倍率表(过时根因,且官方文档页本身也滞后 —— 唯一真源是 API)。保留并补全:端点说明、12 个顶层字段、15 个 `data[]` 字段、完整计价顺序(含 override → peak → tiers 的叠加次序)。分组一律指向 `action=groups`。
- **`docs-map.md`** 按实测 sitemap 重建:删 2 条已死链(`cli/4-gemini.html`、`ccswitch/4-gemini.html`);补 12 个新页;文末删掉不存在的 `/packy-price`、`/packy-models`,改指 `packy` 工具。附刷新命令 `curl -s https://docs.packyapi.ai/sitemap.xml | grep -oE '<loc>[^<]+'`。其余现有 URL 已逐条与 sitemap 核对,均有效。
- **`SKILL.md`**:工具表补 `detail` 与 `models` 的 `vendor` 参数;配置段主推已核实的 `ANTHROPIC_BASE_URL=https://cf.api.fan`(不带 `/v1`),`slb-v1.api.fan` 由「直连推荐」降级为「官方文档已不再提及,备用,可用性自行验证」;补 `supported_endpoint` 的 5 条协议路径。
- **`README.md`**:action 表补 `announcements` 与 `detail`。
- **`plugin.json`**:`1.2.2` → `1.3.0`,description 提及分组倍率覆盖与高峰价。

## 待确认的假设

1. **`peak_active` 语义**:实盘为 `{}`,无官方文档。设计按「非空且含该模型时以其为权威,否则本地按 `rules` 计算」处理 —— 不猜结构细节,只在其存在时让它压过本地计算,服务端将来给出权威值时自动接上。若日后实测到真实结构与假设不符,只需改 `pricing.ts` 第 5 步。
2. **`weekdays` 起始值**:实盘规则为 `[1,2,3,4,5]`。ISO(1=周一)与 `Date.getDay()`(0=周日)两种约定下 `[1,2,3,4,5]` 都等于周一至周五,故当前规则不受影响。实现按 ISO 处理,并在 `pricing.ts` 注释标明该歧义 —— 只有将来出现含 `0`、`6`、`7` 的规则时才需重新核实。
3. **peak 与 tiers 的叠加次序**:无官方说明。设计取「先 peak 再 tiers」(tiers 以高峰后的价为基准)。实盘 `peak_pricing` 只覆盖 deepseek 三模型,而这三个模型均无 `tiers`,故当前两者不重叠,次序暂无实际影响。

## 验收

- `pnpm check`(typecheck + lint + test)全绿。
- `plugins/packyapi/scripts/packy-mcp.ts` 能被 Node 直跑(strip-types 下静态 `.ts` import 生效),stdio 冒烟可返回 `packy` 工具定义。
- 实盘抽查:`glm-5.2` 在 `glm-sale` 组报 `in $1.00/1M`(而非升级前的 `$8.00`);`deepseek-v4-pro` 在高峰窗口内报价为平时价的 2 倍并带脚注。
