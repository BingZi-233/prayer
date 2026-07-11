"use client";

import { useEffect, useState } from "react";
import { Puzzle, Plus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { EmptyState, ErrorState } from "@/components/admin/data-state";

interface Plugin { id: string; version: string; scope: string; enabled: boolean; installPath: string; }

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ source: "github", repoOrPath: "", marketplaceName: "", pluginName: "" });

  async function load() {
    const r = await fetch("/api/plugins").then((x) => x.json());
    if (r.ok) setPlugins(r.data);
    else setErr(r.error);
  }
  useEffect(() => { load(); }, []);

  async function act(fn: () => Promise<Response>) {
    setBusy(true); setErr(null);
    try {
      const r = await fn().then((x) => x.json());
      if (!r.ok) setErr(r.error);
      await load();
    } finally { setBusy(false); }
  }

  const install = () =>
    act(() => fetch("/api/plugins", { method: "POST", body: JSON.stringify(form) }));
  const toggle = (p: Plugin) =>
    act(() => fetch(`/api/plugins/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ action: p.enabled ? "disable" : "enable" }) }));
  const update = (p: Plugin) =>
    act(() => fetch(`/api/plugins/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ action: "update" }) }));
  const remove = (p: Plugin) =>
    act(() => fetch(`/api/plugins/${encodeURIComponent(p.id)}`, { method: "DELETE" }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="插件"
        description="安装、更新与启停插件，操作后自动生效。"
      />

      {err && <ErrorState description={err} onRetry={load} />}

      <SectionCard
        title="添加插件"
        icon={Plus}
        description="GitHub 填写 owner/repo，本地填写绝对路径；市场名与插件名见 marketplace.json。"
        contentClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label>来源</Label>
          <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="directory">本地目录</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{form.source === "github" ? "owner/repo" : "绝对路径"}</Label>
          <Input value={form.repoOrPath} onChange={(e) => setForm({ ...form, repoOrPath: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>marketplace 名</Label>
          <Input value={form.marketplaceName} onChange={(e) => setForm({ ...form, marketplaceName: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>插件名</Label>
          <Input value={form.pluginName} onChange={(e) => setForm({ ...form, pluginName: e.target.value })} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button onClick={install} disabled={busy || !form.repoOrPath || !form.marketplaceName || !form.pluginName}>安装</Button>
        </div>
      </SectionCard>

      <SectionCard title="已装插件" description="已安装的插件，可启停、更新或卸载。">
        {plugins.length === 0 ? (
          <EmptyState icon={Puzzle} title="暂无插件" description="使用上方表单安装插件。" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead><TableHead>版本</TableHead><TableHead>scope</TableHead>
                <TableHead>启用</TableHead><TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plugins.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.id}</TableCell>
                  <TableCell><Badge variant="secondary">{p.version}</Badge></TableCell>
                  <TableCell>{p.scope}</TableCell>
                  <TableCell><Switch checked={p.enabled} disabled={busy} onCheckedChange={() => toggle(p)} /></TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => update(p)} aria-label="更新插件" title="更新"><RotateCw className="size-3.5" /></Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(p)} aria-label="卸载插件" title="卸载"><Trash2 className="size-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
