# PackyAPI 计价 API 参考

## 端点

`GET https://www.packyapi.ai/api/pricing` — 公开,无需 auth,返回 JSON。
`GET https://www.packyapi.ai/api/announcements` — 公开,平台公告。

`/api/models` 不可匿名访问(2026-09-06 实测返回 `403`,是 Cloudflare 拦截页而非 JSON 响应,不是应用层的 401),故模型与价格一律走 `/api/pricing`。

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
| `tiers` | 长上下文阶梯价 `[{threshold, ratio, output_ratio?}]`。`ratio` 是作用在基准价上的**乘数**;单次请求的**输入** token 超过 `threshold` 时,**整个请求**按该档单价结算(非仅超出部分),阈值处价格跳变。多档只取命中的最高一档,不累加。`output_ratio` 缺省则回落 `ratio`。**这是平台给出的阶梯摘要,不是完整计费规则** —— 上游 new-api 的阶梯走 `tiered_expr` 表达式,`tiers` 是它的投影,实际结算以平台为准 |
| `model_price` | 按次的**标称价**(`quota_type=1` 时用)—— 平台默认档,既非最低价也非典型价。实测 `gpt-image-2` 的标称价是区间下限的 13.6 倍却只占上限的 11% |
| `model_price_min` / `model_price_max` | 按次价格区间(图片类模型)。实际结算在此区间内随请求参数(图片尺寸/质量等)浮动 |
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
   (`input × ratio`,`output × (output_ratio ?? ratio)`),按 `threshold` 升序输出。
   命中口径是**单次请求的输入 token 数**,命中后**整个请求**按该档结算(非仅超出部分);
   多档只取命中的最高一档。
   > 「乘数 + 整段重定价」这两点有外部证据:实盘 5 个 `gpt-5.x` 的
   > `{272000, ratio:2, output_ratio:1.5}` 与 OpenAI 公开规则逐字吻合,`grok-4.5` 的
   > `200000/2x` 与 Grok 公开规则一致,阿里云对 qwen 系明写「该请求的所有 Token 均按
   > 对应阶梯的单价结算」。
   > 但**阶梯与高峰浮动的叠加次序仍无任何文档**,那一条是我方选择。
6. 按次(`quota_type=1`):`perCall = model_price * gr`,`min`/`max` 同乘 `gr`。

## 分组倍率与「孤儿组」

**不要在此处静态记录倍率** —— 分组会增删、倍率会变,官方文档页 `docs/token/2-group.html`
本身也滞后于 API。实时值一律用 `packy` 工具的 `action=groups`。

另需注意:`data[].enable_groups` 引用的组名 **多于** `group_ratio` 定义的组。
2026-09-06 实测 `enable_groups` 出现 21 个组,而 `group_ratio` / `usable_group` 各只有 18 个 ——
`hongjing`(6 个模型)、`test`(2 个)、`default`(1 个)三个组倍率无处可查。
这类「孤儿组」的报价只能按倍率 1 估算,`packy` 的 `price` / `detail` 会用 `§` 标记并加脚注说明。
不要把这类估算价当作平台的正式报价。
