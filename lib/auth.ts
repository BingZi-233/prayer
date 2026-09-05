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
      if (v.blockedUntil <= now && v.fails === 0) m.delete(k)
      else if (v.blockedUntil <= now && v.fails > 0) m.delete(k)
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

/** 从代理头里尽量取客户端 IP(XFF 首段);取不到就归并到 unknown。
 *  已知权衡:直连(无代理头)部署下所有请求共用 unknown 桶,连续口令错误会
 *  连管理员一起锁 15 分钟(廉价 DoS 面);本服务假定部署在可信反代后(XFF 可信)。 */
export function clientIp(req: Headers): string {
  return (
    req.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.get("x-real-ip") ||
    "unknown"
  )
}
