# PackyAPI 计价 API 参考

## 端点

`GET https://www.packyapi.ai/api/pricing` — 公开,无需 auth,返回 JSON。

## 顶层字段

| 字段 | 说明 |
|---|---|
| `data[]` | 模型列表(见下) |
| `group_ratio` | 分组倍率 map,如 `{"cc":2,"cc-sale":0.8,...}` |
| `usable_group` | 分组中文说明 |
| `supported_endpoint` | 协议 → 路径,如 `anthropic → /v1/messages` |
| `vendors` | 厂商 id→名称 |
| `auto_groups` | 默认组(当前 `["cc"]`) |
| `peak_pricing` | 高峰浮动价规则(当前 `enabled:false`) |

## `data[]` 每模型字段

| 字段 | 说明 |
|---|---|
| `model_name` | 模型 ID(填 `ANTHROPIC_MODEL` 等) |
| `quota_type` | 0=按量(token),1=按次(固定价) |
| `model_ratio` | 输入倍率(按量时用) |
| `completion_ratio` | 输出/输入 倍数 |
| `cache_ratio` | 缓存/输入 倍数 |
| `model_price` | 按次单价(quota_type=1 时用) |
| `enable_groups` | 该模型可用的分组 |
| `supported_endpoint_types` | `["anthropic","openai",...]` |

## 计价公式(new-api 体系)

设 `base = 2`(= $0.002/1K tokens,new-api 默认单位),`gr = group_ratio[组]`:

**quota_type=0(按量,$/1M tokens):**
```
input  = model_ratio * gr * base
output = input * completion_ratio
cache  = input * cache_ratio
```
**quota_type=1(按次):** `price/次 = model_price * gr`

已核验(cc 组,gr=2):opus-4-8 = in $10 / out $50;sonnet-5 = $4 / $20;fable-5 = $20 / $100。

## 分组倍率(group_ratio,越低越便宜)

| 组 | 倍率 | 说明 |
|---|---|---|
| `cc` | 2 | claude code 专用(默认) |
| `cc-sale` | 0.8 | 便宜的 cc 分组(缓存可能异常) |
| `cc-expensive` | 2.2 | 昂贵 cc 分组,可用于第三方 |
| `claude-officially` | 7 | claude 官方版本 |
| `claude-sale` | 1 | claude sale 渠道 |
| `codex` | 0.5 | codex 专用 |
| `deepseek-officially` | 0.25 | deepseek 官方 |

完整列表 / 实时值:`node packy.ts groups`。

## 需鉴权的端点(不可匿名)

`/api/models` 返回 `401 未登录`。故一律用 `/api/pricing`(公开)获取模型与价格。
