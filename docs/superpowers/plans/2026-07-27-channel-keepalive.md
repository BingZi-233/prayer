# 通道保活 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 QQ/OneBot WS 与 Telegram long poll 在"静默断链"（连接状态谎报为已连接、实际收不到消息）发生后于有界时间内自愈。

**Architecture:** 新增 `lib/channels/keepalive.ts` 提供两个可注入定时器的小件——`StaleWatchdog`（可重置 deadline）与 `withDeadline`（Promise 硬超时，抛独立的 `DeadlineExceededError`）。QQ 用 `StaleWatchdog` + 主动 `ws.ping()`，任何入站帧或 pong 都算"活着"，超时 `ws.terminate()` 走既有重连；TG 用 `withDeadline` 给 `getUpdates`/`getMe` 加硬超时，并修掉"任何 abort 都退出轮询循环"的 bug。阈值为代码常量，仅单测可注入覆盖。

**Tech Stack:** TypeScript、Next.js 16（仅 Node runtime）、`ws`、grammY、Vitest。包管理器 pnpm。

**设计稿：** `docs/superpowers/specs/2026-07-27-channel-keepalive-design.md`

**分支：** `feat/channel-keepalive`（已创建，设计稿已提交）

---

## 上下文速览（实现者必读）

- 路径别名 `@/*` 指向仓库根，**没有 `src/`**。
- Prettier 规则：**无分号 + 双引号**，`trailingComma: es5`，printWidth 80。写完跑 `pnpm format` 否则 lint 红。
- 测试放 `tests/`，镜像 `lib/` 结构，**不与源码同目录**。`include` 只认 `tests/**/*.test.ts`。
- 注释与提交正文用简体中文，提交遵循 Conventional Commits。
- 现有 QQ 测试 `tests/lib/onebot/client.test.ts` 用**真实的本地 `WebSocketServer`**（`ws` 库服务端会自动应答 ping → pong），不是 mock。新测试沿用这个套路。
- 现有 TG 测试 `tests/lib/channels/tg/client.test.ts` 用注入的 `TelegramBotApi` mock（`makeMockApi`）。
- `lib/onebot/client.ts` 只是 `lib/channels/qq/client.ts` 的兼容 re-export，真实代码在后者。
- `logger` 的调用形式是 `logger.log("warn", "…")`，从 `lib/logger` 导入。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `lib/channels/keepalive.ts`（新建） | 通道无关的保活原语：`StaleWatchdog`、`withDeadline`、`DeadlineExceededError`。不 import 任何通道代码 |
| `lib/channels/qq/client.ts`（改） | OneBot WS 传输层，接线 ping timer + watchdog，新增 `stats()` |
| `lib/channels/qq/index.ts`（改） | `QqChannel.status()` 把 `stats()` 拼进 `detail` |
| `lib/channels/tg/client.ts`（改） | long poll 循环加硬超时，修 catch 分支，`status()` 加 `rx=`/`poll-timeouts=` |
| `tests/lib/channels/keepalive.test.ts`（新建） | 假定时器覆盖两个原语的全部状态迁移 |
| `tests/lib/onebot/client.test.ts`（改） | +3 例：ping 发出、静默重连、heartbeat retune |
| `tests/lib/channels/tg/client.test.ts`（改） | +1 例：getUpdates 卡死后循环继续 |

---

### Task 1: `keepalive.ts` 原语

**Files:**
- Create: `lib/channels/keepalive.ts`
- Test: `tests/lib/channels/keepalive.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `tests/lib/channels/keepalive.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  StaleWatchdog,
  withDeadline,
  DeadlineExceededError,
} from "@/lib/channels/keepalive"

describe("StaleWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("start 后到点触发 onStale", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(100)
    vi.advanceTimersByTime(99)
    expect(onStale).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("touch 重置倒计时", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(100)
    vi.advanceTimersByTime(80)
    w.touch()
    vi.advanceTimersByTime(80)
    expect(onStale).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("触发后自动停止,不重复触发", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    vi.advanceTimersByTime(200)
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(w.isRunning()).toBe(false)
  })

  it("触发后 touch 不复活(需重新 start)", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    vi.advanceTimersByTime(50)
    w.touch()
    vi.advanceTimersByTime(200)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("retune 改 deadline 并立即重置", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(1000)
    vi.advanceTimersByTime(500)
    w.retune(100)
    vi.advanceTimersByTime(99)
    expect(onStale).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("未 start 时 retune 只记录,不启动倒计时", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.retune(50)
    vi.advanceTimersByTime(500)
    expect(onStale).not.toHaveBeenCalled()
    w.start(50)
    vi.advanceTimersByTime(50)
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it("stop 后不触发,且 stop 幂等", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    w.stop()
    w.stop()
    vi.advanceTimersByTime(500)
    expect(onStale).not.toHaveBeenCalled()
    expect(w.isRunning()).toBe(false)
  })

  it("stop 后 touch 不重新武装", () => {
    const onStale = vi.fn()
    const w = new StaleWatchdog({ onStale })
    w.start(50)
    w.stop()
    w.touch()
    vi.advanceTimersByTime(500)
    expect(onStale).not.toHaveBeenCalled()
  })
})

describe("withDeadline", () => {
  it("按时返回则原样透传结果", async () => {
    const r = await withDeadline(async () => 42, 1000)
    expect(r).toBe(42)
  })

  it("超时抛 DeadlineExceededError 并 abort 传入的 signal", async () => {
    let aborted = false
    const p = withDeadline(
      (signal) =>
        new Promise<never>(() => {
          signal.addEventListener("abort", () => {
            aborted = true
          })
        }),
      20
    )
    await expect(p).rejects.toBeInstanceOf(DeadlineExceededError)
    expect(aborted).toBe(true)
  })

  it("fn 自身先失败则透传原错误,不包成 DeadlineExceededError", async () => {
    const boom = new Error("boom")
    await expect(withDeadline(async () => Promise.reject(boom), 1000)).rejects.toBe(
      boom
    )
  })

  it("外部 signal abort 时,内部 signal 同步 abort", async () => {
    const outer = new AbortController()
    let innerAborted = false
    const p = withDeadline(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            innerAborted = true
            const e = new Error("aborted")
            e.name = "AbortError"
            reject(e)
          })
        }),
      5000,
      { signal: outer.signal }
    )
    outer.abort()
    await expect(p).rejects.toThrow("aborted")
    expect(innerAborted).toBe(true)
  })

  it("外部 signal 已 abort 时立即 abort 内部", async () => {
    const outer = new AbortController()
    outer.abort()
    const p = withDeadline(
      (signal) => Promise.resolve(signal.aborted),
      5000,
      { signal: outer.signal }
    )
    await expect(p).resolves.toBe(true)
  })

  it("正常返回后不再触发超时定时器", async () => {
    vi.useFakeTimers()
    try {
      const r = await withDeadline(async () => "ok", 10)
      expect(r).toBe("ok")
      // 若定时器未清理,推进时间会产生未处理拒绝
      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/channels/keepalive.test.ts
```

Expected: FAIL，报 `Failed to resolve import "@/lib/channels/keepalive"`。

- [ ] **Step 3: 写实现**

创建 `lib/channels/keepalive.ts`：

```typescript
/**
 * 通道无关的保活原语。
 * 不 import 任何具体通道代码；定时器可注入，便于假定时器单测。
 */

type TimerHandle = ReturnType<typeof setTimeout>

export interface StaleWatchdogOpts {
  /** 到点未被 touch 时调用；触发后 watchdog 自动进入 stopped */
  onStale: () => void
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (t: TimerHandle) => void
}

/**
 * 单个可重置的 deadline（不是轮询 interval）。
 * 语义：start 武装 → touch 重置 → 到点触发一次 onStale 后自动停。
 */
export class StaleWatchdog {
  private timer?: TimerHandle
  private deadlineMs = 0
  private running = false
  private readonly onStale: () => void
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  private readonly clearTimer: (t: TimerHandle) => void

  constructor(opts: StaleWatchdogOpts) {
    this.onStale = opts.onStale
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t))
  }

  isRunning(): boolean {
    return this.running
  }

  start(ms: number): void {
    this.deadlineMs = ms
    this.running = true
    this.arm()
  }

  /** 有活动：按当前 deadline 重置。未运行时无副作用 */
  touch(): void {
    if (!this.running) return
    this.arm()
  }

  /** 改 deadline；运行中则立即重置，未运行则只记录供下次 start 之外的语义无关 */
  retune(ms: number): void {
    this.deadlineMs = ms
    if (this.running) this.arm()
  }

  stop(): void {
    this.running = false
    this.disarm()
  }

  private arm(): void {
    this.disarm()
    this.timer = this.setTimer(() => {
      this.timer = undefined
      this.running = false
      this.onStale()
    }, this.deadlineMs)
  }

  private disarm(): void {
    if (this.timer === undefined) return
    this.clearTimer(this.timer)
    this.timer = undefined
  }
}

/** withDeadline 超时专用错误；调用方据此区分「超时」与「停机 abort」 */
export class DeadlineExceededError extends Error {
  constructor(public readonly ms: number) {
    super(`deadline exceeded after ${ms}ms`)
    this.name = "DeadlineExceededError"
  }
}

export interface WithDeadlineOpts {
  /** 外部停机信号；abort 时内部 signal 一并 abort（此时抛 fn 自己的错误，不是 DeadlineExceededError） */
  signal?: AbortSignal
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (t: TimerHandle) => void
}

/**
 * 给返回 Promise 的调用套硬超时。
 * 超时 → abort 传给 fn 的 signal 并抛 DeadlineExceededError（即便 fn 无视 abort 也会拒绝，靠 race 保证）。
 */
export function withDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  opts?: WithDeadlineOpts
): Promise<T> {
  const setTimer = opts?.setTimer ?? ((f, m) => setTimeout(f, m))
  const clearTimer = opts?.clearTimer ?? ((t) => clearTimeout(t))
  const ac = new AbortController()
  const outer = opts?.signal
  const onOuterAbort = () => ac.abort()
  if (outer) {
    if (outer.aborted) ac.abort()
    else outer.addEventListener("abort", onOuterAbort, { once: true })
  }

  let timer: TimerHandle | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimer(() => {
      ac.abort()
      reject(new DeadlineExceededError(ms))
    }, ms)
  })

  const work = fn(ac.signal)
  // race 结束后 fn 可能才拒绝，挂个空 catch 防未处理拒绝告警
  work.catch(() => {})

  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimer(timer)
    outer?.removeEventListener("abort", onOuterAbort)
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/channels/keepalive.test.ts
```

Expected: PASS，全部用例绿。

- [ ] **Step 5: 格式化并提交**

```bash
cd /Users/ziyou/projects/prayer && pnpm format && pnpm typecheck
git add lib/channels/keepalive.ts tests/lib/channels/keepalive.test.ts
git commit -m "feat(channels): 新增保活原语 StaleWatchdog 与 withDeadline

StaleWatchdog 是可重置的单条 deadline,触发一次后自动停;withDeadline 给
Promise 套硬超时并抛独立的 DeadlineExceededError,便于调用方区分超时与停机
abort。两者定时器均可注入,假定时器可完整覆盖状态迁移。"
```

---

### Task 2: QQ ping + 静默看门狗

**Files:**
- Modify: `lib/channels/qq/client.ts`
- Test: `tests/lib/onebot/client.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/lib/onebot/client.test.ts` 的 `describe("OneBotClient", …)` 块内、最后一个 `it` 之后追加三例。注意 `startServer` 每次调用会覆盖模块级的 `wss`，重连测试要在**同一个** server 上统计连接数：

```typescript
  it("open 后按 pingIntervalMs 主动发 ws ping", async () => {
    let pings = 0
    const port = await startServer((ws) => {
      ws.on("ping", () => {
        pings++
      })
    })
    client = new OneBotClient(`ws://127.0.0.1:${port}`, undefined, undefined, {
      pingIntervalMs: 30,
      // 不让看门狗在本例中开火
      livenessMs: 60_000,
    })
    client.start()
    await new Promise((r) => setTimeout(r, 200))
    expect(pings).toBeGreaterThanOrEqual(2)
  })

  it("服务端静默超过 livenessMs → terminate 并重新建连", async () => {
    let connections = 0
    const port = await startServer(() => {
      connections++
      // 建连后什么都不发，也不回 ping（pingIntervalMs 设得足够大，不会发出 ping）
    })
    client = new OneBotClient(`ws://127.0.0.1:${port}`, undefined, undefined, {
      pingIntervalMs: 60_000,
      livenessMs: 120,
    })
    client.start()
    // 首连 + 看门狗开火 + backoff 1000ms 后重连
    await new Promise((r) => setTimeout(r, 2500))
    expect(connections).toBeGreaterThanOrEqual(2)
    expect(client.stats().staleReconnects).toBeGreaterThanOrEqual(1)
  })

  it("heartbeat meta_event 不 emit 消息,且按 interval 收紧 deadline", async () => {
    let connections = 0
    let emitted = 0
    const onMsg = () => {
      emitted++
    }
    bus.on("message.received", onMsg)
    try {
      const port = await startServer((ws) => {
        connections++
        ws.send(
          JSON.stringify({
            post_type: "meta_event",
            meta_event_type: "heartbeat",
            interval: 20,
          })
        )
      })
      client = new OneBotClient(`ws://127.0.0.1:${port}`, undefined, undefined, {
        pingIntervalMs: 60_000,
        // 默认 deadline 很长；只有 retune 生效才会在测试窗口内开火
        livenessMs: 60_000,
        minLivenessMs: 10,
        heartbeatFactor: 3,
      })
      client.start()
      await new Promise((r) => setTimeout(r, 2500))
      expect(connections).toBeGreaterThanOrEqual(2)
      expect(emitted).toBe(0)
    } finally {
      bus.off("message.received", onMsg)
    }
  })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/onebot/client.test.ts
```

Expected: FAIL。类型层面 `OneBotClient` 只接受 3 个构造参数、且没有 `stats()`；运行时三例均不满足断言。

- [ ] **Step 3: 写实现**

改 `lib/channels/qq/client.ts`。

3a. 顶部 import 追加 logger 与保活原语：

```typescript
import WebSocket from "ws"
import { bus } from "../../bus"
import type { ActionSend } from "../../events"
import { logger } from "../../logger"
import { enrich } from "../../onebot/enrich"
import { parseGroupMessage } from "../../onebot/parse"
import { StaleWatchdog } from "../keepalive"
```

3b. 在 `interface Pending` 之后加常量与 opts 类型：

```typescript
/** 主动 ping 间隔 */
export const PING_INTERVAL_MS = 30_000
/** 未观察到 NapCat heartbeat 时的兜底 deadline（约 2.5 个 ping 周期） */
export const DEFAULT_LIVENESS_MS = 75_000
/** retune 下限，防止 heartbeat interval 过小导致抖动 */
export const MIN_LIVENESS_MS = 15_000
/** 容忍连丢 2 个心跳 */
export const HEARTBEAT_FACTOR = 3

/** 保活时间参数；仅单测覆盖，生产走常量 */
export interface OneBotKeepaliveOpts {
  pingIntervalMs?: number
  livenessMs?: number
  minLivenessMs?: number
  heartbeatFactor?: number
}

export interface OneBotStats {
  /** 最近一次收到任意入站帧的时刻（毫秒时间戳）；从未收到则 undefined */
  lastRxAt?: number
  /** 因静默判定而强制重连的累计次数 */
  staleReconnects: number
}
```

3c. 类字段追加（放在 `private echoSeq = 0` 之后）：

```typescript
  private pingTimer?: ReturnType<typeof setInterval>
  private watchdog?: StaleWatchdog
  private lastRxAt?: number
  private staleReconnects = 0
  private readonly pingIntervalMs: number
  private readonly livenessMs: number
  private readonly minLivenessMs: number
  private readonly heartbeatFactor: number
```

3d. 构造函数改为接受第 4 个可选参数：

```typescript
  constructor(
    private url: string,
    private accessToken?: string,
    private onStatus?: (connected: boolean) => void,
    opts?: OneBotKeepaliveOpts
  ) {
    this.pingIntervalMs = opts?.pingIntervalMs ?? PING_INTERVAL_MS
    this.livenessMs = opts?.livenessMs ?? DEFAULT_LIVENESS_MS
    this.minLivenessMs = opts?.minLivenessMs ?? MIN_LIVENESS_MS
    this.heartbeatFactor = opts?.heartbeatFactor ?? HEARTBEAT_FACTOR
  }
```

3e. `stop()` 里加停保活（在 `setConnected(false)` 之前）：

```typescript
  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.stopKeepalive()
    this.setConnected(false)
    this.clearPending()
    this.ws?.close()
    this.ws = undefined
  }
```

3f. `isConnected()` 之后加 `stats()`：

```typescript
  /** 供 QqChannel.status() 拼 detail */
  stats(): OneBotStats {
    return { lastRxAt: this.lastRxAt, staleReconnects: this.staleReconnects }
  }
```

3g. `connect()` 内三个 handler 改写 + 新增 pong handler。把原来的 `ws.on("open")`、`ws.on("message")`、`ws.on("close")` 整体替换为：

```typescript
    ws.on("open", () => {
      this.backoff = 1000
      this.setConnected(true)
      this.startKeepalive(ws)
    })

    // pong 与任何入站帧一样算「链路活着」，共用同一条 deadline
    ws.on("pong", () => {
      this.watchdog?.touch()
    })

    ws.on("message", (raw: WebSocket.RawData) => {
      // 收到任何帧就算活着（解析成不成功都算）
      this.lastRxAt = Date.now()
      this.watchdog?.touch()
      let evt: any
      try {
        evt = JSON.parse(raw.toString())
      } catch {
        return
      }
      // NapCat 心跳:按其自带 interval 收紧 deadline,断链更快被测出
      if (
        evt?.post_type === "meta_event" &&
        evt?.meta_event_type === "heartbeat"
      ) {
        const interval = Number(evt.interval)
        if (Number.isFinite(interval) && interval > 0) {
          this.watchdog?.retune(
            Math.max(interval * this.heartbeatFactor, this.minLivenessMs)
          )
        }
        return
      }
      // API 回执:按 echo 匹配挂起请求
      if (evt?.echo && this.pending.has(evt.echo)) {
        const p = this.pending.get(evt.echo)!
        this.pending.delete(evt.echo)
        clearTimeout(p.timer)
        p.resolve(evt.data)
        return
      }
      const parsed = parseGroupMessage(evt)
      if (!parsed) return
      // 富化(回查引用/转发 + 下载图)后再 emit;失败兜底不阻断
      enrich(parsed, { call: (action, params) => this.call(action, params) })
        .then((msg) => bus.emit("message.received", msg))
        .catch((err) =>
          bus.emit("error.occurred", { scope: "onebot.enrich", err })
        )
    })

    ws.on("close", () => {
      this.stopKeepalive()
      this.setConnected(false)
      this.scheduleReconnect()
    })
    ws.on("error", () => ws.close())
```

3h. 在 `scheduleReconnect()` 之后插入两个私有方法：

```typescript
  /**
   * 起 ping timer + 静默看门狗。
   * ping 的唯一职责是在链路安静时勾出 pong 喂看门狗；
   * 判定僵死只有看门狗一条路径，不为 pong 单开超时定时器。
   */
  private startKeepalive(ws: WebSocket): void {
    this.stopKeepalive()
    this.watchdog = new StaleWatchdog({
      onStale: () => {
        this.staleReconnects++
        logger.log(
          "warn",
          `[qq] ${this.livenessMs}ms 无入站帧,判定链路僵死,强制重连(累计 ${this.staleReconnects} 次)`
        )
        // 假死 socket 连关闭握手都发不出去,close() 会挂住,必须 terminate
        ws.terminate()
      },
    })
    this.watchdog.start(this.livenessMs)
    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.ping()
      } catch {
        /* ping 发不出去由看门狗兜底 */
      }
    }, this.pingIntervalMs)
  }

  private stopKeepalive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }
    this.watchdog?.stop()
    this.watchdog = undefined
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/onebot/client.test.ts
```

Expected: PASS，含原有 9 例与新增 3 例。

- [ ] **Step 5: 格式化、类型检查并提交**

```bash
cd /Users/ziyou/projects/prayer && pnpm format && pnpm typecheck
git add lib/channels/qq/client.ts tests/lib/onebot/client.test.ts
git commit -m "fix(channels): OneBot WS 加 ping/pong 与静默看门狗,治 TCP 假死

原先 ws 无任何应用层探活,TCP 被 NAT 或中间设备静默打断时不触发 close,
readyState 仍是 OPEN,消息写进黑洞要等 OS 重传耗尽才醒。现在 open 后每
30s 主动 ping,任何入站帧或 pong 都 touch 同一条 deadline;默认 75s 无
活动即 terminate 走既有重连。收到 NapCat heartbeat 则按其 interval*3
收紧 deadline(下限 15s),典型 5s 心跳下 15s 内测出断链。"
```

---

### Task 3: QQ 状态可见性

**Files:**
- Modify: `lib/channels/qq/index.ts`
- Test: `tests/lib/channels/qq/channel.test.ts`

- [ ] **Step 1: 写失败的测试**

先看现有文件确定 mock 方式：

```bash
cd /Users/ziyou/projects/prayer && cat tests/lib/channels/qq/channel.test.ts
```

在该文件的 `describe` 块内追加一例。若现有测试是用真实 `OneBotClient` 构造 `QqChannel`，则该例可直接断言"未连接时 detail 不含 rx="：

```typescript
  it("从未收到帧时 detail 不含 rx=,有静默重连计数则出现在 detail", () => {
    const ch = new QqChannel("ws://127.0.0.1:1")
    expect(ch.status().detail ?? "").not.toContain("rx=")
    // 用内部 client 的 stats 形状驱动 detail 拼接
    const fake = {
      stats: () => ({ lastRxAt: Date.now() - 12_000, staleReconnects: 2 }),
      isConnected: () => true,
    }
    // @ts-expect-error 单测替换私有 client，仅验证 detail 拼接
    ch.client = fake
    const detail = ch.status().detail ?? ""
    expect(detail).toContain("rx=12s ago")
    expect(detail).toContain("stale-reconnects=2")
  })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/channels/qq/channel.test.ts
```

Expected: FAIL，`detail` 为 `undefined`，不含 `rx=`。

- [ ] **Step 3: 写实现**

改 `lib/channels/qq/index.ts` 的 `status()`：

```typescript
  status(): ChannelStatus {
    const s = this.client.stats()
    const parts: string[] = []
    if (s.lastRxAt != null) {
      parts.push(`rx=${Math.round((Date.now() - s.lastRxAt) / 1000)}s ago`)
    }
    if (s.staleReconnects > 0) {
      parts.push(`stale-reconnects=${s.staleReconnects}`)
    }
    return {
      id: this.id,
      connected: this.isConnected(),
      lastError: this.lastError,
      detail: parts.length > 0 ? parts.join(" ") : this.detail,
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/channels/qq/channel.test.ts
```

Expected: PASS。

- [ ] **Step 5: 格式化并提交**

```bash
cd /Users/ziyou/projects/prayer && pnpm format && pnpm typecheck
git add lib/channels/qq/index.ts tests/lib/channels/qq/channel.test.ts
git commit -m "feat(channels): QQ 状态 detail 暴露 rx 距今秒数与静默重连计数

后台状态页可直接看出链路是否新鲜,不必只信 connected 布尔值。"
```

---

### Task 4: TG long poll 硬超时 + 修 abort 分支

**Files:**
- Modify: `lib/channels/tg/client.ts`
- Test: `tests/lib/channels/tg/client.test.ts`

**这是最关键的一个 Task。** `lib/channels/tg/client.ts:266` 现在写的是 `if (this.stopped || isAbortError(err)) break` —— 任何 abort 都退出整个轮询循环。只加超时不改这行，第一次超时就会**永久停止收消息**，比现在更糟。

- [ ] **Step 1: 写失败的测试**

4a. 先扩展 `makeMockApi`，让首次调用可以卡死。修改 `tests/lib/channels/tg/client.test.ts` 中 `makeMockApi` 的 opts 类型与 `getUpdates` 实现：

opts 类型追加一行（在 `hangUntilAbort?: boolean` 之后）：

```typescript
  /** 仅第 1 次 getUpdates 挂起直到 abort（测硬超时后循环继续） */
  hangFirstCall?: boolean
```

`getUpdates` 开头 `api.getUpdatesCalls++` 之后插入：

```typescript
      const hang = opts?.hangUntilAbort || (opts?.hangFirstCall && api.getUpdatesCalls === 1)
      if (hang) {
```

并把原来的 `if (opts?.hangUntilAbort) {` 这一行删掉（其函数体保持不变，仍是那段等待 abort 后 reject 的 Promise）。

4b. 在 `describe("TelegramChannel", …)` 内追加一例：

```typescript
  it("getUpdates 卡死 → 硬超时后循环继续,下一轮仍能收到消息", async () => {
    const api = makeMockApi({
      hangFirstCall: true,
      updatesQueue: [[groupUpdate(11, "after timeout")], []],
      admins: [{ userId: "55", role: "admin" }],
    })
    const ch = track(
      new TelegramChannel("tok", {
        getOffset: () => offset,
        setOffset: (n) => {
          offset = n
        },
        api,
        pollTimeoutSec: 0,
        pollDeadlineMs: 50,
        sleep: (ms) => delay(Math.min(ms, 20)),
        downloadImage: null,
      })
    )
    await ch.start()
    await waitFor(() => received.length === 1, "超时后仍收到消息", 4000)
    expect(received[0]!.rawText).toBe("after timeout")
    expect(api.getUpdatesCalls).toBeGreaterThanOrEqual(2)
    expect(ch.status().detail).toContain("poll-timeouts=1")
  })
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/channels/tg/client.test.ts
```

Expected: FAIL。`pollDeadlineMs` 不在 `TelegramChannelOpts` 上（类型错），且运行时 `getUpdates` 会永久挂起，`waitFor` 4s 后超时。

- [ ] **Step 3: 写实现**

改 `lib/channels/tg/client.ts`。

3a. import 追加：

```typescript
import { DeadlineExceededError, withDeadline } from "../keepalive"
```

3b. 在 `const DEFAULT_POLL_TIMEOUT_SEC = 30` 之后加常量：

```typescript
/** long poll 硬超时 = 服务端 timeout + 该余量；服务端正常会在 timeout 内回空数组 */
export const POLL_DEADLINE_MARGIN_MS = 15_000
/** getMe 身份校验硬超时 */
export const IDENTITY_DEADLINE_MS = 20_000
```

3c. `TelegramChannelOpts` 追加两个可选项（放在 `pollTimeoutSec?: number` 之后）：

```typescript
  /** getUpdates 硬超时毫秒；默认 pollTimeoutSec*1000 + 15000。仅单测覆盖 */
  pollDeadlineMs?: number
  /** getMe 硬超时毫秒；默认 20000。仅单测覆盖 */
  identityDeadlineMs?: number
```

3d. 类字段追加（放在 `private readonly pollTimeoutSec: number` 之后）：

```typescript
  private readonly pollDeadlineMs: number
  private readonly identityDeadlineMs: number
  /** 最近一次 getUpdates 成功返回的时刻（含返回空数组） */
  private lastPollAt?: number
  private pollTimeouts = 0
```

3e. 构造函数里，在 `this.pollTimeoutSec = opts.pollTimeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC` 之后插入：

```typescript
    this.pollDeadlineMs =
      opts.pollDeadlineMs ??
      this.pollTimeoutSec * 1000 + POLL_DEADLINE_MARGIN_MS
    this.identityDeadlineMs = opts.identityDeadlineMs ?? IDENTITY_DEADLINE_MS
```

3f. `runLoop()` 里把 `getUpdates` 调用包上 `withDeadline`，并记录 `lastPollAt`。原代码：

```typescript
        this.abort = new AbortController()
        const offset = this.getOffset()
        const updates = await this.api.getUpdates(
          {
            offset,
            timeout: this.pollTimeoutSec,
            // Phase 1 只收 message；忽略 edited 等
            allowed_updates: ["message"],
          },
          this.abort.signal
        )

        if (this.stopped) break
```

替换为：

```typescript
        this.abort = new AbortController()
        const offset = this.getOffset()
        const updates = await withDeadline(
          (signal) =>
            this.api.getUpdates(
              {
                offset,
                timeout: this.pollTimeoutSec,
                // Phase 1 只收 message；忽略 edited 等
                allowed_updates: ["message"],
              },
              signal
            ),
          this.pollDeadlineMs,
          { signal: this.abort.signal }
        )
        this.lastPollAt = Date.now()

        if (this.stopped) break
```

3g. 重写 `runLoop()` 的 catch 分支。原代码：

```typescript
      } catch (err) {
        if (this.stopped || isAbortError(err)) break
        await this.handlePollError(err)
      }
```

替换为：

```typescript
      } catch (err) {
        // 顺序要紧：停机优先，其次超时（可恢复），最后才是真·停机 abort
        if (this.stopped) break
        if (err instanceof DeadlineExceededError) {
          this.pollTimeouts++
          this.setConnected(false)
          await this.handlePollError(err)
          continue
        }
        if (isAbortError(err)) break
        await this.handlePollError(err)
      }
```

3h. `ensureIdentity()` 的 getMe 包硬超时。原代码：

```typescript
  private async ensureIdentity(): Promise<void> {
    this.abort = new AbortController()
    const me = await this.api.getMe(this.abort.signal)
```

替换为：

```typescript
  private async ensureIdentity(): Promise<void> {
    this.abort = new AbortController()
    const me = await withDeadline(
      (signal) => this.api.getMe(signal),
      this.identityDeadlineMs,
      { signal: this.abort.signal }
    )
```

3i. `status()` 的 detail 追加两项。在 `detailParts.push(\`offset=${this.safeOffset()}\`)` 之后插入：

```typescript
    if (this.lastPollAt != null) {
      detailParts.push(
        `rx=${Math.round((Date.now() - this.lastPollAt) / 1000)}s ago`
      )
    }
    if (this.pollTimeouts > 0) {
      detailParts.push(`poll-timeouts=${this.pollTimeouts}`)
    }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/ziyou/projects/prayer && pnpm vitest run tests/lib/channels/tg/client.test.ts
```

Expected: PASS，含原有 8 例与新增 1 例。特别确认 `"stop 中止 in-flight getUpdates 并退出 loop"` 仍绿——它验证外部 abort 走的仍是 `break` 而非重试。

- [ ] **Step 5: 格式化、类型检查并提交**

```bash
cd /Users/ziyou/projects/prayer && pnpm format && pnpm typecheck
git add lib/channels/tg/client.ts tests/lib/channels/tg/client.test.ts
git commit -m "fix(channels): TG long poll 加硬超时,并修「任何 abort 都退出轮询」

getUpdates 原先只传 signal 不设超时,HTTP 卡死则 await 永久挂起,循环停摆
但 connected 恒为 true。现在包 withDeadline(timeout*1000+15s),getMe 包 20s。

同时修 catch 分支:原先 isAbortError 一律 break,只加超时会让首次超时永久
停止轮询。改为停机优先 break,DeadlineExceededError 退避重试,其余 abort 才
break。status detail 增加 rx 距今秒数与 poll-timeouts 计数。"
```

---

### Task 5: 全量验证

**Files:** 无改动（仅验证）

- [ ] **Step 1: 跑完整检查**

```bash
cd /Users/ziyou/projects/prayer && pnpm typecheck && pnpm lint && pnpm test
```

Expected: 三项全绿。`pnpm test` 的用例数应比改动前多 8 例左右（keepalive 约 14 例 + QQ 3 例 + QQ channel 1 例 + TG 1 例）。

- [ ] **Step 2: 若 lint 报格式问题**

```bash
cd /Users/ziyou/projects/prayer && pnpm format && pnpm lint
```

Expected: PASS。若有改动，`git add -A && git commit -m "style: prettier 格式化"`。

- [ ] **Step 3: 生产构建冒烟**

```bash
cd /Users/ziyou/projects/prayer && pnpm build
```

Expected: 构建成功。（**不要**用 `next dev` 验证——claude-agent-sdk 要真实 Node runtime，HMR 下会挂骨架屏。）

- [ ] **Step 4: 记录真机冒烟待办**

真机验证需要连着 NapCat 的环境，无法在本地单测覆盖，交由使用者执行：

1. `pnpm build && pnpm start`
2. 断开 NapCat（停容器或拔网）
3. 观察 `logs/` 内出现 `[qq] … 判定链路僵死,强制重连`，NapCat 开心跳时应在 15s 内出现
4. 恢复 NapCat，确认后台状态页 `rx=` 秒数归零、群内 @ 机器人恢复响应

把这四步写进 PR 描述的验证清单。

---

## 自查记录

- **设计稿覆盖**：`StaleWatchdog`/`withDeadline`（Task 1）、QQ ping+watchdog+heartbeat retune+terminate（Task 2）、QQ detail（Task 3）、TG withDeadline+catch 修复+detail（Task 4）、验收命令（Task 5）。设计稿列的 7 个改动文件全部有对应 Task。
- **命名一致性**：`stats()` 返回 `{ lastRxAt, staleReconnects }`，Task 2 定义、Task 3 消费，字段名一致。`DeadlineExceededError` 在 Task 1 定义、Task 4 用 `instanceof` 判断。`pollDeadlineMs` 在 Task 4 的 opts、字段、测试三处同名。
- **已知取舍**：pong 丢失不单独计时，被"入站静默"这一条 deadline 覆盖（ping 勾不出 pong 即无活动），因此不需要单独的 pong-timeout 测试。这是设计稿"一条 liveness deadline"的直接后果，不是遗漏。
