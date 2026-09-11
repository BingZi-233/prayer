import { VirtualList } from "@/components/admin/virtual-list"
import type { Entry } from "./types"
import { EntryRow } from "./entry-row"

// 知识条目虚拟列表:仅渲染可视区行,变高由 ResizeObserver 自动重测
// (展开"来源问答"会触发重测)。210+ 条时避免全量 DOM 导致滚动卡顿。
export function EntryList({
  entries,
  acting,
  onAct,
  groupName,
}: {
  entries: Entry[]
  acting: number | null
  onAct: (id: number, action: "approve" | "reject" | "promote") => void
  groupName: (id: number) => string
}) {
  return (
    <VirtualList
      items={entries}
      getKey={(e) => e.id}
      gap={8}
      className="h-[400px] pr-3"
      renderItem={(e) => (
        <EntryRow e={e} acting={acting} onAct={onAct} groupName={groupName} />
      )}
    />
  )
}
