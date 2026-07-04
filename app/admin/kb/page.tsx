"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, RefreshCw, Save, BookOpen, AlertTriangle } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";

interface KbStats {
  chunks: number;
  vecs: number;
  dim: number;
  docs: { doc: string; chunks: number }[];
}
interface KbChunk {
  id: number;
  content: string;
}

export default function KbPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [stats, setStats] = useState<KbStats | null>(null);
  const [chunks, setChunks] = useState<KbChunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  async function loadFiles() {
    const r = await fetch("/api/kb").then((x) => x.json());
    if (r.ok) setFiles(r.data);
  }
  async function loadStats() {
    const r = await fetch("/api/kb/vec").then((x) => x.json());
    if (r.ok) setStats(r.data);
  }
  useEffect(() => {
    loadFiles();
    loadStats();
  }, []);

  // 逐段编码:catch-all 路由需真实 "/" 分隔子目录,不能整串编码
  const encPath = (f: string) => f.split("/").map(encodeURIComponent).join("/");

  const chunksOf = (f: string) => stats?.docs.find((d) => d.doc === f)?.chunks ?? 0;

  async function loadChunks(f: string) {
    setLoadingChunks(true);
    try {
      const r = await fetch(`/api/kb/vec?doc=${encodeURIComponent(f)}`).then((x) => x.json());
      setChunks(r.ok ? r.data : []);
    } finally {
      setLoadingChunks(false);
    }
  }

  async function open(f: string) {
    setActive(f);
    setChunks([]);
    const r = await fetch(`/api/kb/${encPath(f)}`).then((x) => x.json());
    if (r.ok) setContent(r.data);
    loadChunks(f);
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
        loadStats();
        if (active) loadChunks(active);
      } else {
        toast.error(`重建失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`重建失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIngesting(false);
    }
  }

  const orphan = stats ? stats.chunks - stats.vecs : 0;

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

      {/* 向量库统计:总分块 / 已建向量 / 文档数 / 维度;chunks≠vecs 时提示孤儿块 */}
      {stats && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 py-4 text-sm">
            <Stat label="总分块" value={stats.chunks} />
            <Stat label="已建向量" value={stats.vecs} />
            <Stat label="文档数" value={stats.docs.length} />
            <Stat label="向量维度" value={stats.dim} />
            {orphan !== 0 && (
              <span className="text-destructive inline-flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" />
                {orphan} 个分块缺向量,需重建 embedding
              </span>
            )}
          </CardContent>
        </Card>
      )}

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
                    {chunksOf(f) > 0 && (
                      <Badge variant="secondary" className="ml-auto shrink-0 tabular-nums">
                        {chunksOf(f)}
                      </Badge>
                    )}
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
              <Tabs defaultValue="edit" className="flex flex-1 flex-col">
                <TabsList>
                  <TabsTrigger value="edit">编辑</TabsTrigger>
                  <TabsTrigger value="chunks">分块 {chunksOf(active) > 0 && `(${chunksOf(active)})`}</TabsTrigger>
                </TabsList>

                <TabsContent value="edit" className="flex flex-1 flex-col gap-3">
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
                </TabsContent>

                <TabsContent value="chunks" className="flex-1">
                  {loadingChunks ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
                      <Spinner /> 加载分块…
                    </div>
                  ) : chunks.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-sm">
                      该文档尚无分块,点右上角「重建 embedding」后生成。
                    </p>
                  ) : (
                    <ScrollArea className="h-[460px] pr-3">
                      <div className="flex flex-col gap-2">
                        {chunks.map((c, i) => (
                          <div key={c.id} className="bg-muted/40 rounded-md border p-3">
                            <div className="text-muted-foreground mb-1.5 flex items-center justify-between text-xs">
                              <span>#{i + 1}</span>
                              <span className="tabular-nums">{c.content.length} 字</span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
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
                <EmptyDescription>从左侧选择一个文档进行编辑或预览分块,或点右上角重建 embedding。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </span>
  );
}
