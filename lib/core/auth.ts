import { isIP } from "node:net"

/**
 * 后台鉴权共用原语。
 *
 * 纯 JS 恒定时间比较(不依赖 node:crypto):proxy.ts 与 API route 共用,
 * 两侧 runtime 都能跑。防计时侧信道逐字节猜 ADMIN_TOKEN。
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  // 长度差也纳入 diff;循环内不 early-return,保证每字节都参与比较
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/**
 * 登录爆破限速:per-IP 失败计数,连续 5 次失败锁 15 分钟,成功清零。
 * 模块状态放 globalThis(sharedDb 同款模式),防 dev/HMR 重复加载丢状态。
 */
export const LOGIN_MAX_FAILS = 5
export const LOGIN_BLOCK_MS = 15 * 60_000
const THROTTLE_GC_ENTRIES = 1000

interface ThrottleEntry {
  fails: number
  blockedUntil: number
}

const g = globalThis as unknown as {
  __loginThrottle?: Map<string, ThrottleEntry>
}

function throttleMap(): Map<string, ThrottleEntry> {
  if (!g.__loginThrottle) g.__loginThrottle = new Map()
  // 顺带 GC:条目过多时清掉已过期的
  const m = g.__loginThrottle
  if (m.size > THROTTLE_GC_ENTRIES) {
    const now = Date.now()
    for (const [k, v] of m) {
      if (v.blockedUntil <= now) m.delete(k)
    }
  }
  return m
}

export function loginThrottleState(
  ip: string,
  now = Date.now()
): { blocked: boolean; retryAfterMs?: number } {
  const m = throttleMap().get(ip)
  if (!m) return { blocked: false }
  if (m.blockedUntil > now)
    return { blocked: true, retryAfterMs: m.blockedUntil - now }
  return { blocked: false }
}

export function recordLoginFail(ip: string, now = Date.now()): void {
  const m = throttleMap()
  const e = m.get(ip) ?? { fails: 0, blockedUntil: 0 }
  e.fails++
  if (e.fails >= LOGIN_MAX_FAILS) {
    e.blockedUntil = now + LOGIN_BLOCK_MS
    e.fails = 0
  }
  m.set(ip, e)
}

export function clearLoginFails(ip: string): void {
  throttleMap().delete(ip)
}

/**
 * 读取登录限速用的客户端 IP。
 *
 * X-Forwarded-For/X-Real-IP 都可由直连客户端伪造，因此默认不信任；只有
 * 部署方明确设置 TRUST_PROXY=true（或调用方显式传 true）时才读取代理头。
 * Node/hosting adapter 若把 socket 地址挂到 request 上，则直连优先使用
 * 该服务端元数据；值无效时归并到 unknown，避免把任意 header 内容带入
 * 内存 key/日志。
 */
export type ClientIpRequest = {
  headers: Headers
  /** Optional trusted address supplied by a Node/hosting adapter. */
  ip?: unknown
  socket?: { remoteAddress?: unknown } | null
  connection?: { remoteAddress?: unknown } | null
}

export function clientIp(
  req: Headers | ClientIpRequest,
  trustProxy = process.env.TRUST_PROXY === "true"
): string {
  const headers = req instanceof Headers ? req : req.headers
  if (trustProxy) {
    const forwarded = headers.get("x-forwarded-for")
    for (const raw of forwarded?.split(",") ?? []) {
      const value = raw.trim()
      if (isIp(value)) return value
    }
    const real = headers.get("x-real-ip")?.trim()
    if (real && isIp(real)) return real
  }

  // `NextRequest` itself does not expose this field today, but Node adapters
  // and some hosts attach it. It is server-side metadata, unlike request
  // headers, so it remains usable when TRUST_PROXY=false.
  if (!(req instanceof Headers)) {
    const address =
      (typeof req.ip === "string" && req.ip) ||
      (typeof req.socket?.remoteAddress === "string" &&
        req.socket.remoteAddress) ||
      (typeof req.connection?.remoteAddress === "string" &&
        req.connection.remoteAddress)
    if (address && isIp(address)) return address
  }
  return "unknown"
}

function isIp(value: string): boolean {
  return value.length <= 128 && isIP(value) !== 0
}
