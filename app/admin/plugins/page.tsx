"use client"

import { useEffect, useState } from "react"
import { Puzzle, Plus, RotateCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableShell } from "@/components/admin/table-shell"
import { RowActions } from "@/components/admin/row-actions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { EmptyState, ErrorState } from "@/components/admin/data-state"

interface Plugin {
  id: string
  version: string
  scope: string
  enabled: boolean
  installPath: string
}

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    source: "github",
    repoOrPath: "",
    marketplaceName: "",
    pluginName: "",
  })

  async function load() {
    const r = await fetch("/api/plugins").then((x) => x.json())
    if (r.ok) setPlugins(r.data)
    else setErr(r.error)
  }
  // 初始加载挪进异步边界:setState 不落在 effect 同步路径上
  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [])

  async function act(fn: () => Promise<Response>) {
    setBusy(true)
    setErr(null)
    try {
      const r = await fn().then((x) => x.json())
      if (!r.ok) setErr(r.error)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const install = () =>
    act(() =>
      fetch("/api/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })
    )
  const toggle = (p: Plugin) =>
    act(() =>
      fetch(`/api/plugins/${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: p.enabled ? "disable" : "enable" }),
      })
    )
  const update = (p: Plugin) =>
    act(() =>
      fetch(`/api/plugins/${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update" }),
      })
    )
  const remove = (p: Plugin) =>
    act(() =>
      fetch(`/api/plugins/${encodeURIComponent(p.id)}`, { method: "DELETE" })
    )

  return (
    <PageShell>
      <PageHeader
        title="插件"
        description="安装、更新与启停插件，操作后自动生效；已装插件可启停、更新或卸载。"
      />

      {err && <ErrorState description={err} onRetry={load} />}

      <SectionCard
        title="添加插件"
        icon={Plus}
        description="GitHub 填写 owner/repo，本地填写绝对路径；市场名与插件名见 marketplace.json。"
      >
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel>来源</FieldLabel>
            <Select
              value={form.source}
              onValueChange={(v) => {
                if (v !== null) setForm({ ...form, source: v })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="directory">本地目录</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>
              {form.source === "github" ? "owner/repo" : "绝对路径"}
            </FieldLabel>
            <Input
              value={form.repoOrPath}
              onChange={(e) => setForm({ ...form, repoOrPath: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>marketplace 名</FieldLabel>
            <Input
              value={form.marketplaceName}
              onChange={(e) =>
                setForm({ ...form, marketplaceName: e.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel>插件名</FieldLabel>
            <Input
              value={form.pluginName}
              onChange={(e) => setForm({ ...form, pluginName: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              onClick={install}
              disabled={
                busy ||
                !form.repoOrPath ||
                !form.marketplaceName ||
                !form.pluginName
              }
            >
              <Plus data-icon="inline-start" />
              安装
            </Button>
          </div>
        </FieldGroup>
      </SectionCard>

      <div className="flex flex-col gap-3">
        {plugins.length === 0 ? (
          <EmptyState
            icon={Puzzle}
            title="暂无插件"
            description="使用上方表单安装插件。"
          />
        ) : (
          <TableShell minWidth="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>scope</TableHead>
                <TableHead>启用</TableHead>
                <TableHead className="w-12 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plugins.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.id}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.version}</Badge>
                  </TableCell>
                  <TableCell>{p.scope}</TableCell>
                  <TableCell>
                    <Switch
                      checked={p.enabled}
                      disabled={busy}
                      onCheckedChange={() => toggle(p)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions
                      items={[
                        {
                          key: "update",
                          label: "更新",
                          icon: <RotateCw />,
                          disabled: busy,
                          onSelect: () => void update(p),
                        },
                        {
                          key: "remove",
                          label: "卸载",
                          icon: <Trash2 />,
                          variant: "destructive",
                          disabled: busy,
                          separatorBefore: true,
                          onSelect: () => void remove(p),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableShell>
        )}
      </div>
    </PageShell>
  )
}
