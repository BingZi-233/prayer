"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RotateCw, Boxes, Puzzle, Plug, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { EmptyState, ErrorState } from "@/components/admin/data-state";

interface Tool { name: string; description?: string; readOnly?: boolean }
interface McpServer { name: string; status: string; version?: string; error?: string; scope?: string; tools: Tool[] }
interface Skill { name: string; description: string; argumentHint?: string }
interface Plugin { name: string; path: string; source?: string }
interface ToolPolicy { allowlist: string[]; gated: { tool: string; constraint: string }[] }
interface Capabilities {
  plugins: Plugin[]; skills: Skill[]; mcpServers: McpServer[]; toolPolicy: ToolPolicy; probedAt: number;
}

function mcpVariant(s: string): "default" | "secondary" | "destructive" {
  if (s === "connected") return "default";
  if (s === "failed") return "destructive";
  return "secondary";
}

// 页内复用:插件/技能/MCP server 三处近乎一致的条目外壳(名 + 徽标 + 副内容)。
function CapItem({ title, badge, children }: { title: ReactNode; badge?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

export default function CapabilitiesPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(refresh = false) {
    setBusy(true);
    try {
      const r = await fetch(`/api/capabilities${refresh ? "?refresh=1" : ""}`).then((x) => x.json());
      if (r.ok) { setCaps(r.data); setErr(null); }
      else { setErr(r.error); if (refresh) toast.error(r.error); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  const gatedCount = caps ? caps.toolPolicy.allowlist.length + caps.toolPolicy.gated.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="能力"
        description="Agent 运行时持有的插件、技能、MCP server 与工具门控(经 SDK 上报)。"
        actions={
          <Button onClick={() => load(true)} disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
            刷新
          </Button>
        }
      />

      {err && <ErrorState title="探测失败" description={err} onRetry={() => load(true)} />}

      {!caps && !err && <Skeleton className="h-72 w-full" />}

      {caps && (
        <Tabs defaultValue="plugins">
          <TabsList>
            <TabsTrigger value="plugins"><Puzzle data-icon="inline-start" /> 插件 ({caps.plugins.length})</TabsTrigger>
            <TabsTrigger value="skills"><Boxes data-icon="inline-start" /> 技能 ({caps.skills.length})</TabsTrigger>
            <TabsTrigger value="mcp"><Plug data-icon="inline-start" /> MCP ({caps.mcpServers.length})</TabsTrigger>
            <TabsTrigger value="policy"><ShieldCheck data-icon="inline-start" /> 工具门控 ({gatedCount})</TabsTrigger>
          </TabsList>

          <TabsContent value="plugins">
            <SectionCard title="插件" description="本地加载的 plugin(skills/commands)。" contentClassName="flex flex-col gap-3">
              {caps.plugins.length === 0 ? (
                <EmptyState icon={Puzzle} title="无插件" description="Agent 未加载任何本地 plugin。" />
              ) : (
                caps.plugins.map((p) => (
                  <CapItem
                    key={p.name}
                    title={p.name}
                    badge={p.source && <Badge variant="secondary">{p.source}</Badge>}
                  >
                    <code className="text-muted-foreground text-xs break-all">{p.path}</code>
                  </CapItem>
                ))
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="skills">
            <SectionCard title="技能" description="Agent 可自动触发的 skill。" contentClassName="flex flex-col gap-3">
              {caps.skills.length === 0 ? (
                <EmptyState icon={Boxes} title="无技能" description="Agent 未注册任何 skill。" />
              ) : (
                caps.skills.map((s) => (
                  <CapItem
                    key={s.name}
                    title={s.name}
                    badge={s.argumentHint && <Badge variant="outline">{s.argumentHint}</Badge>}
                  >
                    <span className="text-muted-foreground text-sm">{s.description}</span>
                  </CapItem>
                ))
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="mcp">
            <SectionCard title="MCP Server" description="已注册的 MCP server 及其工具。" contentClassName="flex flex-col gap-3">
              {caps.mcpServers.length === 0 ? (
                <EmptyState icon={Plug} title="无 MCP Server" description="未注册任何 MCP server。" />
              ) : (
                caps.mcpServers.map((m) => (
                  <CapItem
                    key={m.name}
                    title={m.name}
                    badge={
                      <>
                        <Badge variant={mcpVariant(m.status)}>{m.status}</Badge>
                        {m.version && <span className="text-muted-foreground text-xs">v{m.version}</span>}
                      </>
                    }
                  >
                    {m.error && <span className="text-destructive text-xs">{m.error}</span>}
                    {m.tools.length > 0 && (
                      <ul className="flex flex-col gap-1 pl-1">
                        {m.tools.map((t) => (
                          <li key={t.name} className="text-sm">
                            <code className="text-xs">{t.name}</code>
                            {t.readOnly && <Badge variant="outline" className="ml-2">只读</Badge>}
                            {t.description && <span className="text-muted-foreground ml-2">{t.description}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CapItem>
                ))
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="policy">
            <SectionCard title="工具门控" description="本 host 对工具调用的白名单与限制。" contentClassName="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">无条件放行</span>
                <div className="flex flex-wrap gap-2">
                  {caps.toolPolicy.allowlist.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">受限工具</span>
                {caps.toolPolicy.gated.map((g) => (
                  <div key={g.tool} className="text-sm">
                    <code className="text-xs">{g.tool}</code>
                    <span className="text-muted-foreground ml-2">{g.constraint}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
