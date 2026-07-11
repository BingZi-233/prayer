"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// 共享 master-detail 容器:
// - 桌面(≥breakpoint):双栏 grid [listWidth_1fr],list + detail 同时显示,等价原布局。
// - 手机(<768px):未选中只显示 list 占满;已选中显示 detail,顶部加 sticky 返回条。
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
  const isMobile = useIsMobile();

  // 手机:单栏切换。useIsMobile 首帧(hydration 前)返回 false → 走桌面双栏,安全默认不闪错单栏。
  if (isMobile) {
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

  // 桌面:双栏 grid。gridTemplateColumns 用行内 style 承载动态 listWidth(Tailwind 不能拼动态值)。
  return (
    <div
      className={cn(
        "grid min-h-0 min-w-0 flex-1 gap-4",
        breakpoint === "md" ? "md:grid-cols-[var(--md-cols)]" : "lg:grid-cols-[var(--md-cols)]",
        className,
      )}
      style={{ ["--md-cols" as string]: `minmax(0,${listWidth}) minmax(0,1fr)` }}
    >
      {list}
      {detail}
    </div>
  );
}
