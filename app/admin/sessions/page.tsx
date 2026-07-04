"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MessagesSquare, Wrench } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface Sess { key: string; sessionId: string | null; humanMode: boolean; updatedAt: number; }
interface Msg { role: string; text?: string; tool?: string; input?: string; result?: string; }

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadSessions() {
    const r = await fetch("/api/sessions").then((x) => x.json());
    if (r.ok) setSessions(r.data);
  }
  useEffect(() => {
    loadSessions();
  }, []);

  async function open(sess: Sess) {
    if (!sess.sessionId) return;
    setActive(sess.key);
    setLoading(true);
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sess.sessionId)}`).then((x) => x.json());
      if (r.ok) setMsgs(r.data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">会话</h1>
        <p className="text-muted-foreground text-sm">查看历史会话的对话记录(读自 Claude SDK transcript)。</p>
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
                    {sess.humanMode && <Badge variant="secondary" className="shrink-0">人工</Badge>}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-[560px] flex-col overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">{active ? `对话:${active}` : "对话"}</CardTitle>
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
                        const itemCls = "[content-visibility:visible] [contain-intrinsic-size:auto]";
                        // 工具调用(Agent 发起)—— 左对齐,可折叠查看请求 / 响应
                        if (m.role === "tool") {
                          return (
                            <MessageScrollerItem key={i} messageId={String(i)} className={itemCls}>
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
                          <MessageScrollerItem key={i} messageId={String(i)} scrollAnchor={isUser} className={itemCls}>
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
