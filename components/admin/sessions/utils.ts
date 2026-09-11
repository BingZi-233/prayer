export function clock(ts: number | undefined): string {
  if (!ts) return ""
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function hangLabel(since: number | null | undefined): string | null {
  if (!since) return null
  const min = Math.max(0, Math.round((Date.now() - since) / 60_000))
  if (min < 1) return "刚转人工"
  if (min < 60) return `挂起 ${min} 分`
  const h = Math.floor(min / 60)
  return `挂起 ${h} 时 ${min % 60} 分`
}

/** 仅客户(user)靠左,其余(bot / tool / …)一律靠右 */
export function isCustomerRole(role: string): boolean {
  return role === "user"
}
