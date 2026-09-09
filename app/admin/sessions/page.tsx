"use client"

import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
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
import { Input } from "@/components/ui/input"
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
import { createSessionListCoordinator } from "@/components/admin/session-polling"
import {
  sessionKeyParts,
  useGroupNames,
  useMemberNames,
} from "@/lib/group-name"

const CHANNEL_LABEL: Record<string, string> = {
  qq: "QQ",
  tg: "TG",
  discord: "Discord",
}

/** 从来源 session key 解析渠道，展示为小徽章 */
function ChannelBadge({
  sessionKey,
  className,
}: {
  sessionKey: string
  className?: string
}) {
  const channel = sessionKeyParts(sessionKey)?.channel ?? "qq"
  const label = CHANNEL_LABEL[channel] ?? channel.toUpperCase()
  return (
    <Badge
      variant="secondary"
      className={cn(
        "h-4 shrink-0 border-transparent bg-foreground px-1 text-[10px] text-background",
        className
      )}
      title={`来源渠道: ${label}`}
    >
      {label}
    </Badge>
  )
}

interface Sess {
  key: string
  sessionId: string | null
  active: boolean
  humanMode?: boolean
  humanSince?: number | null
  lastQuestion: string | null
  updatedAt: number
}
interface Msg {
  role: string
  text?: string
  tool?: string
  input?: string
  result?: string
  ts?: number
  model?: string
}

type Filter = "all" | "active" | "human"

const POLL_MS = 4000

function clock(ts: number | undefined): string {
  if (!ts) return ""
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function hangLabel(since: number | null | undefined): string | null {
  if (!since) return null
  const min = Math.max(0, Math.round((Date.now() - since) / 60_000))
  if (min < 1) return "刚转人工"
  if (min < 60) return `挂起 ${min} 分`
  const h = Math.floor(min / 60)
  return `挂起 ${h} 时 ${min % 60} 分`
}

/** 仅客户(user)靠左,其余(bot / tool / …)一律靠右 */
function isCustomerRole(role: string): boolean {
  return role === "user"
}

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
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_1fr]">
        <Skeleton className="h-full min-h-80" />
        <Skeleton className="h-full min-h-80" />
      </div>
    </PageShell>
  )
}

function SessionsInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [sessions, setSessions] = useState<Sess[] | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [confirmStep, setConfirmStep] = useState(0)
  const [resetKey, setResetKey] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<Filter>(() => {
    // 筛选仅在 URL 明确带 human/active 时初始化一次;之后以本地 filter 为准,避免轮询/导航抖
    if (params.get("human") === "1") return "human"
    if (params.get("active") === "1") return "active"
    return "all"
  })
  const [showTools, setShowTools] = useState(false)

  // 选中态以 ref 为准,避免轮询 / 过期 URL / 过期 fetch 把界面拉回旧会话
  const activeKeyRef = useRef<string | null>(null)
  const activeUpdatedAtRef = useRef<number | null>(null)
  const sessionsRef = useRef<Sess[] | null>(null)
  const mountedRef = useRef(false)
  const isMounted = useCallback(() => mountedRef.current, [])
  const commitSessions = useCallback((next: Sess[] | null) => {
    if (next) {
      sessionsRef.current = next
      setSessions(next)
    }
  }, [])
  const filterRef = useRef(filter)
  const transcriptGenRef = useRef(0)
  // 上次已处理的 URL key;仅在 param 真变化时从 URL 打开,避免 sessions 轮询反复 open
  const lastHandledUrlKeyRef = useRef<string | null | undefined>(undefined)
  // 我们自己 router.replace 写出去的 key,URL 追上前忽略旧 param
  const writingUrlKeyRef = useRef<string | null>(null)

  const { label } = useGroupNames()
  const memberName = useMemberNames((sessions ?? []).map((s) => s.key))

  const keyLabel = useCallback(
    (key: string) => {
      // label 支持 qq:/tg: 三元键与 TG 负 chatId
      const base = label(key)
      const nick = memberName(key)
      if (!nick) return base
      // 有群名片时替换 uid 段:「群名 · uid」→「群名 · 名片」
      const sep = " · "
      const i = base.lastIndexOf(sep)
      if (i < 0) return `${base}${sep}${nick}`
      return `${base.slice(0, i)}${sep}${nick}`
    },
    [memberName, label]
  )

  const syncUrl = useCallback(
    (key: string | null, nextFilter: Filter) => {
      writingUrlKeyRef.current = key
      lastHandledUrlKeyRef.current = key // 视为已处理,防止 effect 再 open 一次
      const sp = new URLSearchParams()
      if (key) sp.set("key", key)
      if (nextFilter === "human") sp.set("human", "1")
      if (nextFilter === "active") sp.set("active", "1")
      const q = sp.toString()
      router.replace(q ? `/admin/sessions?${q}` : "/admin/sessions", {
        scroll: false,
      })
    },
    [router]
  )

  const loadTranscript = useCallback(
    async (sessionId: string, gen: number, forKey: string) => {
      try {
        const r = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}`
        ).then((x) => x.json())
        // 过期请求:用户已切到别的会话
        if (transcriptGenRef.current !== gen || activeKeyRef.current !== forKey)
          return
        if (r.ok && mountedRef.current) setMsgs(r.data as Msg[])
      } catch {
        if (
          transcriptGenRef.current === gen &&
          activeKeyRef.current === forKey
        ) {
          /* 保持旧 msgs 或空 */
        }
      } finally {
        if (
          transcriptGenRef.current === gen &&
          activeKeyRef.current === forKey
        ) {
          if (mountedRef.current) setLoading(false)
        }
      }
    },
    []
  )

  const openSession = useCallback(
    (sess: Sess, opts: { pushUrl?: boolean; forceReload?: boolean } = {}) => {
      const { pushUrl = true, forceReload = false } = opts
      if (!sess.sessionId) {
        toast.message("无对话记录", {
          description: "该会话尚无对话记录（可能刚创建或已过期）。",
        })
        return
      }
      // 已是当前会话且不强制重载 → 只同步 URL
      if (!forceReload && activeKeyRef.current === sess.key) {
        if (pushUrl) syncUrl(sess.key, filterRef.current)
        return
      }

      activeKeyRef.current = sess.key
      activeUpdatedAtRef.current = sess.updatedAt
      setActive(sess.key)
      if (pushUrl) syncUrl(sess.key, filterRef.current)

      const gen = ++transcriptGenRef.current
      setLoading(true)
      // 切换时先清空,避免短暂显示上一会话内容
      setMsgs([])
      void loadTranscript(sess.sessionId, gen, sess.key)
    },
    [loadTranscript, syncUrl]
  )

  // 手机端"返回列表":清空选中态,同步 ref/URL,避免 openSession 因 activeKeyRef 未清而误判"已是当前会话"
  const closeSession = useCallback(() => {
    activeKeyRef.current = null
    setActive(null)
    syncUrl(null, filterRef.current)
  }, [syncUrl])

  const refreshActiveTranscript = useCallback(async (list: Sess[] | null) => {
    try {
      if (!list || !mountedRef.current) return
      const key = activeKeyRef.current
      if (!key) return
      const s = list.find((x) => x.key === key)
      if (!s?.sessionId || activeUpdatedAtRef.current === s.updatedAt) return
      activeUpdatedAtRef.current = s.updatedAt
      const gen = ++transcriptGenRef.current
      const tr = await fetch(
        `/api/sessions/${encodeURIComponent(s.sessionId)}`
      ).then((x) => x.json())
      if (
        mountedRef.current &&
        transcriptGenRef.current === gen &&
        activeKeyRef.current === key &&
        tr.ok
      ) {
        setMsgs(tr.data as Msg[])
      }
    } catch {
      /* 静默 */
    }
  }, [])
  /* eslint-disable react-hooks/refs */
  const sessionCoordinator = useMemo(
    () =>
      createSessionListCoordinator(
        async (): Promise<Sess[] | null> => {
          const r = await fetch("/api/sessions").then((x) => x.json())
          if (r.ok) return r.data as Sess[]
          return null
        },
        // 生命周期由 effect 维护，loader 仅在异步完成时读取该 ref。
        isMounted,
        commitSessions,
        { intervalMs: POLL_MS },
        refreshActiveTranscript
      ),
    [commitSessions, isMounted, refreshActiveTranscript]
  )
  /* eslint-enable react-hooks/refs */
  const loadSessions = sessionCoordinator.loadSessions
  // 仅当 URL 的 key 真的变化时才从外链打开;sessions 轮询不触发
  const paramKey = params.get("key")
  useEffect(() => {
    // 我们自己写 URL 过程中:param 还是旧值 → 忽略
    if (writingUrlKeyRef.current != null) {
      if (paramKey === writingUrlKeyRef.current) {
        writingUrlKeyRef.current = null // URL 已追上
      }
      return
    }
    if (paramKey === lastHandledUrlKeyRef.current) return
    lastHandledUrlKeyRef.current = paramKey

    if (!paramKey) return
    if (activeKeyRef.current === paramKey) return

    const list = sessionsRef.current
    if (!list) return // 列表未就绪:等 sessions 就绪后再试
    const s = list.find((x) => x.key === paramKey)
    if (s) openSession(s, { pushUrl: false })
  }, [paramKey, openSession])

  // 列表首次就绪时,补一次 URL 深链打开
  useEffect(() => {
    if (!sessions?.length) return
    if (writingUrlKeyRef.current != null) return
    const key = paramKey
    if (!key) return
    if (activeKeyRef.current === key) return
    if (lastHandledUrlKeyRef.current === key && activeKeyRef.current) return
    const s = sessions.find((x) => x.key === key)
    if (s) {
      lastHandledUrlKeyRef.current = key
      openSession(s, { pushUrl: false })
    }
    // 只在 sessions 从空到有时配合 paramKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  // 静默轮询列表;transcript 仅在当前会话 updatedAt 变化时刷新
  useEffect(() => {
    mountedRef.current = true
    const poller = sessionCoordinator.poller
    poller.start()
    return () => {
      mountedRef.current = false
      poller.stop()
    }
  }, [sessionCoordinator])

  async function refresh() {
    setRefreshing(true)
    try {
      const list = await loadSessions()
      const key = activeKeyRef.current
      if (key && list) {
        const s = list.find((x) => x.key === key)
        if (s?.sessionId) {
          activeUpdatedAtRef.current = s.updatedAt
          const gen = ++transcriptGenRef.current
          setLoading(true)
          await loadTranscript(s.sessionId, gen, key)
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

  function setFilterAndUrl(f: Filter) {
    setFilter(f)
    filterRef.current = f
    syncUrl(activeKeyRef.current, f)
  }

  const confirmSteps = [
    {
      title: `重开全部 ${sessions?.length ?? 0} 个会话？`,
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
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset_all" }),
      }).then((x) => x.json())
      if (r.ok) {
        await loadSessions()
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
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset", key }),
      }).then((x) => x.json())
      if (r.ok) {
        await loadSessions()
        toast.success("已重开该会话,下条消息开新对话")
      } else toast.error(`重开失败:${r.error}`)
    } catch (e) {
      toast.error(`重开失败:${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function resumeHandoff(key: string) {
    setResuming(true)
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume_handoff", key }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success("已恢复自动答")
        await loadSessions()
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

  const activeSess = useMemo(
    () => (sessions ?? []).find((s) => s.key === active) ?? null,
    [sessions, active]
  )

  const stats = useMemo(() => {
    const all = sessions ?? []
    return {
      total: all.length,
      active: all.filter((s) => s.active).length,
      human: all.filter((s) => s.humanMode).length,
    }
  }, [sessions])

  const list = useMemo(() => {
    let base = sessions ?? []
    if (filter === "human") base = base.filter((s) => s.humanMode)
    else if (filter === "active") base = base.filter((s) => s.active)
    return [...base].sort((a, b) => {
      if (!!b.humanMode !== !!a.humanMode) return a.humanMode ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [sessions, filter])

  const shown = useMemo(() => {
    if (!deferredQuery.trim()) return list
    const q = deferredQuery.toLowerCase()
    return list.filter(
      (s) =>
        s.key.toLowerCase().includes(q) ||
        keyLabel(s.key).toLowerCase().includes(q) ||
        (s.lastQuestion ?? "").toLowerCase().includes(q)
    )
  }, [list, deferredQuery, keyLabel])

  const visibleMsgs = useMemo(
    () => (showTools ? msgs : msgs.filter((m) => m.role !== "tool")),
    [msgs, showTools]
  )

  const toolCount = useMemo(
    () => msgs.filter((m) => m.role === "tool").length,
    [msgs]
  )

  const lastBotText = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i].text) return msgs[i].text!
    }
    return null
  }, [msgs])

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: stats.total },
    { id: "active", label: "活跃", count: stats.active },
    { id: "human", label: "人工", count: stats.human },
  ]

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
              size="sm"
              onClick={() => setConfirmStep(1)}
              disabled={resetting || !sessions?.length}
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
              size="sm"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {refreshing ? (
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
        selected={!!active}
        onBack={closeSession}
        listWidth="340px"
        backLabel="返回会话列表"
        className="min-h-0 flex-1"
        list={
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
                  <Badge
                    variant="secondary"
                    className="ml-1 h-4 px-1 tabular-nums"
                  >
                    {f.count}
                  </Badge>
                </Button>
              ))}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索群名 / 昵称 / 问题…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pr-8 pl-8 text-xs"
              />
              {query && (
                <button
                  type="button"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="清除搜索"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <DataState
              loading={sessions === null}
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
                  const hang = sess.humanMode
                    ? hangLabel(sess.humanSince)
                    : null
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
                        onClick={() => openSession(sess)}
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
                    disabled={!lastBotText}
                    onClick={() => lastBotText && void copyText(lastBotText)}
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
                    onClick={() => setResetKey(activeSess.key)}
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
                  msgs.length > 0 && !showTools
                    ? "仅有工具调用"
                    : "暂无对话记录"
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
              {resetKey ? keyLabel(resetKey) : ""}{" "}
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
