"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function KbPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadFiles() {
    const r = await fetch("/api/kb").then((x) => x.json());
    if (r.ok) setFiles(r.data);
  }
  useEffect(() => { loadFiles(); }, []);

  async function open(f: string) {
    setActive(f);
    const r = await fetch(`/api/kb/${encodeURIComponent(f)}`).then((x) => x.json());
    if (r.ok) setContent(r.data);
  }

  async function save() {
    if (!active) return;
    setBusy(true);
    const r = await fetch(`/api/kb/${encodeURIComponent(active)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }).then((x) => x.json());
    setMsg(r.ok ? "已保存" : `失败:${r.error}`);
    setBusy(false);
  }

  async function ingest() {
    setBusy(true);
    setMsg("重建中…");
    const r = await fetch("/api/kb/ingest", { method: "POST" }).then((x) => x.json());
    setMsg(r.ok ? `完成:${r.data.map((x: { file: string; chunks: number }) => `${x.file}(${x.chunks})`).join(", ")}` : `失败:${r.error}`);
    setBusy(false);
  }

  return (
    <div className="flex gap-4">
      <Card className="w-56 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">文件</span>
          <Button size="sm" variant="secondary" onClick={ingest} disabled={busy}>重建 embedding</Button>
        </div>
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f}>
              <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${active === f ? "bg-muted" : ""}`} onClick={() => open(f)}>{f}</button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-1 flex-col gap-3">
        {active ? (
          <>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[400px] font-mono text-sm" />
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={busy}>保存</Button>
              {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">选择左侧文件编辑,或点「重建 embedding」。{msg && ` ${msg}`}</div>
        )}
      </div>
    </div>
  );
}
