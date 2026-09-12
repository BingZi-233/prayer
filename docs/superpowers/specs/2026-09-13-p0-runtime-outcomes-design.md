# P0 Runtime Outcome Recovery Design

## Context

运行记录显示，当前主要损失不是模型不会回答，而是系统把中间文本当最终答案、把判定器错误当作“不可答”、把候选扫描无限扩大，以及在通道未连接或发送失败时仍把结果记成成功。这个设计把这些边界收回到确定性的代码状态机；模型仍只负责生成和分类。

## Goals

1. 出站只允许最终 assistant 文本通过；模型异常必须带可区分的 `status`。
2. 主动补位的可答性至少有 `answerable`、`not_answerable`、`error` 三态；判定器/agent 出错时不推进游标，并受硬候选预算保护。
3. 回复在发送前进入 SQLite outbox，以幂等键去重；发送成功、失败、重试均有持久状态，通道不再静默丢弃。
4. 自动/主动解决率只把真实发送成功的结果计为成功；失败可重试成功，重复事件不产生重复统计。

## Non-goals

- 不在本次改动中重训、替换或额外提示模型。
- 不把动态价格、可用性或公告写入静态知识库。
- 不改变 ACK、blocked、handoff 等非模型路径的业务判定。

## Design

### 1. Final-text selection

`drainQuery` 和 `Agent.run` 共享一个轻量累加器：普通 assistant 文本块在同一段内累加；一旦出现 `tool_use`，丢弃此前的草稿段，后续 assistant 文本成为最终段。这样保留 SDK 的流式分块，同时不会把“计划/工具前言 + 最终答案”拼成用户可见文本。`AgentResult` 增加 `status: success | partial | failed`：完整迭代为 `success`，异常但有真实部分文本为 `partial`，异常且只有兜底文案为 `failed`。

### 2. Proactive tri-state and budget

`AnswerabilityClassifier` 返回：

```ts
type AnswerabilityDecision = "answerable" | "not_answerable" | "error"
interface AnswerabilityResult {
  decision: AnswerabilityDecision
  reason?: "timeout" | "invalid_output" | "classifier_error"
}
```

判定器错误只记录诊断事件，不把候选永久消费掉。轮询每个 chat 有两个独立上限：成功答案数 `maxPerScan`，尝试判定/生成的候选数 `maxCandidatesPerScan`。配置 schema 默认 `12`，解析时强制不小于 `maxPerScan`，并且运行时再次钳制为正整数。候选预算耗尽或判定/agent 出错时保持游标不动；普通 `not_answerable` 和正常哨兵才允许继续并最终推进游标。

### 3. Durable outbox

`ActionSend` 携带 `deliveryKey`（幂等键）和可选 `resolutionKey`。reply mapper 为同一回复的首块使用根键，后续分块使用稳定后缀。`outbox_messages` 表保存完整 action JSON、状态 (`pending | sending | sent | failed`)、attempts、next-attempt 时间、错误和发送时间。

`ChannelRegistry` 在调用通道前先原子地 enqueue-and-claim；成功标记 `sent`，异常标记 `failed` 并按 1s、2s、4s…最多 60s 退避。`sending` 同时写入短 lease，重启或 lease 到期后可被回收，避免进程崩溃留下永久卡单。registry 启动重试定时器，停止时清理；重启后由 SQLite 中的 due rows 继续。语义是本地 durable at-least-once（平台已接受而进程随后崩溃时仍可能重复），不是平台 exactly-once。旧的无 outbox 构造方式仍保持内存直发，便于纯单测和迁移兼容。

通道适配器必须把“未连接/发送 API 失败”作为 rejected Promise 返回：QQ `send` 等待 WebSocket send，Telegram 不再吞掉异常。这样 registry 不能把未发送误记为成功。

### 4. Delivery-aware accounting

`resolution_events` 和 `proactive_replies` 增加 `delivery_key`、`delivery_status`、`last_error`、`delivered_at`、`delivery_expected`。带 delivery key 的 resolution 首次写入为 `pending`；reply mapper 先发 `delivery.planned(rootKey, chunkCount)`，再发每个 chunk 的 `delivery.recorded`，只有同一 root 的全部 chunk 成功才转为 `sent`。事件按 chunk key 幂等，重复事件重新从 outbox 已发送行计算计数，不增加统计行。无 key 的历史/即时事件直接为 `sent`。解决率查询只计 `sent` 的 `auto`/`proactive`。主动回复留痕先写 pending，发送成功后才进入成功计数；重试成功会更新同一行，不插重复行。

迁移新增 v9，所有新增列对旧数据默认 `sent`，不重写历史语义；outbox 新表为空。唯一索引保证非空 `delivery_key` 幂等。

## Invariants

- 任意用户可见 action 都有唯一 outbox `deliveryKey`；同键最多一条物理发送记录。
- classifier/agent 的 error 不推进 proactive cursor。
- `maxCandidatesPerScan` 永远不小于 `maxPerScan`，且每轮有限。
- `resolution_status=sent` 只由成功的 channel Promise 产生，且同一逻辑回复的所有计划 chunk 均成功。
- delivery recorder 是幂等更新；重复 success/failure 事件不会增加统计行。

## Verification

- 单元测试覆盖 final-text reset、Agent status、tri-state/error 游标、候选预算、outbox 幂等/退避、通道 rejection、delivery-aware 统计。
- 任务级测试后运行相关 Vitest；全部任务完成后运行 `pnpm check`。
