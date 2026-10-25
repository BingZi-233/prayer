import type { Entry } from "./types"

type ReviewFields = Pick<Entry, "reviewState" | "reviewAttempts" | "reviewNote">

// 评审账本徽标:纯函数,方便不渲染 DOM 直接测文案与 variant。
// failed 且 reviewAttempts 为 0(超预算预过滤直接置 failed,未真正尝试)时不写次数,
// 否则会出现「升格失败 0 次」;原因在展开区的备注行里。
export function reviewBadge(e: ReviewFields): {
  text: string
  variant: "outline" | "secondary" | "destructive"
  title?: string
} | null {
  switch (e.reviewState) {
    case "legacy":
      return { text: "存量待处置", variant: "outline" }
    case "accepted":
      return { text: "待成文", variant: "secondary" }
    case "declined":
      return { text: "评审未通过", variant: "outline" }
    case "failed": {
      const n = e.reviewAttempts ?? 0
      return {
        text: n > 0 ? `升格失败 ${n} 次` : "升格失败",
        variant: "destructive",
        title: e.reviewNote ?? undefined,
      }
    }
    default:
      return null
  }
}

// 展开区的备注行:任何状态只要有 reviewNote 都显示(含 null 状态下手动失败 / 批次失败写的 note)。
export function reviewNoteLine(e: ReviewFields): string | null {
  const note = e.reviewNote?.trim()
  if (!note) return null
  const label =
    e.reviewState == null || e.reviewState === "failed"
      ? "最近升格失败"
      : "评审备注"
  return `${label}:${note}`
}
