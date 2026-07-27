# 通道保活（QQ/OneBot WS + Telegram long poll）设计

日期：2026-07-27
分支：`feat/channel-keepalive`

## 问题

群里 @ 机器人无响应，但进程存活、后台状态显示"已连接"。两个通道各有一处"假连接"缺陷，都表现为**连接状态谎报**：`isConnected()` 返回 true，实际收不到任何入站消息。

### QQ / OneBot

`lib/channels/qq/client.ts` 的 `ws` 连接没有任何应用层探活：

- 无 `ping`/`pong`。TCP 链路被 NAT 超时、中间设备静默丢流打断时，本端不会收到 FIN/RST，`ws.on("close")` 不触发，重连逻辑永远不启动。要等操作系统 TCP 重传耗尽（默认可达十几分钟甚至更久）才会醒。
- 无入站静默检测。即使 TCP 活着，NapCat 侧 OneBot 适配器挂掉、不再推事件时，本端同样毫无察觉。
- `send()` 只检查 `readyState === OPEN`（`client.ts:58`）。假死 socket 的 `readyState` 仍是 `OPEN`，消息写进黑洞，无任何错误。

### Telegram

`lib/channels/tg/client.ts` 的 long poll 循环有两个叠加缺陷：

- `getUpdates` 只传了 `abort.signal`（`client.ts:236`），**没有任何超时定时器**。HTTP 请求卡死（连接建立但服务端不回、代理吞包）时 `await` 永久挂起，`runLoop` 停在原地，`connected` 恒为 true。
- `client.ts:266` 的 `if (this.stopped || isAbortError(err)) break` 把**任何** abort 都当作停机信号退出整个轮询循环。这意味着：直接加一个超时 abort 会让情况更糟——第一次超时就永久停止轮询，且不再重连。修超时前必须先修这行。

## 目标与非目标

**目标**

- 两个通道都能在有界时间内自行发现"静默断链"并恢复。
- 连接状态如实反映真实可达性，而非"最后一次握手成功过"。
- 断链与自愈在日志和后台状态页可见。

**非目标**

- 不引入配置面。阈值为代码常量，仅单测可注入覆盖。
- 不发管理群通知（QQ 断链时 QQ 通道本就发不出去，价值有限）。
- 不动 agent 核心、db schema、后台反思循环。
- 不做 registry 层的粗粒度"重启整个通道"监督器。

## 架构

新增 `lib/channels/keepalive.ts`，两个通用小件，两通道各取所需。

### `StaleWatchdog`

单个可重置的 deadline，不是轮询 interval。

```
start(ms)   启动倒计时
touch()     有活动，按当前 deadline 重置
retune(ms)  改 deadline 并立即重置
stop()      停止（幂等）
```

超时调用构造时传入的 `onStale`，触发后自动进入 stopped 状态（不重复触发，直到下次 `start`/`touch`）。定时器函数可注入，`vi.useFakeTimers` 能完整覆盖状态迁移。

### `withDeadline(fn, ms, opts?)`

给返回 Promise 的调用套硬超时。`fn` 接收一个 `AbortSignal`；超时则 abort 并抛 `DeadlineExceededError`（独立错误类，关键作用是让调用方区分"超时 abort"与"停机 abort"）。正常返回或提前失败时清理定时器。

## QQ 侧改造

### 一条 liveness deadline，不是两套超时

关键简化：**pong 与任何入站帧都算"活着"**，共用同一个 watchdog，不为 pong 单开超时定时器。ping timer 的职责只是在链路安静时主动勾出一个 pong 来喂 watchdog。

`connect()` 内接线：

- `ws.on("open")`：启 ping timer（`PING_INTERVAL_MS` 一次 `ws.ping()`）+ `watchdog.start(DEFAULT_LIVENESS_MS)`
- `ws.on("pong")`：`watchdog.touch()`
- `ws.on("message")`：`watchdog.touch()` + 更新 `lastRxAt`（在 JSON 解析之前，任何帧都算）
- 收到 `post_type === "meta_event" && meta_event_type === "heartbeat"`：读事件自带的 `interval`（毫秒），`watchdog.retune(max(interval * HEARTBEAT_FACTOR, MIN_LIVENESS_MS))`，然后短路返回，不进 `parseGroupMessage`
- `onStale`：`logger.log("warn", ...)` + `staleReconnects++` + `ws.terminate()`
- `ws.on("close")` 与 `stop()`：清 ping timer 与 watchdog

用 `terminate()` 而非 `close()`：假死 socket 连关闭握手都发不出去，`close()` 会挂住。`terminate()` 立即销毁 socket，触发既有 `close` 分支 → `scheduleReconnect()`，复用现有指数退避，不改退避逻辑。

### 自适应的收益

NapCat 默认开 OneBot heartbeat，间隔约 5s → deadline 收紧到 15s，断链 15s 内测出。若用户关掉 heartbeat，则退回 75s 兜底，仅靠 ping/pong 维持。两种配置都不会误判安静群。

### 常量

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `PING_INTERVAL_MS` | 30_000 | 主动 ping 间隔 |
| `DEFAULT_LIVENESS_MS` | 75_000 | 未观察到 heartbeat 时的兜底 deadline（约 2.5 个 ping 周期） |
| `MIN_LIVENESS_MS` | 15_000 | retune 下限，防止 heartbeat interval 过小导致抖动 |
| `HEARTBEAT_FACTOR` | 3 | 容忍连丢 2 个心跳 |

常量从 `lib/channels/qq/client.ts` 导出。构造函数追加第 4 个可选 `opts` 参数覆盖三个时间值，仅单测使用；`QqChannel` 不传。

## TG 侧改造

- `getUpdates` 包 `withDeadline(pollTimeoutSec * 1000 + POLL_DEADLINE_MARGIN_MS)`；`getMe` 包 `IDENTITY_DEADLINE_MS`。
- 重写 `runLoop` 的 catch 分支，顺序明确：
  1. `this.stopped` → `break`（停机优先）
  2. `err instanceof DeadlineExceededError` → `staleTimeouts++`、`logger.log("warn", ...)`、走 `handlePollError` 退避重试
  3. 其余 `isAbortError(err)` → `break`（真·停机 abort）
  4. 其余 → 既有 `handlePollError`
- TG 的 long poll 本身即心跳（服务端在 `timeout` 秒内必回，哪怕空数组），所以硬超时就是保活语义，不再叠 `StaleWatchdog`。

常量：`POLL_DEADLINE_MARGIN_MS = 15_000`，`IDENTITY_DEADLINE_MS = 20_000`。

## 可观测

`lastRxAt` 距今秒数与自愈计数拼进 `ChannelStatus.detail`：

- QQ：`OneBotClient` 新增 `stats()` 返回 `{ lastRxAt, staleReconnects }`，`QqChannel.status()` 拼成 `rx=12s ago stale-reconnects=2`
- TG：现有 detail 已含 `@username offset=N`，追加 `rx=…s ago poll-timeouts=N`。这里的 `rx` 指**最近一次 `getUpdates` 成功返回**的时刻（含返回空数组），不是最近一次收到消息——否则安静群会显示成断链。

零新 API 路由，后台现有状态页直接可见。

## 测试

- `tests/lib/channels/keepalive.test.ts`（新）：假定时器覆盖 `StaleWatchdog` 全部状态迁移（start/touch/retune/stop/超时后不重复触发/stop 幂等）与 `withDeadline`（正常返回、超时抛 `DeadlineExceededError`、fn 自身先失败、超时后清定时器）
- `tests/lib/onebot/client.test.ts`：现有测试已用真实 `WebSocketServer`，追加两例
  - 服务端建连后保持静默 → 客户端在注入的短 deadline 后 terminate 并**重新建连**（断言服务端收到第二次 connection）
  - 服务端发 heartbeat meta_event → 不 emit `message.received`，且 deadline 按 `interval * 3` 被 retune（用不同 interval 值对比生效时刻）
- `tests/lib/channels/tg/client.test.ts`：现有 `TelegramBotApi` mock 可注入，追加一例——`getUpdates` 首次永挂 → 超时后循环**继续**并成功拉到下一批 update（回归保护 `client.ts:266` 那行 break）

## 改动清单

| 文件 | 性质 |
| --- | --- |
| `lib/channels/keepalive.ts` | 新增 |
| `lib/channels/qq/client.ts` | 改：ping timer + watchdog + `stats()` |
| `lib/channels/qq/index.ts` | 改：`status().detail` 拼 stats |
| `lib/channels/tg/client.ts` | 改：`withDeadline` + 修 catch 分支 + detail |
| `tests/lib/channels/keepalive.test.ts` | 新增 |
| `tests/lib/onebot/client.test.ts` | 改：+2 例 |
| `tests/lib/channels/tg/client.test.ts` | 改：+1 例 |

## 验收

- `pnpm typecheck && pnpm lint && pnpm test` 全绿
- 真机冒烟：断开 NapCat（或拔网）后，QQ 通道在 15s 内日志出现 stale 警告并重连；后台状态页 `rx=` 秒数归零
