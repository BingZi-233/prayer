"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MessagesSquare, RefreshCw, Wrench } from "lucide-react";
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

interface Sess { key: string; sessionId: string | null; updatedAt: number; }
interface Msg { role: string; text?: string; tool?: string; input?: string; result?: string; }

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadSessions() {
    const r = await fetch("/api/sessions").then((x) => x.json());
    if (r.ok) setSessions(r.data);
  }
  useEffect(() => {
    loadSessions();
  }, []);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">会话</h1>
          <p className="text-muted-foreground text-sm">查看历史会话的对话记录(读自 Claude SDK transcript)。</p>
        </div>
        <Button variant="secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          {refreshing ? "刷新中…" : "刷新"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">会话列表</CardTitle>
            <CardDescription>{sessions.length} 个会话</CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无会话。</p>
            ) : (
              <div className="flex flex-col gap-1">
                {sessions.map((sess) => (
                  <button
                    key={sess.key}
                    onClick={() => open(sess)}
                    disabled={!sess.sessionId}
                    className={cn(
                      "hover:bg-muted flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-50",
                      active === sess.key && "bg-muted",
                    )}
                  >
                    <span className="truncate font-mono">{sess.key}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-[560px] flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">{active ? `对话:${active}` : "对话"}</CardTitle>
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
    </div>
  );
}
