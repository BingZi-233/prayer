"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MessagesSquare, RefreshCw, Wrench, UserRound, RotateCcw, TriangleAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { useGroupNames, useMemberNames } from "@/lib/group-name";

interface Sess { key: string; sessionId: string | null; humanMode: boolean; humanSince: number | null; lastQuestion: string | null; updatedAt: number; }
interface Msg { role: string; text?: string; tool?: string; input?: string; result?: string; }

function since(ts: number | null): string {
  if (!ts) return "";
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`;
}

export default function SessionsPage() {
  return (
    <Suspense fallback={null}>
      <SessionsInner />
    </Suspense>
  );
}

function SessionsInner() {
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);
  // 三步确认:0 关闭,1/2/3 逐级确认弹窗
  const [confirmStep, setConfirmStep] = useState(0);
  const { name } = useGroupNames();
  const memberName = useMemberNames(sessions.map((s) => s.key));
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [humanOnly, setHumanOnly] = useState(params.get("human") === "1");

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
    if (!key) return;
    const s = sessions.find((x) => x.key === key);
    if (s && active !== s.key) open(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, params]);

  // 列表自动轮询(3s);选中会话有更新则一并刷新 transcript(复用 refresh)
  useEffect(() => {
    const t = setInterval(refresh, 3000);
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
      title: `重开全部 ${sessions.length} 个会话?`,
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

  const shown = sessions
    .filter((s) => (humanOnly ? s.humanMode : true))
    .filter((s) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        s.key.toLowerCase().includes(q) ||
        keyLabel(s.key).toLowerCase().includes(q) ||
        (s.lastQuestion ?? "").toLowerCase().includes(q)
      );
    })
    // 人工优先置顶,其余保持 updatedAt DESC(接口已排序)
    .sort((a, b) => Number(b.humanMode) - Number(a.humanMode));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">会话</h1>
          <p className="text-muted-foreground text-sm">查看历史会话的对话记录(读自 Claude SDK transcript)。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            onClick={() => setConfirmStep(1)}
            disabled={resetting || sessions.length === 0}
          >
            {resetting ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
            {resetting ? "重开中…" : "全部重开"}
          </Button>
          <Button variant="secondary" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            {refreshing ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">会话列表</CardTitle>
            <CardDescription>{shown.length} / {sessions.length} 个会话</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Input
              placeholder="搜索群名 / QQ / 问题…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-xs"
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={humanOnly} onCheckedChange={(v) => setHumanOnly(!!v)} />
              仅看人工会话
            </label>
            {shown.length === 0 ? (
              <p className="text-muted-foreground text-sm">{sessions.length === 0 ? "暂无会话。" : "无匹配会话。"}</p>
            ) : (
              <div className="flex flex-col gap-1">
                {shown.map((sess) => (
                  <button
                    key={sess.key}
                    onClick={() => open(sess)}
                    disabled={!sess.sessionId}
                    className={cn(
                      "hover:bg-muted flex flex-col gap-1 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-50",
                      active === sess.key && "bg-muted",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate" title={sess.key}>{keyLabel(sess.key)}</span>
                      {sess.humanMode && (
                        <Badge variant="destructive" className="shrink-0 gap-1">
                          <UserRound className="size-3" />
                          人工{sess.humanSince ? ` ${since(sess.humanSince)}` : ""}
                        </Badge>
                      )}
                    </span>
                    {sess.lastQuestion && (
                      <span className="text-muted-foreground truncate">Q: {sess.lastQuestion}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-[560px] flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm" title={active ?? undefined}>{active ? `对话:${keyLabel(active)}` : "对话"}</CardTitle>
            {active && (
              <Button variant="ghost" size="icon-sm" onClick={refresh} disabled={refreshing} title="刷新对话">
                {refreshing ? <Spinner /> : <RefreshCw />}
                <span className="sr-only">刷新对话</span>
              </Button>
            )}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            {!active ? (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessagesSquare />
                  </EmptyMedia>
                  <EmptyTitle>未选择会话</EmptyTitle>
                  <EmptyDescription>从左侧选择一个会话查看其对话记录。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : loading ? (
              <p className="text-muted-foreground p-4 text-sm">加载中…</p>
            ) : msgs.length === 0 ? (
              <p className="text-muted-foreground p-4 text-sm">无 transcript(session 文件未找到或为空)。</p>
            ) : (
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
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmStep > 0} onOpenChange={(o) => !o && setConfirmStep(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
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
