"use client";

import { useEffect, useState } from "react";
import { Puzzle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">插件</h1>
        <p className="text-muted-foreground text-sm">安装 / 更新 / 启停插件,操作后 agent 自动重载生效。</p>
      </div>

      {err && <div className="text-destructive text-sm">{err}</div>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="size-4" />添加插件</CardTitle>
          <CardDescription>GitHub 传 owner/repo,本地目录传绝对路径;marketplace 名与插件名见其 marketplace.json。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label>来源</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>已装插件</CardTitle></CardHeader>
        <CardContent>
          {plugins.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Puzzle /></EmptyMedia>
                <EmptyTitle>暂无插件</EmptyTitle>
                <EmptyDescription>用上方表单安装。</EmptyDescription>
              </EmptyHeader>
            </Empty>
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
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => update(p)}><RefreshCw className="size-3.5" /></Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(p)}><Trash2 className="size-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
