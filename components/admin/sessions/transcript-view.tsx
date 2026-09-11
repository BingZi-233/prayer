import type { Dispatch, SetStateAction } from "react"
import {
  MessagesSquare,
  Wrench,
  Copy,
  UserRound,
  Eye,
  EyeOff,
  LifeBuoy,
  RotateCcw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { SectionCard } from "@/components/admin/section-card"
import { DataState, EmptyState } from "@/components/admin/data-state"
import { cn } from "@/lib/core/utils"
import { ChannelBadge } from "./channel-badge"
import { clock, isCustomerRole } from "./utils"
import type { Sess, Msg } from "./types"

interface TranscriptViewProps {
  active: string | null
  activeSess: Sess | null
  keyLabel: (key: string) => string
  loading: boolean
  msgs: Msg[]
  visibleMsgs: Msg[]
  toolCount: number
  showTools: boolean
  setShowTools: Dispatch<SetStateAction<boolean>>
  lastBotText: string | null
  resuming: boolean
  onResumeHandoff: (key: string) => void
  onCopyText: (text: string) => void
  onResetOne: (key: string) => void
}

export function TranscriptView({
  active,
  activeSess,
  keyLabel,
  loading,
  msgs,
  visibleMsgs,
  toolCount,
  showTools,
  setShowTools,
  lastBotText,
  resuming,
  onResumeHandoff,
  onCopyText,
  onResetOne,
}: TranscriptViewProps) {
  return (
    <SectionCard
      title={
        activeSess ? (
          <span className="flex min-w-0 items-center gap-2">
            <ChannelBadge
              sessionKey={activeSess.key}
              className="h-5 px-1.5 text-[11px]"
            />
            <span className="truncate" title={activeSess.key}>
              {keyLabel(activeSess.key)}
            </span>
            {activeSess.humanMode && (
              <Badge variant="destructive" className="shrink-0 gap-1">
                <UserRound className="size-3" />
                人工接待
              </Badge>
            )}
            {activeSess.active ? (
              <Badge variant="secondary" className="shrink-0">
                活跃
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">
                已结束
              </Badge>
            )}
          </span>
        ) : (
          "对话"
        )
      }
      description={
        activeSess?.lastQuestion
          ? activeSess.lastQuestion
          : active
            ? "对话记录"
            : undefined
      }
      className="flex min-h-0 flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col p-0"
      action={
        activeSess ? (
          <div className="flex flex-wrap items-center gap-1">
            {activeSess.humanMode && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                disabled={resuming}
                onClick={() => void onResumeHandoff(activeSess.key)}
              >
                {resuming ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <LifeBuoy data-icon="inline-start" />
                )}
                恢复自动答
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!lastBotText}
              onClick={() => lastBotText && void onCopyText(lastBotText)}
              title="复制最新回复"
            >
              <Copy data-icon="inline-start" />
              复制回复
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowTools((v) => !v)}
              title={showTools ? "隐藏工具调用" : "显示工具调用"}
            >
              {showTools ? (
                <EyeOff data-icon="inline-start" />
              ) : (
                <Eye data-icon="inline-start" />
              )}
              工具{toolCount > 0 ? ` ${toolCount}` : ""}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onResetOne(activeSess.key)}
            >
              <RotateCcw data-icon="inline-start" />
              重开
            </Button>
          </div>
        ) : undefined
      }
    >
      {!active ? (
        <EmptyState
          icon={MessagesSquare}
          title="未选择会话"
          description="从左侧选择会话查看记录。人工接待中的会话会优先排在前面。"
        />
      ) : (
        <DataState
          loading={loading}
          empty={visibleMsgs.length === 0 && !loading}
          emptyIcon={MessagesSquare}
          emptyTitle={
            msgs.length > 0 && !showTools ? "仅有工具调用" : "暂无对话记录"
          }
          emptyDescription={
            msgs.length > 0 && !showTools
              ? "点右上角「工具」可显示工具调用。"
              : "对话记录不存在或为空。"
          }
          skeleton={<Skeleton className="m-4 h-40" />}
        >
          <MessageScrollerProvider>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="gap-3 p-4">
                  {visibleMsgs.map((m, i) => {
                    const itemStyle = {
                      contentVisibility: "visible",
                      containIntrinsicSize: "auto",
                    } as const
                    const customer = isCustomerRole(m.role)

                    if (m.role === "tool") {
                      return (
                        <MessageScrollerItem
                          key={i}
                          messageId={String(i)}
                          style={itemStyle}
                        >
                          <div className="flex w-full justify-end">
                            <details className="w-fit max-w-[min(90%,36rem)] rounded-lg border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                              <summary className="flex cursor-pointer items-center gap-1.5 select-none">
                                <Wrench className="size-3 shrink-0" />
                                工具:
                                <span className="font-medium text-foreground">
                                  {m.tool}
                                </span>
                                {m.ts ? (
                                  <span className="ml-1 text-muted-foreground/70">
                                    {clock(m.ts)}
                                  </span>
                                ) : null}
                              </summary>
                              {m.input && (
                                <div className="mt-2">
                                  <div className="mb-1 font-medium">请求</div>
                                  <pre className="max-h-48 overflow-auto rounded bg-background p-2 whitespace-pre-wrap">
                                    {m.input}
                                  </pre>
                                </div>
                              )}
                              {m.result && (
                                <div className="mt-2">
                                  <div className="mb-1 font-medium">响应</div>
                                  <pre className="max-h-48 overflow-auto rounded bg-background p-2 whitespace-pre-wrap">
                                    {m.result}
                                  </pre>
                                </div>
                              )}
                            </details>
                          </div>
                        </MessageScrollerItem>
                      )
                    }
                    if (!m.text) return null

                    return (
                      <MessageScrollerItem
                        key={i}
                        messageId={String(i)}
                        scrollAnchor={customer}
                        style={itemStyle}
                      >
                        <div
                          className={cn(
                            "flex w-full",
                            customer ? "justify-start" : "justify-end"
                          )}
                        >
                          <div
                            className={cn(
                              "flex w-fit max-w-[min(85%,36rem)] flex-col gap-0.5",
                              customer ? "items-start" : "items-end"
                            )}
                          >
                            <div className="group/bubble relative w-fit max-w-full">
                              <Bubble
                                align={customer ? "start" : "end"}
                                variant={customer ? "muted" : "default"}
                                className="max-w-full"
                              >
                                <BubbleContent className="whitespace-pre-wrap">
                                  {m.text}
                                </BubbleContent>
                              </Bubble>
                              <button
                                type="button"
                                title="复制"
                                className={cn(
                                  "absolute -top-1 rounded bg-background/90 p-1 text-muted-foreground opacity-0 shadow transition group-hover/bubble:opacity-100 hover:text-foreground",
                                  customer ? "-right-1" : "-left-1"
                                )}
                                onClick={() => void onCopyText(m.text!)}
                              >
                                <Copy className="size-3" />
                              </button>
                            </div>
                            <span
                              className={cn(
                                "flex items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground/70",
                                !customer && "flex-row-reverse"
                              )}
                            >
                              <span className="text-muted-foreground/50">
                                {customer
                                  ? "客户"
                                  : m.role === "assistant"
                                    ? "机器人"
                                    : m.role}
                              </span>
                              {clock(m.ts)}
                              {!customer && m.model && (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 py-0 text-[10px] font-normal"
                                >
                                  {m.model}
                                </Badge>
                              )}
                            </span>
                          </div>
                        </div>
                      </MessageScrollerItem>
                    )
                  })}
                </MessageScrollerContent>
                <MessageScrollerButton />
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        </DataState>
      )}
    </SectionCard>
  )
}
