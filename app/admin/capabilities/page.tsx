"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Boxes, Puzzle, Plug, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

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
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">能力</h1>
          <p className="text-muted-foreground text-sm">Agent 运行时持有的插件、技能、MCP server 与工具门控(经 SDK 上报)。</p>
        </div>
        <Button onClick={() => load(true)} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
          刷新
        </Button>
      </div>

      {err && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" /> 探测失败
            </CardTitle>
            <CardDescription>Agent 未配置或 Claude CLI 不可用,请检查配置后重试。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted text-muted-foreground overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{err}</pre>
          </CardContent>
        </Card>
      )}

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
            <Card>
              <CardHeader>
                <CardTitle>插件</CardTitle>
                <CardDescription>本地加载的 plugin(skills/commands)。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {caps.plugins.length === 0 ? <span className="text-muted-foreground text-sm">无</span> :
                  caps.plugins.map((p) => (
                    <div key={p.name} className="flex flex-col gap-1 rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.source && <Badge variant="secondary">{p.source}</Badge>}
                      </div>
                      <code className="text-muted-foreground text-xs break-all">{p.path}</code>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="skills">
            <Card>
              <CardHeader>
                <CardTitle>技能</CardTitle>
                <CardDescription>Agent 可自动触发的 skill。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {caps.skills.length === 0 ? <span className="text-muted-foreground text-sm">无</span> :
                  caps.skills.map((s) => (
                    <div key={s.name} className="flex flex-col gap-1 rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {s.argumentHint && <Badge variant="outline">{s.argumentHint}</Badge>}
                      </div>
                      <span className="text-muted-foreground text-sm">{s.description}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mcp">
            <Card>
              <CardHeader>
                <CardTitle>MCP Server</CardTitle>
                <CardDescription>已注册的 MCP server 及其工具。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {caps.mcpServers.length === 0 ? <span className="text-muted-foreground text-sm">无</span> :
                  caps.mcpServers.map((m) => (
                    <div key={m.name} className="flex flex-col gap-2 rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.name}</span>
                        <Badge variant={mcpVariant(m.status)}>{m.status}</Badge>
                        {m.version && <span className="text-muted-foreground text-xs">v{m.version}</span>}
                      </div>
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
                    </div>
                  ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policy">
            <Card>
              <CardHeader>
                <CardTitle>工具门控</CardTitle>
                <CardDescription>本 host 对工具调用的白名单与限制。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
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
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
