"use client"

import { Suspense, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/core/utils"
import {
  MessagesSquare,
  RefreshCw,
  Wrench,
  RotateCcw,
  TriangleAlert,
  Circle,
  Copy,
  UserRound,
  X,
  Eye,
  EyeOff,
  LifeBuoy,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { VirtualList } from "@/components/admin/virtual-list"
import { MasterDetail } from "@/components/admin/master-detail"
import { DataState, EmptyState } from "@/components/admin/data-state"
import { RelativeTime } from "@/components/relative-time"
import { postSessionAction } from "@/components/admin/session-polling"
import type { Filter } from "@/components/admin/sessions/types"
import {
  clock,
  hangLabel,
  isCustomerRole,
} from "@/components/admin/sessions/utils"
import { ChannelBadge } from "@/components/admin/sessions/channel-badge"
import { useSessionSelection } from "@/components/admin/sessions/use-session-selection"

export default function SessionsPage() {
  return (
    <Suspense fallback={<SessionsSkeleton />}>
      <SessionsInner />
    </Suspense>
  )
}

function SessionsSkeleton() {
  return (
    <PageShell fill>
      <Skeleton className="h-12 w-64 shrink-0" />
      <div className="grid min-h-0 min-w-0 flex-1 gap-3 lg:grid-cols-[320px_1fr] lg:gap-4">
        <Skeleton className="h-full min-h-80" />
        <Skeleton className="h-full min-h-80" />
      </div>
    </PageShell>
  )
}

function SessionsInner() {
  const sel = useSessionSelection()
  // 需要在一处保持 TS 收窄(闭包内访问),故取本地常量
  const activeSess = sel.activeSess
  const [resetting, setResetting] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [confirmStep, setConfirmStep] = useState(0)
  const [resetKey, setResetKey] = useState<string | null>(null)

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: sel.stats.total },
    { id: "active", label: "活跃", count: sel.stats.active },
    { id: "human", label: "人工", count: sel.stats.human },
  ]

  const confirmSteps = [
    {
      title: `重开全部 ${sel.sessions?.length ?? 0} 个会话？`,
      desc: "每个会话的下一条消息将开启全新对话，历史记录仍可查看。",
      cta: "继续",
    },
    {
      title: "最后确认",
      desc: "此操作立即生效且不可撤销，机器人将丢失当前对话记忆。",
      cta: "执行全部重开",
    },
  ]

  async function resetAll() {
    setConfirmStep(0)
    setResetting(true)
    try {
      const { response: r } = await postSessionAction(
        "reset_all",
        undefined,
        sel.loadSessions
      )
      if (r.ok) {
        toast.success(`已重开 ${r.data.reset} 个会话`)
      } else toast.error(`重开失败:${r.error}`)
    } catch (e) {
      toast.error(`重开失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setResetting(false)
    }
  }

  async function resetOne(key: string) {
    setResetKey(null)
    try {
      const { response: r } = await postSessionAction(
        "reset",
        key,
        sel.loadSessions
      )
      if (r.ok) {
        toast.success("已重开该会话,下条消息开新对话")
      } else toast.error(`重开失败:${r.error}`)
    } catch (e) {
      toast.error(`重开失败:${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function resumeHandoff(key: string) {
    setResuming(true)
    try {
      const { response: r } = await postSessionAction(
        "resume_handoff",
        key,
        sel.loadSessions
      )
      if (r.ok) {
        toast.success("已恢复自动答")
      } else toast.error(r.error || "恢复失败")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setResuming(false)
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("已复制")
    } catch {
      toast.error("复制失败")
    }
  }

  return (
    <PageShell fill>
      <PageHeader
        className="shrink-0"
        title="会话"
        description="查看群聊对话记录；人工接待中的会话可一键恢复自动答。"
        actions={
          <>
            <Button
              variant="destructive"
              onClick={() => setConfirmStep(1)}
              disabled={resetting || !sel.sessions?.length}
            >
              {resetting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCcw data-icon="inline-start" />
              )}
              全部重开
            </Button>
            <Button
              variant="secondary"
              onClick={() => void sel.refresh()}
              disabled={sel.refreshing}
            >
              {sel.refreshing ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              刷新
            </Button>
          </>
        }
      />

      <MasterDetail
        selected={!!sel.active}
        onBack={sel.closeSession}
        listWidth="340px"
        backLabel="返回会话列表"
        className="min-h-0 flex-1"
        list={
          <SectionCard
            title="会话列表"
            description={`${sel.shown.length} / ${sel.list.length} · 活跃 ${sel.stats.active} · 人工 ${sel.stats.human}`}
            className="flex min-h-0 flex-col overflow-hidden"
            contentClassName="flex min-h-0 flex-1 flex-col gap-2"
          >
            <div className="flex flex-wrap gap-1">
              {filters.map((f) => (
                <Button
                  key={f.id}
                  size="sm"
                  variant={sel.filter === f.id ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => sel.setFilterAndUrl(f.id)}
                >
                  {f.label}
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 tabular-nums"
                  >
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
                value={sel.query}
                onChange={(e) => sel.setQuery(e.target.value)}
                aria-label="搜索会话"
              />
              {sel.query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    onClick={() => sel.setQuery("")}
                    aria-label="清除搜索"
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>

            <DataState
              loading={sel.sessions === null}
              empty={sel.shown.length === 0}
              emptyIcon={MessagesSquare}
              emptyTitle={sel.list.length === 0 ? "暂无会话" : "无匹配会话"}
              emptyDescription={
                sel.list.length === 0
                  ? "生效群产生对话后会在此出现。"
                  : sel.filter !== "all"
                    ? "换个筛选或清空搜索。"
                    : "调整搜索条件。"
              }
              skeleton={<Skeleton className="h-32 w-full" />}
            >
              <VirtualList
                items={sel.shown}
                getKey={(sess) => sess.key}
                estimateSize={64}
                gap={2}
                className="-mr-1 min-h-0 flex-1 pr-1"
                renderItem={(sess) => {
                  const hang = sess.humanMode
                    ? hangLabel(sess.humanSince)
                    : null
                  return (
                    <div
                      className={cn(
                        "group relative flex flex-col gap-0.5 rounded-md border border-transparent px-2 py-1.5 text-xs transition hover:bg-muted",
                        sel.active === sess.key && "border-border bg-muted",
                        sess.humanMode && "border-l-2 border-l-destructive",
                        !sess.sessionId && "opacity-50"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => sel.openSession(sess)}
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
                          <span
                            className="truncate font-medium"
                            title={sess.key}
                          >
                            {sel.keyLabel(sess.key)}
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
                          {hang && (
                            <span className="text-destructive">{hang}</span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetKey(sess.key)}
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
        }
        detail={
          <SectionCard
            title={
              activeSess ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ChannelBadge
                    sessionKey={activeSess.key}
                    className="h-5 px-1.5 text-[11px]"
                  />
                  <span className="truncate" title={activeSess.key}>
                    {sel.keyLabel(activeSess.key)}
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
                : sel.active
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
                      onClick={() => void resumeHandoff(activeSess.key)}
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
                    disabled={!sel.lastBotText}
                    onClick={() =>
                      sel.lastBotText && void copyText(sel.lastBotText)
                    }
                    title="复制最新回复"
                  >
                    <Copy data-icon="inline-start" />
                    复制回复
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => sel.setShowTools((v) => !v)}
                    title={sel.showTools ? "隐藏工具调用" : "显示工具调用"}
                  >
                    {sel.showTools ? (
                      <EyeOff data-icon="inline-start" />
                    ) : (
                      <Eye data-icon="inline-start" />
                    )}
                    工具{sel.toolCount > 0 ? ` ${sel.toolCount}` : ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setResetKey(activeSess.key)}
                  >
                    <RotateCcw data-icon="inline-start" />
                    重开
                  </Button>
                </div>
              ) : undefined
            }
          >
            {!sel.active ? (
              <EmptyState
                icon={MessagesSquare}
                title="未选择会话"
                description="从左侧选择会话查看记录。人工接待中的会话会优先排在前面。"
              />
            ) : (
              <DataState
                loading={sel.loading}
                empty={sel.visibleMsgs.length === 0 && !sel.loading}
                emptyIcon={MessagesSquare}
                emptyTitle={
                  sel.msgs.length > 0 && !sel.showTools
                    ? "仅有工具调用"
                    : "暂无对话记录"
                }
                emptyDescription={
                  sel.msgs.length > 0 && !sel.showTools
                    ? "点右上角「工具」可显示工具调用。"
                    : "对话记录不存在或为空。"
                }
                skeleton={<Skeleton className="m-4 h-40" />}
              >
                <MessageScrollerProvider>
                  <MessageScroller className="min-h-0 flex-1">
                    <MessageScrollerViewport>
                      <MessageScrollerContent className="gap-3 p-4">
                        {sel.visibleMsgs.map((m, i) => {
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
                                        <div className="mb-1 font-medium">
                                          请求
                                        </div>
                                        <pre className="max-h-48 overflow-auto rounded bg-background p-2 whitespace-pre-wrap">
                                          {m.input}
                                        </pre>
                                      </div>
                                    )}
                                    {m.result && (
                                      <div className="mt-2">
                                        <div className="mb-1 font-medium">
                                          响应
                                        </div>
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
                                      onClick={() => void copyText(m.text!)}
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
        }
      />

      <AlertDialog
        open={resetKey !== null}
        onOpenChange={(o) => !o && setResetKey(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
              重开该会话？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {resetKey ? sel.keyLabel(resetKey) : ""}{" "}
              的下一条消息将开启全新对话，历史记录仍可查看。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => resetKey && void resetOne(resetKey)}
            >
              重开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmStep > 0}
        onOpenChange={(o) => !o && setConfirmStep(0)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
              {confirmSteps[confirmStep - 1]?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSteps[confirmStep - 1]?.desc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmStep(0)}>
              取消
            </AlertDialogCancel>
            {confirmStep < 2 ? (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  e.preventBaseUIHandler()
                  setConfirmStep((s) => s + 1)
                }}
              >
                {confirmSteps[confirmStep - 1]?.cta}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                onClick={() => void resetAll()}
              >
                {confirmSteps[1].cta}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  )
}
