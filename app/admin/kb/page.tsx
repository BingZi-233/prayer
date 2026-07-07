"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, RefreshCw, Save, BookOpen, AlertTriangle, Boxes, Database, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard, StatGrid } from "@/components/admin/stat";
import { SectionCard } from "@/components/admin/section-card";
import { DataState, EmptyState } from "@/components/admin/data-state";
import { NavListItem } from "@/components/admin/nav-list-item";

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
  const [files, setFiles] = useState<string[] | null>(null);
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
      <PageHeader
        title="知识库"
        description="编辑 docs/kb 文档,重建 embedding 后 Agent 即可检索。"
        actions={
          <Button variant="secondary" onClick={ingest} disabled={ingesting}>
            {ingesting ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            {ingesting ? "重建中…" : "重建 embedding"}
          </Button>
        }
      />

      {/* 向量库统计:总分块 / 已建向量 / 文档数 / 维度;chunks≠vecs 时提示孤儿块 */}
      <StatGrid>
        <StatCard icon={Boxes} label="总分块" value={stats ? stats.chunks : "—"} loading={!stats} />
        <StatCard icon={Database} label="已建向量" value={stats ? stats.vecs : "—"} loading={!stats} />
        <StatCard icon={FileText} label="文档数" value={stats ? stats.docs.length : "—"} loading={!stats} />
        <StatCard icon={Ruler} label="向量维度" value={stats ? stats.dim : "—"} loading={!stats} />
      </StatGrid>
      {orphan !== 0 && (
        <div className="border-destructive/40 text-destructive flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
          <AlertTriangle className="size-4 shrink-0" />
          {orphan} 个分块缺向量,需重建 embedding。
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <SectionCard title="文件" className="h-fit">
          <DataState
            loading={files === null}
            empty={files?.length === 0}
            emptyIcon={FileText}
            emptyTitle="暂无文档"
            emptyDescription="docs/kb 下放入 .md / .txt 文件。"
            skeleton={<Skeleton className="h-32 w-full" />}
          >
            <div className="flex flex-col gap-1">
              {files?.map((f) => (
                <NavListItem
                  key={f}
                  active={active === f}
                  onClick={() => open(f)}
                  icon={FileText}
                  badge={
                    chunksOf(f) > 0 ? (
                      <Badge variant="secondary" className="tabular-nums">
                        {chunksOf(f)}
                      </Badge>
                    ) : undefined
                  }
                >
                  {f}
                </NavListItem>
              ))}
            </div>
          </DataState>
        </SectionCard>

        {active ? (
          <SectionCard title={active} icon={FileText} className="flex flex-col" contentClassName="flex flex-1 flex-col">
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
                <DataState
                  loading={loadingChunks}
                  empty={chunks.length === 0}
                  emptyIcon={Boxes}
                  emptyTitle="尚无分块"
                  emptyDescription="点右上角「重建 embedding」后生成。"
                  skeleton={<Skeleton className="h-40 w-full" />}
                >
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
                </DataState>
              </TabsContent>
            </Tabs>
          </SectionCard>
        ) : (
          <SectionCard title="预览" contentClassName="py-0">
            <EmptyState
              icon={BookOpen}
              title="未选择文件"
              description="从左侧选择一个文档进行编辑或预览分块,或点右上角重建 embedding。"
            />
          </SectionCard>
        )}
      </div>
    </div>
  );
}
