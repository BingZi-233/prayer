import {
  MessagesSquare,
  Search,
  RotateCcw,
  X,
  Circle,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { SectionCard } from "@/components/admin/section-card"
import { VirtualList } from "@/components/admin/virtual-list"
import { DataState } from "@/components/admin/data-state"
import { RelativeTime } from "@/components/relative-time"
import { cn } from "@/lib/core/utils"
import { ChannelBadge } from "./channel-badge"
import { hangLabel } from "./utils"
import type { Sess, Filter } from "./types"

interface SessionListProps {
  shown: Sess[]
  list: Sess[]
  stats: { total: number; active: number; human: number }
  loading: boolean
  filter: Filter
  query: string
  setQuery: (q: string) => void
  setFilterAndUrl: (f: Filter) => void
  active: string | null
  keyLabel: (key: string) => string
  onOpen: (sess: Sess) => void
  onResetOne: (key: string) => void
}

export function SessionList({
  shown,
  list,
  stats,
  loading,
  filter,
  query,
  setQuery,
  setFilterAndUrl,
  active,
  keyLabel,
  onOpen,
  onResetOne,
}: SessionListProps) {
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: stats.total },
    { id: "active", label: "活跃", count: stats.active },
    { id: "human", label: "人工", count: stats.human },
  ]
  return (
    <SectionCard
      title="会话列表"
      description={`${shown.length} / ${list.length} · 活跃 ${stats.active} · 人工 ${stats.human}`}
      className="flex min-h-0 flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col gap-2"
    >
      <div className="flex flex-wrap gap-1">
        {filters.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setFilterAndUrl(f.id)}
          >
            {f.label}
            <Badge variant="secondary" className="ml-1 h-4 px-1 tabular-nums">
              {f.count}
            </Badge>
          </Button>
        ))}
      </div>

      <InputGroup className="bg-background">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="搜索群名 / 昵称 / 问题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索会话"
        />
        {query && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      <DataState
        loading={loading}
        empty={shown.length === 0}
        emptyIcon={MessagesSquare}
        emptyTitle={list.length === 0 ? "暂无会话" : "无匹配会话"}
        emptyDescription={
          list.length === 0
            ? "生效群产生对话后会在此出现。"
            : filter !== "all"
              ? "换个筛选或清空搜索。"
              : "调整搜索条件。"
        }
        skeleton={<Skeleton className="h-32 w-full" />}
      >
        <VirtualList
          items={shown}
          getKey={(sess) => sess.key}
          estimateSize={64}
          gap={2}
          className="-mr-1 min-h-0 flex-1 pr-1"
          renderItem={(sess) => {
            const hang = sess.humanMode ? hangLabel(sess.humanSince) : null
            return (
              <div
                className={cn(
                  "group relative flex flex-col gap-0.5 rounded-md border border-transparent px-2 py-1.5 text-xs transition hover:bg-muted",
                  active === sess.key && "border-border bg-muted",
                  sess.humanMode && "border-l-2 border-l-destructive",
                  !sess.sessionId && "opacity-50"
                )}
              >
                <button
                  type="button"
                  onClick={() => onOpen(sess)}
                  className="flex flex-col gap-0.5 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    <Circle
                      className={cn(
                        "size-2 shrink-0",
                        sess.active
                          ? "fill-primary text-primary"
                          : "fill-muted-foreground/40 text-muted-foreground/40"
                      )}
                    />
                    <ChannelBadge sessionKey={sess.key} />
                    <span className="truncate font-medium" title={sess.key}>
                      {keyLabel(sess.key)}
                    </span>
                    {sess.humanMode && (
                      <Badge
                        variant="destructive"
                        className="h-4 shrink-0 gap-0.5 px-1 text-[10px]"
                      >
                        <UserRound className="size-2.5" />
                        人工
                      </Badge>
                    )}
                  </span>
                  {sess.lastQuestion ? (
                    <span className="line-clamp-2 pl-3.5 leading-snug text-muted-foreground">
                      {sess.lastQuestion}
                    </span>
                  ) : (
                    <span className="pl-3.5 text-muted-foreground/60 italic">
                      暂无问题摘要
                    </span>
                  )}
                  <span className="flex items-center gap-2 pl-3.5 text-muted-foreground/70">
                    <RelativeTime ts={sess.updatedAt} />
                    {hang && <span className="text-destructive">{hang}</span>}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onResetOne(sess.key)}
                  title="重开该会话"
                  className="absolute top-1.5 right-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </div>
            )
          }}
        />
      </DataState>
    </SectionCard>
  )
}
