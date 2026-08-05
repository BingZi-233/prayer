import WebSocket from "ws"
import { bus } from "../../bus"
import type { ActionSend } from "../../events"
import { logger } from "../../logger"
import { enrich } from "../../onebot/enrich"
import {
  parseGroupMessage,
  type RawGroupMessageEvent,
} from "../../onebot/parse"
import { StaleWatchdog } from "../keepalive"

interface Pending {
  resolve: (v: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// 入站帧(JSON.parse 结果):群消息事件字段 + 心跳/echo 回执字段的并集,只声明用到的;
// 回执 data 为各 OneBot API 的应答载荷,留给调用方自行窄化
type InboundFrame = RawGroupMessageEvent & {
  meta_event_type?: string
  interval?: number
  echo?: string
  data?: unknown
}

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

/**
 * QQ / OneBot 传输层：正向 WS、入站 parse/enrich、出站 send_group_msg。
 * **不**订阅 bus；出站由 QqChannel.send → 本类 send 调用。
 */
export class OneBotClient {
  private ws?: WebSocket
  private stopped = false
  private backoff = 1000
  private connected = false
  private reconnectTimer?: ReturnType<typeof setTimeout>
  // echo 请求-响应:get_msg / get_forward_msg 回查内容用
  private pending = new Map<string, Pending>()
  private echoSeq = 0
  private pingTimer?: ReturnType<typeof setInterval>
  private watchdog?: StaleWatchdog
  private lastRxAt?: number
  private staleReconnects = 0
  /** 当前生效的静默 deadline;初始等于 livenessMs,heartbeat retune 后同步更新,仅供日志排查用 */
  private effectiveLivenessMs = 0
  private readonly pingIntervalMs: number
  private readonly livenessMs: number
  private readonly minLivenessMs: number
  private readonly heartbeatFactor: number

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

  isConnected(): boolean {
    return this.connected
  }

  /** 供 QqChannel.status() 拼 detail */
  stats(): OneBotStats {
    return { lastRxAt: this.lastRxAt, staleReconnects: this.staleReconnects }
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

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

  /**
   * 出站：发群消息。由 QqChannel / 单测直接调用。
   * 未连接时静默跳过（与历史行为一致）。
   */
  send(a: ActionSend): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    // 有 replyToId → 用消息段数组(reply + text),避免答案文本里的 [...] 被 CQ 误解析;
    // 无则保持纯字符串(向后兼容)。
    const message =
      a.replyToId != null
        ? [
            { type: "reply", data: { id: String(a.replyToId) } },
            { type: "text", data: { text: a.text } },
          ]
        : a.text
    this.ws.send(
      JSON.stringify({
        action: "send_group_msg",
        params: { group_id: Number(a.chatId), message },
      })
    )
  }

  private setConnected(v: boolean): void {
    if (this.connected === v) return
    this.connected = v
    this.onStatus?.(v)
  }

  private connect(): void {
    if (this.stopped) return // 拆卸后挂起的重连不再建连
    const headers = this.accessToken
      ? { Authorization: `Bearer ${this.accessToken}` }
      : undefined
    const ws = new WebSocket(this.url, { headers })
    this.ws = ws

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
      // 收到任何帧就算活着(解析成不成功都算)
      this.lastRxAt = Date.now()
      this.watchdog?.touch()
      let evt: InboundFrame
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
          this.effectiveLivenessMs = Math.max(
            interval * this.heartbeatFactor,
            this.minLivenessMs
          )
          this.watchdog?.retune(this.effectiveLivenessMs)
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
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, 30000)
  }

  /**
   * 起 ping timer + 静默看门狗。
   * ping 的唯一职责是在链路安静时勾出一个 pong 喂看门狗;
   * 判定僵死只有看门狗一条路径,不为 pong 单开超时定时器。
   */
  private startKeepalive(ws: WebSocket): void {
    this.stopKeepalive()
    this.effectiveLivenessMs = this.livenessMs
    this.watchdog = new StaleWatchdog({
      onStale: () => {
        this.staleReconnects++
        logger.log(
          "warn",
          `[qq] ${this.effectiveLivenessMs}ms 无入站帧,判定链路僵死,强制重连(累计 ${this.staleReconnects} 次)`
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

  // 拉群列表(get_group_list)。未连接/超时 → undefined(不抛)。
  getGroupList(): Promise<unknown[] | undefined> {
    return this.call("get_group_list", {}).then((data) =>
      Array.isArray(data) ? data : undefined
    )
  }

  // 拉整群成员列表(get_group_member_list)。未连接/超时 → undefined(不抛)。
  // 一次返回整群成员(含 card/nickname/user_id),供批量解析群友名,免逐成员单查。
  getGroupMemberList(groupId: number): Promise<unknown[] | undefined> {
    return this.call("get_group_member_list", { group_id: groupId }).then(
      (data) => (Array.isArray(data) ? data : undefined)
    )
  }

  // 发 OneBot API 请求并等回执(echo 关联)。超时/未连接 → resolve undefined(降级不抛)。
  private call(
    action: string,
    params: Record<string, unknown>,
    timeoutMs = 8000
  ): Promise<unknown> {
    if (this.ws?.readyState !== WebSocket.OPEN)
      return Promise.resolve(undefined)
    const echo = `req_${++this.echoSeq}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo)
        resolve(undefined)
      }, timeoutMs)
      this.pending.set(echo, { resolve, timer })
      this.ws!.send(JSON.stringify({ action, params, echo }))
    })
  }

  private clearPending(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.resolve(undefined)
    }
    this.pending.clear()
  }
}
