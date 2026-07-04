"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

interface Sess { key: string; sessionId: string | null; humanMode: boolean; updatedAt: number; }
interface Msg { role: string; text: string; tool?: string; }
interface Log { ts: number; level: string; msg: string; }

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

  async function open(s: Sess) {
    if (!s.sessionId) return;
    setActive(s.key);
    const r = await fetch(`/api/sessions/${encodeURIComponent(s.sessionId)}`).then((x) => x.json());
    if (r.ok) setMsgs(r.data);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4">
        <Card className="w-64 p-4">
          <div className="mb-2 font-medium">会话</div>
          <ul className="flex flex-col gap-1">
            {sessions.map((s) => (
              <li key={s.key}>
                <button className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${active === s.key ? "bg-muted" : ""}`} onClick={() => open(s)}>
                  {s.key}{s.humanMode ? " 🧑‍💼" : ""}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex-1 p-4">
          <div className="mb-2 font-medium">消息</div>
          <div className="flex flex-col gap-2">
            {msgs.map((m, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium">{m.role}:</span> {m.text}
                {m.tool && <span className="ml-2 text-xs text-muted-foreground">[工具: {m.tool}]</span>}
              </div>
            ))}
            {active && msgs.length === 0 && <div className="text-sm text-muted-foreground">无 transcript(或 session 文件未找到)</div>}
          </div>
        </Card>
      </div>
      <Card className="p-4">
        <div className="mb-2 font-medium">运行时日志</div>
        <pre className="max-h-64 overflow-auto text-xs">
          {logs.map((l, i) => `${new Date(l.ts).toLocaleTimeString()} [${l.level}] ${l.msg}`).join("\n")}
        </pre>
      </Card>
    </div>
  );
}
