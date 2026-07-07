"use client";

import { Suspense, useDeferredValue, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MessagesSquare, RefreshCw, Wrench, RotateCcw, TriangleAlert, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { DataState, EmptyState } from "@/components/admin/data-state";
import { RelativeTime } from "@/components/relative-time";
import { useGroupNames, useMemberNames } from "@/lib/group-name";

interface Sess {
  key: string;
  sessionId: string | null;
  active: boolean;
  lastQuestion: string | null;
  updatedAt: number;
}
interface Msg { role: string; text?: string; tool?: string; input?: string; result?: string; ts?: number; model?: string; }

const POLL_MS = 3000;

// 气泡内联时间戳(HH:mm),非相对时间 → 不走 RelativeTime
function clock(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function SessionsPage() {
  return (
    <Suspense fallback={null}>
      <SessionsInner />
    </Suspense>
  );
}

function SessionsInner() {
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);
  // 三步确认:0 关闭,1/2/3 逐级确认弹窗(全部重开)
  const [confirmStep, setConfirmStep] = useState(0);
  // 单会话重开的目标 key(null = 关闭);单步确认
  const [resetKey, setResetKey] = useState<string | null>(null);
  const { name } = useGroupNames();
  const memberName = useMemberNames((sessions ?? []).map((s) => s.key));
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query); // 输入不阻塞过滤,免逐字符重渲

  // session key "gid:uid" → "群名 · 群昵称";昵称查不到回退 uid;非法 key 原样
  const keyLabel = (key: string) => {
    const [gid, uid] = key.split(":");
    const g = Number(gid);
    if (!gid || Number.isNaN(g)) return key;
    const who = memberName(key) || uid || "";
    return who ? `${name(g)} · ${who}` : name(g);
  };

  async function loadSessions() {
    const r = await fetch("/api/sessions").then((x) => x.json());
    if (r.ok) setSessions(r.data);
  }
  useEffect(() => {
    loadSessions();
  }, []);

  // URL ?key=... → 自动打开对应会话
  useEffect(() => {
    const key = params.get("key");
    if (!key || !sessions) return;
    const s = sessions.find((x) => x.key === key);
    if (s && active !== s.key) open(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, params]);

  // 列表自动轮询(3s);标签页隐藏时跳过,选中会话有更新则一并刷 transcript
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function loadTranscript(sessionId: string) {
    const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`).then((x) => x.json());
    if (r.ok) setMsgs(r.data);
  }

  async function open(sess: Sess) {
    if (!sess.sessionId) return;
    setActive(sess.key);
    setLoading(true);
    try {
      await loadTranscript(sess.sessionId);
    } finally {
      setLoading(false);
    }
  }

  // 刷新:重拉会话列表 + 当前选中会话的 transcript(对话有更新时可见)
  async function refresh() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/sessions").then((x) => x.json());
      if (!r.ok) return;
      setSessions(r.data);
      if (active) {
        const s = (r.data as Sess[]).find((x) => x.key === active);
        if (s?.sessionId) await loadTranscript(s.sessionId);
      }
    } finally {
      setRefreshing(false);
    }
  }

  // 三步确认文案(逐级加重),第三步 CTA 执行重开
  const confirmSteps = [
    {
      title: `重开全部 ${sessions?.length ?? 0} 个会话?`,
      desc: "每个会话下条消息将各自开启全新对话,历史记录仍保留可查。",
      cta: "继续",
    },
    {
      title: "二次确认",
      desc: "此操作会清空所有会话的续接上下文,机器人将丢失当前对话记忆。确定继续?",
      cta: "我了解,继续",
    },
    {
      title: "最后确认",
      desc: "该操作立即生效且不可撤销。点下方按钮执行全部重开。",
      cta: "执行全部重开",
    },
  ];

  // 一键重开:清所有会话 resume_id,每个会话下条消息各自开全新对话(历史仍可查)
  async function resetAll() {
    setConfirmStep(0);
    setResetting(true);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset_all" }),
      }).then((x) => x.json());
      if (r.ok) {
        await loadSessions();
        toast.success(`已重开 ${r.data.reset} 个会话,下条消息各自开新对话`);
      } else {
        toast.error(`重开失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`重开失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResetting(false);
    }
  }

  // 单会话重开:只清该会话 resume_id
  async function resetOne(key: string) {
    setResetKey(null);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset", key }),
      }).then((x) => x.json());
      if (r.ok) {
        await loadSessions();
        toast.success("已重开该会话,下条消息开新对话");
      } else {
        toast.error(`重开失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`重开失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const list = sessions ?? [];
  const activeCount = list.filter((s) => s.active).length;
  const shown = list.filter((s) => {
    if (!deferredQuery.trim()) return true;
    const q = deferredQuery.toLowerCase();
    return (
      s.key.toLowerCase().includes(q) ||
      keyLabel(s.key).toLowerCase().includes(q) ||
      (s.lastQuestion ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-0 flex-col gap-6">
      <PageHeader
        title="会话"
        description="查看历史会话的对话记录(读自 Claude SDK transcript)。"
        actions={
          <>
            <Button
              variant="destructive"
              onClick={() => setConfirmStep(1)}
              disabled={resetting || list.length === 0}
            >
              {resetting ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
              {resetting ? "重开中…" : "全部重开"}
            </Button>
            <Button variant="secondary" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              {refreshing ? "刷新中…" : "刷新"}
            </Button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_1fr]">
        <SectionCard
          title="会话列表"
          description={`${shown.length} / ${list.length} 个 · ${activeCount} 活跃`}
          className="flex min-h-0 flex-col overflow-hidden"
          contentClassName="flex min-h-0 flex-1 flex-col gap-2"
        >
          <Input
            placeholder="搜索群名 / QQ / 问题…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-xs"
          />
          <DataState
            loading={sessions === null}
            empty={shown.length === 0}
            emptyIcon={MessagesSquare}
            emptyTitle={list.length === 0 ? "暂无会话" : "无匹配会话"}
            emptyDescription={list.length === 0 ? "生效群产生对话后会在此出现。" : "调整搜索条件。"}
            skeleton={<Skeleton className="h-32 w-full" />}
          >
            <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
              {shown.map((sess) => (
                <div
                  key={sess.key}
                  className={cn(
                    "group hover:bg-muted relative flex flex-col gap-1 rounded-md px-2 py-1.5 text-xs",
                    active === sess.key && "bg-muted",
                    !sess.sessionId && "opacity-50",
                  )}
                >
                  <button
                    onClick={() => open(sess)}
                    disabled={!sess.sessionId}
                    className="flex flex-col gap-1 text-left disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-1.5">
                      <Circle
                        className={cn(
                          "size-2 shrink-0",
                          sess.active ? "fill-emerald-500 text-emerald-500" : "fill-muted-foreground/40 text-muted-foreground/40",
                        )}
                      />
                      <span className="truncate" title={sess.key}>{keyLabel(sess.key)}</span>
                    </span>
                    {sess.lastQuestion && (
                      <span className="text-muted-foreground truncate">Q: {sess.lastQuestion}</span>
                    )}
                    <span className="text-muted-foreground/70">
                      <RelativeTime ts={sess.updatedAt} />
                    </span>
                  </button>
                  {/* 悬停出单会话重开 */}
                  <button
                    onClick={() => setResetKey(sess.key)}
                    title="重开该会话"
                    className="text-muted-foreground hover:text-destructive absolute top-1.5 right-1.5 opacity-0 transition group-hover:opacity-100"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </DataState>
        </SectionCard>

        <SectionCard
          title={
            <span className="truncate" title={active ?? undefined}>
              {active ? `对话:${keyLabel(active)}` : "对话"}
            </span>
          }
          className="flex min-h-0 flex-col overflow-hidden"
          contentClassName="min-h-0 flex-1 p-0"
        >
          {!active ? (
            <EmptyState
              icon={MessagesSquare}
              title="未选择会话"
              description="从左侧选择一个会话查看其对话记录。"
            />
          ) : (
            <DataState
              loading={loading}
              empty={msgs.length === 0}
              emptyIcon={MessagesSquare}
              emptyTitle="无 transcript"
              emptyDescription="session 文件未找到或为空。"
              skeleton={<Skeleton className="m-4 h-40" />}
            >
              <MessageScrollerProvider>
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="gap-3 p-4">
                      {msgs.map((m, i) => {
                        // inline style 覆盖组件基类的 content-visibility:auto + contain-intrinsic-size:10rem
                        // (tailwind-merge 不去重 arbitrary property,占位 10rem 会产生巨大空隙)
                        const itemStyle = { contentVisibility: "visible", containIntrinsicSize: "auto" } as const;
                        // 工具调用(Agent 发起)—— 左对齐,可折叠查看请求 / 响应
                        if (m.role === "tool") {
                          return (
                            <MessageScrollerItem key={i} messageId={String(i)} style={itemStyle}>
                              <details className="bg-muted/50 text-muted-foreground w-fit max-w-[85%] rounded-lg border px-2.5 py-1.5 text-xs">
                                <summary className="flex cursor-pointer items-center gap-1.5 select-none">
                                  <Wrench className="size-3 shrink-0" />
                                  工具调用:<span className="text-foreground font-medium">{m.tool}</span>
                                </summary>
                                {m.input && (
                                  <div className="mt-2">
                                    <div className="mb-1 font-medium">请求</div>
                                    <pre className="bg-background overflow-auto rounded p-2 whitespace-pre-wrap">{m.input}</pre>
                                  </div>
                                )}
                                {m.result && (
                                  <div className="mt-2">
                                    <div className="mb-1 font-medium">响应</div>
                                    <pre className="bg-background overflow-auto rounded p-2 whitespace-pre-wrap">{m.result}</pre>
                                  </div>
                                )}
                              </details>
                            </MessageScrollerItem>
                          );
                        }
                        if (!m.text) return null;
                        const isUser = m.role === "user";
                        return (
                          <MessageScrollerItem key={i} messageId={String(i)} scrollAnchor={isUser} style={itemStyle}>
                            <Message align={isUser ? "end" : "start"}>
                              <MessageContent>
                                <Bubble variant={isUser ? "default" : "muted"}>
                                  <BubbleContent className="whitespace-pre-wrap">{m.text}</BubbleContent>
                                </Bubble>
                                {/* 时间 + assistant 模型标 */}
                                <span
                                  className={cn(
                                    "text-muted-foreground/70 mt-0.5 flex items-center gap-1.5 text-[10px]",
                                    isUser && "justify-end",
                                  )}
                                >
                                  {clock(m.ts)}
                                  {!isUser && m.model && (
                                    <Badge variant="outline" className="h-4 px-1 py-0 text-[10px] font-normal">
                                      {m.model}
                                    </Badge>
                                  )}
                                </span>
                              </MessageContent>
                            </Message>
                          </MessageScrollerItem>
                        );
                      })}
                    </MessageScrollerContent>
                    <MessageScrollerButton />
                  </MessageScrollerViewport>
                </MessageScroller>
              </MessageScrollerProvider>
            </DataState>
          )}
        </SectionCard>
      </div>

      {/* 单会话重开确认(单步) */}
      <AlertDialog open={resetKey !== null} onOpenChange={(o) => !o && setResetKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="text-destructive size-5" />
              重开该会话?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {resetKey ? keyLabel(resetKey) : ""} 的下条消息将开启全新对话,历史记录仍保留可查。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => resetKey && resetOne(resetKey)}
            >
              重开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 全部重开三步确认 */}
      <AlertDialog open={confirmStep > 0} onOpenChange={(o) => !o && setConfirmStep(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="text-destructive size-5" />
              {confirmSteps[confirmStep - 1]?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirmSteps[confirmStep - 1]?.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmStep(0)}>取消</AlertDialogCancel>
            {confirmStep < 3 ? (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault(); // 阻止默认关闭,推进到下一步
                  setConfirmStep((s) => s + 1);
                }}
              >
                {confirmSteps[confirmStep - 1]?.cta}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                onClick={resetAll}
              >
                {confirmSteps[2].cta}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
