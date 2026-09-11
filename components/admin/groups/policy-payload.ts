import type { Tri, GroupPolicy, Row } from "./types"

export function triFrom(v: boolean | undefined): Tri {
  if (v === undefined) return "inherit"
  return v ? "on" : "off"
}

export function triToBool(t: Tri): boolean | undefined {
  if (t === "inherit") return undefined
  return t === "on"
}

export function rowLabel(
  r: Pick<Row, "channel" | "chatId" | "groupId">,
  nameFn: (id: number) => string
): string {
  if (r.channel === "qq" && r.groupId > 0) return nameFn(r.groupId)
  if (r.channel === "tg" && r.groupId !== 0) {
    const n = nameFn(r.groupId)
    if (n && n !== String(r.groupId)) return n
  }
  return r.chatId
}

/**
 * 策略写 payload：新键 policyKey；QQ 同时清掉历史裸群号键，避免 getGroupPolicy 回退读到旧覆盖。
 */
export function policyWritePayload(
  row: Pick<Row, "channel" | "chatId" | "policyKey">,
  policy: GroupPolicy | null
): Record<string, GroupPolicy | null> {
  const out: Record<string, GroupPolicy | null> = { [row.policyKey]: policy }
  if (row.channel === "qq" && row.chatId) {
    out[row.chatId] = null
  }
  return out
}
