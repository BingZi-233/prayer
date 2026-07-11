"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// Tailwind 断点像素值(与下方 md:/lg: 前缀一一对应)
const BP_PX = { md: 768, lg: 1024 } as const;

// 单栏阈值随 breakpoint 对齐:视口低于该断点走手机单栏,
// 避免与 CSS 双栏起点错位产生"死区"(如 768–1023px)。
// SSR/首帧返回 false → 默认桌面双栏,无 hydration 错位。
function useNarrow(breakpoint: "md" | "lg") {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${BP_PX[breakpoint] - 1}px)`);
    const on = () => setNarrow(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [breakpoint]);
  return narrow;
}

// 共享 master-detail 容器:
// - 桌面(≥breakpoint):双栏 grid [listWidth_1fr],list + detail 同时显示,等价原布局。
// - 手机(<breakpoint):未选中只显示 list 占满;已选中显示 detail,顶部加返回条。
// sessions / kb 共用,避免复制单栏切换逻辑。
export function MasterDetail({
  selected,
  onBack,
  list,
  detail,
  listWidth = "340px",
  backLabel = "返回",
  breakpoint = "lg",
  className,
}: {
  selected: boolean;
  onBack: () => void;
  list: ReactNode;
  detail: ReactNode;
  listWidth?: string;
  backLabel?: string;
  breakpoint?: "md" | "lg";
  className?: string;
}) {
  const narrow = useNarrow(breakpoint);

  if (narrow) {
    if (!selected) {
      return <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>{list}</div>;
    }
    return (
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground -mx-1 mb-2 flex h-11 shrink-0 items-center gap-1 px-1 text-sm"
        >
          <ChevronLeft className="size-4" />
          {backLabel}
        </button>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{detail}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid min-h-0 min-w-0 flex-1 gap-4",
        breakpoint === "md" ? "md:grid-cols-[var(--cols)]" : "lg:grid-cols-[var(--cols)]",
        className,
      )}
      style={{ ["--cols" as string]: `minmax(0,${listWidth}) minmax(0,1fr)` }}
    >
      {list}
      {detail}
    </div>
  );
}
