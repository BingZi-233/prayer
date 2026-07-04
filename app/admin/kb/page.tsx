"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, RefreshCw, Save, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function KbPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  async function loadFiles() {
    const r = await fetch("/api/kb").then((x) => x.json());
    if (r.ok) setFiles(r.data);
  }
  useEffect(() => {
    loadFiles();
  }, []);

  // 逐段编码:catch-all 路由需真实 "/" 分隔子目录,不能整串编码
  const encPath = (f: string) => f.split("/").map(encodeURIComponent).join("/");

  async function open(f: string) {
    setActive(f);
    const r = await fetch(`/api/kb/${encPath(f)}`).then((x) => x.json());
    if (r.ok) setContent(r.data);
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/kb/${encPath(active)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      }).then((x) => x.json());
      if (r.ok) toast.success(`已保存 ${active}`);
      else toast.error(`保存失败:${r.error}`);
    } finally {
      setSaving(false);
    }
  }

  async function ingest() {
    setIngesting(true);
    try {
      const r = await fetch("/api/kb/ingest", { method: "POST" }).then((x) => x.json());
      if (r.ok) {
        const summary = r.data.map((x: { file: string; chunks: number }) => `${x.file}(${x.chunks})`).join(", ");
        toast.success(`embedding 重建完成:${summary || "无文件"}`);
      } else {
        toast.error(`重建失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`重建失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">知识库</h1>
          <p className="text-muted-foreground text-sm">编辑 docs/kb 文档,重建 embedding 后 Agent 即可检索。</p>
        </div>
        <Button variant="secondary" onClick={ingest} disabled={ingesting}>
          {ingesting ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          {ingesting ? "重建中…" : "重建 embedding"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">文件</CardTitle>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <p className="text-muted-foreground text-sm">docs/kb 暂无 .md / .txt 文件。</p>
            ) : (
              <div className="flex flex-col gap-1">
                {files.map((f) => (
                  <button
                    key={f}
                    onClick={() => open(f)}
                    className={cn(
                      "hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      active === f && "bg-muted font-medium",
                    )}
                  >
                    <FileText className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate">{f}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {active ? (
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-sm">{active}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[420px] flex-1 font-mono text-sm"
                spellCheck={false}
              />
              <div>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpen />
                </EmptyMedia>
                <EmptyTitle>未选择文件</EmptyTitle>
                <EmptyDescription>从左侧选择一个文档进行编辑,或点右上角重建 embedding。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        )}
      </div>
    </div>
  );
}
