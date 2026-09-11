"use client"

import { Suspense, useState } from "react"
import { toast } from "sonner"
import { RefreshCw, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { MasterDetail } from "@/components/admin/master-detail"
import { postSessionAction } from "@/components/admin/session-polling"
import { useSessionSelection } from "@/components/admin/sessions/use-session-selection"
import { SessionList } from "@/components/admin/sessions/session-list"
import { TranscriptView } from "@/components/admin/sessions/transcript-view"
import { SessionDialogs } from "@/components/admin/sessions/session-dialogs"

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
  const [resetting, setResetting] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [confirmStep, setConfirmStep] = useState(0)
  const [resetKey, setResetKey] = useState<string | null>(null)

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
          <SessionList
            shown={sel.shown}
            list={sel.list}
            stats={sel.stats}
            loading={sel.sessions === null}
            filter={sel.filter}
            query={sel.query}
            setQuery={sel.setQuery}
            setFilterAndUrl={sel.setFilterAndUrl}
            active={sel.active}
            keyLabel={sel.keyLabel}
            onOpen={sel.openSession}
            onResetOne={setResetKey}
          />
        }
        detail={
          <TranscriptView
            active={sel.active}
            activeSess={sel.activeSess}
            keyLabel={sel.keyLabel}
            loading={sel.loading}
            msgs={sel.msgs}
            visibleMsgs={sel.visibleMsgs}
            toolCount={sel.toolCount}
            showTools={sel.showTools}
            setShowTools={sel.setShowTools}
            lastBotText={sel.lastBotText}
            resuming={resuming}
            onResumeHandoff={resumeHandoff}
            onCopyText={copyText}
            onResetOne={setResetKey}
          />
        }
      />

      <SessionDialogs
        resetKey={resetKey}
        setResetKey={setResetKey}
        confirmStep={confirmStep}
        setConfirmStep={setConfirmStep}
        keyLabel={sel.keyLabel}
        sessionsCount={sel.sessions?.length ?? 0}
        onResetOne={resetOne}
        onResetAll={resetAll}
      />
    </PageShell>
  )
}
