"use client"

import { useRef, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/core/utils"

// 通用虚拟列表:只渲染可视区行,变高由 measureElement 的 ResizeObserver 自动重测
// (展开 details、长文本换行都会触发重测)。用于条目数可能上百的后台列表,
// 避免全量 DOM + 滚动 reflow 卡顿。等距估算 estimateSize 只影响初始滚动条,不需精确。
export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 96,
  overscan = 8,
  gap = 0,
  className,
}: {
  items: T[]
  getKey: (item: T, index: number) => string | number
  renderItem: (item: T, index: number) => ReactNode
  // 单行高度初值估算(px);列表变高时会自动重测,仅影响初始滚动条长度
  estimateSize?: number
  overscan?: number
  // 行间距(px),等价于原 flex gap
  gap?: number
  // 加在滚动容器上;须带高度约束(如 h-[400px] 或 flex-1 min-h-0)
  className?: string
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  // tanstack virtual 返回的函数无法被 React Compiler 安全 memo,属已知不兼容库,压掉警告
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (i) => getKey(items[i], i),
  })

  return (
    <div
      ref={parentRef}
      className={cn("min-h-0 min-w-0 overflow-y-auto", className)}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            className="min-w-0"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
              paddingBottom: gap,
            }}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
