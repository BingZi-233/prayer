// reflection 页共享的视图类型(/api/reflection 系列的响应形状)。
// 放 components/ 而非 app/:页面与区块组件都要用,不能反过来让区块组件 import app/。
export interface GroupRow {
  groupId: number
  cursor: number
  lagMs: number | null
  bufferCount: number
  sedimentedCount: number
}
export interface Entry {
  id: number
  content: string
  /** 全文长度;大于 content.length 说明列表给的是预览截断,全文按需拉详情 */
  contentLen?: number
  groupId: number | null
  ts: number | null
  question: string | null
  answer: string | null
  status?: "pending" | "approved" | "rejected" | "promoted"
}
// 单条条目全文(/api/reflection/entries/[id] 的响应),列表只带预览截断
export interface EntryDetail {
  id: number
  content: string
  question: string | null
  answer: string | null
  status: "pending" | "approved" | "rejected" | "promoted"
}
export interface Data {
  config: {
    scanMs: number
    lookbackMs: number
    settleMs: number
    windowMax: number
    promoteMs: number
    promoteMinEntries: number
    promoteMaxPerRun: number
  }
  groups: GroupRow[]
  entries: Entry[]
}
