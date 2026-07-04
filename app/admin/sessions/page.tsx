"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MessagesSquare, ScrollText } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

interface Sess { key: string; sessionId: string | null; humanMode: boolean; updatedAt: number; }
interface Msg { role: string; text: string; tool?: string; }
interface Log { ts: number; level: string; msg: string; }

const LOG_COLOR: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-500",
  error: "text-destructive",
};

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [active, setActive] = useState<string | null>(null);

  async function loadSessions() {
    const r = await fetch("/api/sessions").then((x) => x.json());
    if (r.ok) setSessions(r.data);
  }
  async function loadLogs() {
    const r = await fetch("/api/logs").then((x) => x.json());
    if (r.ok) setLogs(r.data);
  }
  useEffect(() => {
    loadSessions();
    loadLogs();
    const t = setInterval(loadLogs, 3000);
    return () => clearInterval(t);
  }, []);

  async function open(sess: Sess) {
    if (!sess.sessionId) return;
    setActive(sess.key);
    const r = await fetch(`/api/sessions/${encodeURIComponent(sess.sessionId)}`).then((x) => x.json());
    if (r.ok) setMsgs(r.data);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">会话 / 日志</h1>
        <p className="text-muted-foreground text-sm">查看历史会话的对话记录与运行时日志。</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">会话</CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{active ? `对话:${active}` : "消息"}</CardTitle>
          </CardHeader>
          <CardContent>
            {!active ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessagesSquare />
                  </EmptyMedia>
                  <EmptyTitle>未选择会话</EmptyTitle>
                  <EmptyDescription>从左侧选择一个会话查看其对话记录。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : msgs.length === 0 ? (
              <p className="text-muted-foreground text-sm">无 transcript(session 文件未找到或为空)。</p>
            ) : (
              <ScrollArea className="h-[420px] pr-4">
                <div className="flex flex-col gap-3">
                  {msgs.map((m, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={m.role === "user" ? "outline" : "secondary"}>
                          {m.role === "user" ? "用户" : "助手"}
                        </Badge>
                        {m.tool && <span className="text-muted-foreground text-xs">工具:{m.tool}</span>}
                      </div>
                      {m.text && <p className="text-sm whitespace-pre-wrap">{m.text}</p>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="size-4" />
            运行时日志
          </CardTitle>
          <CardDescription>最近 500 条(每 3 秒刷新)。</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-sm">暂无日志。</p>
          ) : (
            <ScrollArea className="bg-muted/40 h-64 rounded-md">
              <div className="flex flex-col gap-0.5 p-3 font-mono text-xs">
                {logs.map((l, i) => (
                  <div key={i} className={cn("flex gap-2", LOG_COLOR[l.level])}>
                    <span className="text-muted-foreground shrink-0">{new Date(l.ts).toLocaleTimeString()}</span>
                    <span className="shrink-0 uppercase">[{l.level}]</span>
                    <span className="break-all whitespace-pre-wrap">{l.msg}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
