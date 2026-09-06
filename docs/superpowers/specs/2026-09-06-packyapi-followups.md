# packyapi 插件:本次升级明确不做的两项(待独立任务)

日期:2026-09-06
来源:`feat/packyapi-upgrade` 分支的九任务升级(见
`2026-09-06-packyapi-upgrade-design.md` 与 `../plans/2026-09-06-packyapi-upgrade.md`)

这两项在升级过程中被识别为真实问题,但都超出「修报价 + 补字段 + 刷文档」的范围,
故本次明确不做。记在这里以免丢失 —— 不是 TODO 清单,是两份已经论证过的任务简报。

---

## 一、在 API 边界做一次 schema 校验(取代下游到处补 `?.`)

### 现状

`plugins/packyapi/scripts/packy-mcp.ts` 的 `fetchPricing()` 用无校验强转:

```ts
return (await res.json()) as Pricing
```

于是同一份数据在下游被赋予两种互相矛盾的信任级别:`pricing.ts` 对声明为**必填**的
`d.data` / `d.group_ratio` 用了 `?.`(防御性),而别处又裸用。这不是风格问题 ——
它意味着「类型声明」与「实际信任」脱钩,而类型是我们唯一的契约。

### 为什么值得做

本次修掉的两个线上 bug **都是同一类**:类型说某字段必有,实际可能没有。

- `cache_ratio` 声明为必填,实盘 10/67 缺失 → `input * undefined` = `NaN`,
  `gemini-slb` 组 7 行里 5 行的 cache 列在向用户输出 `$NaN`。
- `model_group_ratio` 完全没被读 → 11 个 model×group 组合报错价(7 高估 4 低估)。

本次的应对是「把实测的字段可选性如实写进类型,让 `tsc` 在下游强制处理缺失分支」。
这拿到了 zod 想要的大部分收益且成本极低,但它防不住**下一个我们还没实测到的字段变化**
—— 平台加字段、改类型、某字段从必有变可选,我们仍然只会在用户看到怪输出时才知道。

边界校验能把这类问题从「静默错价」变成「明确报错」。对客服场景,报错远好于报错价。

### 范围与代价

`zod` 已是仓库依赖(`packy-mcp.ts` 已用它写 MCP 入参 schema),所以不引新依赖。
但要建模的是:12 个顶层字段 + 15 个 `data[]` 字段,其中约一半可选、三个是嵌套 map
(`model_group_ratio` / `model_group_endpoints` / `peak_active`)、一个是数组套对象
(`peak_pricing.rules`)。还要决定校验失败时的行为 —— 整体拒绝(用户什么都查不到)
还是逐模型跳过并告知(部分可用)。**后者更符合本次一贯的取向,但需要设计。**

### 建议做法

1. 在 `pricing.ts` 旁新建 `schema.ts`,用 zod 定义 `PricingSchema`,并让现有的
   `Pricing` 类型改为 `z.infer<typeof PricingSchema>` —— 单一真源,不维护两份。
2. `fetchPricing()` 改为 `PricingSchema.parse(...)`;失败时不抛给用户裸异常,
   而是走与 `格式化失败` 同一套 `isError` 兜底(见 `packy-mcp.ts` 的 handler)。
3. 对 `data[]` 用逐项 `safeParse`:某个模型的数据坏掉不该让整张价格表不可用。
   被跳过的模型数量应出现在输出里,而不是静默消失。
4. 配套测试:构造缺字段 / 类型错 / 嵌套 map 结构异常三类畸形载荷。

### 相关位置

- `plugins/packyapi/scripts/packy-mcp.ts` — `fetchPricing` / `fetchAnnouncements` 的强转
- `plugins/packyapi/scripts/pricing.ts` — 文件头注释里记着 2026-09-06 实测的字段可选性
  普查结果,是建模的起点
- `plugins/packyapi/skills/packyapi/references/pricing-api.md` — 字段表

---

## 二、`tiers` 与 `peak_pricing` 的叠加次序仍无官方文档

### 现状

`resolvePrice` 的第 5 步把阶梯价建立在**高峰之后**的价上:

```
input  = ratio × gr × base × peakFactor
tierIn = input × tier.ratio
```

即两者相乘。这个次序是我方选择,**没有任何官方依据**。

### 已经确认的与仍未确认的,不要混为一谈

本次升级为 `tiers` 的语义找到了三条独立外部证据(记在 `pricing.ts` 头注释与
`pricing-api.md` 里):

- 实盘 5 个 `gpt-5.x` 的 `{272000, ratio:2, output_ratio:1.5}` 与 OpenAI 公开的
  「prompt 超 272,000 输入 token 则整个请求按 2x 输入 / 1.5x 输出重新计价」逐字吻合
- `grok-4.5` 的 `{200000, ratio:2}` 与 Grok 公开规则一致
- 阿里云对 qwen 系明写「该请求的所有 Token 均按对应阶梯的单价结算」

**这三条确认的是「`ratio` 是乘数」与「整段重定价」,不是叠加次序。** 高峰与阶梯
同时命中时该乘、该取大、还是该只生效一个,仍然未知。

### 为什么现在不必急

实盘 `peak_pricing` 的唯一规则只点名 3 个 deepseek 模型
(`deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`),
而这三个模型**都没有 `tiers`**。所以当前两者在任何真实查询里都不重叠 ——
这个次序影响不到任何一个实际报价。

代码路径存在且已被测试覆盖(`pricing.test.ts` 用 `peak_active` 人工构造了一个
同时命中的用例,断言 input/output 两腿以同一个高峰后基准换算),所以不是没测,
是没有权威答案可对。

### 触发条件与届时该做什么

**触发条件:平台把某个带 `tiers` 的模型放进 `peak_pricing.rules[].models`。**
可以用一条检查捕捉:

```js
const both = d.data.filter(
  (m) => m.tiers?.length && d.peak_pricing?.rules?.some((r) => r.models?.includes(m.model_name))
)
```

届时应做的:

1. 先找官方口径(平台文档 / 公告 / 询问平台方),而不是继续沿用我方假设。
2. 若仍无口径,至少在 `price` / `detail` 的输出里标注「该模型同时命中高峰与阶梯,
   叠加口径无官方文档,以平台结算为准」—— 与现在对孤儿组(`§`)和按次标称价
   (`标称` / `实际`)的处理原则一致:**不确定的地方要让用户看见不确定。**
3. `new-api` 上游的阶梯实际走 `tiered_expr` / `billing_expr` 表达式
   (`pkg/billingexpr`,用 `len` 表示总输入上下文长度),PackyAPI 的 `tiers` 数组是
   那个表达式的**投影**。若要追根,读上游表达式比读 `tiers` 数组更准。

### 相关位置

- `plugins/packyapi/scripts/pricing.ts` — 文件头注释计价顺序第 4-5 条;`resolvePrice`
  的 tiers 换算
- `docs/superpowers/specs/2026-09-06-packyapi-upgrade-design.md` — 「待确认的假设」第 3 条
- `tests/plugins/packyapi/pricing.test.ts` — 「高峰与阶梯叠加时,input/output 两腿以
  同一个高峰后基准换算」用例
