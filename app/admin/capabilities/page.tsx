"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { RotateCw, Boxes, Puzzle, Plug, ShieldCheck } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { ItemCard } from "@/components/admin/item-card"
import { EmptyState, ErrorState } from "@/components/admin/data-state"

interface Tool {
  name: string
  description?: string
  readOnly?: boolean
}
interface McpServer {
  name: string
  status: string
  version?: string
  error?: string
  scope?: string
  tools: Tool[]
}
interface Skill {
  name: string
  description: string
  argumentHint?: string
}
interface Plugin {
  name: string
  path: string
  source?: string
}
interface ToolPolicy {
  allowlist: string[]
  gated: { tool: string; constraint: string }[]
}
interface Capabilities {
  plugins: Plugin[]
  skills: Skill[]
  mcpServers: McpServer[]
  toolPolicy: ToolPolicy
  probedAt: number
}

function mcpVariant(s: string): "default" | "secondary" | "destructive" {
  if (s === "connected") return "default"
  if (s === "failed") return "destructive"
  return "secondary"
}

export default function CapabilitiesPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(refresh = false) {
    setBusy(true)
    try {
      const r = await fetch(
        `/api/capabilities${refresh ? "?refresh=1" : ""}`
      ).then((x) => x.json())
      if (r.ok) {
        setCaps(r.data)
        setErr(null)
      } else {
        setErr(r.error)
        if (refresh) toast.error(r.error)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // 初始加载挪进异步边界:setBusy 等 setState 不落在 effect 同步路径上
  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [])

  const gatedCount = caps
    ? caps.toolPolicy.allowlist.length + caps.toolPolicy.gated.length
    : 0

  return (
    <PageShell>
      <PageHeader
        title="能力"
        description="当前加载的插件、技能、MCP 与工具权限。"
        actions={
          <Button onClick={() => load(true)} disabled={busy}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCw data-icon="inline-start" />
            )}
            刷新
          </Button>
        }
      />

      {err && (
        <ErrorState
          title="探测失败"
          description={err}
          onRetry={() => load(true)}
        />
      )}

      {!caps && !err && <Skeleton className="h-72 w-full" />}

      {caps && (
        <Tabs defaultValue="plugins">
          <TabsList>
            <TabsTrigger value="plugins">
              <Puzzle data-icon="inline-start" /> 插件 ({caps.plugins.length})
            </TabsTrigger>
            <TabsTrigger value="skills">
              <Boxes data-icon="inline-start" /> 技能 ({caps.skills.length})
            </TabsTrigger>
            <TabsTrigger value="mcp">
              <Plug data-icon="inline-start" /> MCP ({caps.mcpServers.length})
            </TabsTrigger>
            <TabsTrigger value="policy">
              <ShieldCheck data-icon="inline-start" /> 工具门控 ({gatedCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="plugins">
            <SectionCard
              title="插件"
              description="已加载的本地插件。"
              contentClassName="flex flex-col gap-3"
            >
              {caps.plugins.length === 0 ? (
                <EmptyState
                  icon={Puzzle}
                  title="无插件"
                  description="尚未加载任何本地插件。"
                />
              ) : (
                caps.plugins.map((p) => (
                  <ItemCard
                    key={p.name}
                    meta={
                      <>
                        <span className="font-medium text-foreground">
                          {p.name}
                        </span>
                        {p.source && (
                          <Badge variant="secondary">{p.source}</Badge>
                        )}
                      </>
                    }
                  >
                    <code className="text-xs break-all text-muted-foreground">
                      {p.path}
                    </code>
                  </ItemCard>
                ))
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="skills">
            <SectionCard
              title="技能"
              description="机器人可自动触发的技能。"
              contentClassName="flex flex-col gap-3"
            >
              {caps.skills.length === 0 ? (
                <EmptyState
                  icon={Boxes}
                  title="无技能"
                  description="尚未注册任何技能。"
                />
              ) : (
                caps.skills.map((s) => (
                  <ItemCard
                    key={s.name}
                    meta={
                      <>
                        <span className="font-medium text-foreground">
                          {s.name}
                        </span>
                        {s.argumentHint && (
                          <Badge variant="outline">{s.argumentHint}</Badge>
                        )}
                      </>
                    }
                  >
                    <span className="text-sm text-muted-foreground">
                      {s.description}
                    </span>
                  </ItemCard>
                ))
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="mcp">
            <SectionCard
              title="MCP Server"
              description="已注册的 MCP 服务及其工具。"
              contentClassName="flex flex-col gap-3"
            >
              {caps.mcpServers.length === 0 ? (
                <EmptyState
                  icon={Plug}
                  title="无 MCP Server"
                  description="尚未注册任何 MCP 服务。"
                />
              ) : (
                caps.mcpServers.map((m) => (
                  <ItemCard
                    key={m.name}
                    meta={
                      <>
                        <span className="font-medium text-foreground">
                          {m.name}
                        </span>
                        <Badge variant={mcpVariant(m.status)}>{m.status}</Badge>
                        {m.version && (
                          <span className="text-xs text-muted-foreground">
                            v{m.version}
                          </span>
                        )}
                      </>
                    }
                  >
                    {m.error && (
                      <p className="mb-1 text-xs text-destructive">{m.error}</p>
                    )}
                    {m.tools.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {m.tools.map((t) => (
                          <li key={t.name} className="text-sm">
                            <code className="text-xs">{t.name}</code>
                            {t.readOnly && (
                              <Badge variant="outline" className="ml-2">
                                只读
                              </Badge>
                            )}
                            {t.description && (
                              <span className="ml-2 text-muted-foreground">
                                {t.description}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </ItemCard>
                ))
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="policy">
            <SectionCard
              title="工具门控"
              description="工具调用的放行与限制规则。"
              contentClassName="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">无条件放行</span>
                <div className="flex flex-wrap gap-2">
                  {caps.toolPolicy.allowlist.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">受限工具</span>
                {caps.toolPolicy.gated.length === 0 ? (
                  <span className="text-sm text-muted-foreground">无</span>
                ) : (
                  caps.toolPolicy.gated.map((g) => (
                    <div key={g.tool} className="text-sm">
                      <code className="text-xs">{g.tool}</code>
                      <span className="ml-2 text-muted-foreground">
                        {g.constraint}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  )
}
