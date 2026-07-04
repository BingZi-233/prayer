"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, ChevronsUpDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

interface Cfg {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  model: string;
  enabledGroups: number[];
}

const NUM_KEYS: (keyof Cfg)[] = ["botQQ", "adminGroupId", "handoffTimeoutMin"];

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<{ groupId: number; groupName: string }[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/config").then((x) => x.json()).then((r) => {
      if (r.ok) {
        setCfg(r.data);
      }
    });
  }, []);

  useEffect(() => {
    fetch("/api/onebot/groups")
      .then((x) => x.json())
      .then((r) => setGroups(r.ok ? r.data : null))
      .catch(() => setGroups(null))
      .finally(() => setGroupsLoading(false));
  }, []);

  function upd(k: keyof Cfg, v: string) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: NUM_KEYS.includes(k) ? Number(v) : v });
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    // token 若仍是掩码(含 •)则不提交该字段(服务端亦有防御)
    const payload: Partial<Cfg> = { ...cfg };
    if (typeof payload.onebotAccessToken === "string" && payload.onebotAccessToken.includes("•")) {
      delete payload.onebotAccessToken;
    }
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then((x) => x.json());
      if (r.ok) {
        setCfg(r.data);
        toast.success("配置已保存,Agent 已热重载");
      } else {
        toast.error(`保存失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`保存失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const num = (k: keyof Cfg) => (cfg ? String(cfg[k]) : "");

  // 生效群多选 toggle:维护 cfg.enabledGroups(number[])
  function toggleGroup(id: number) {
    if (!cfg) return;
    const set = new Set(cfg.enabledGroups);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setCfg({ ...cfg, enabledGroups: Array.from(set) });
  }
  // 群名查找:不在列表(bot 已退群)→ 裸 id
  const groupName = (id: number) => groups?.find((g) => g.groupId === id)?.groupName ?? String(id);
  // 管理群下拉选项:已存 id 不在列表(bot 已退群)时补一条裸 id,避免显示为未选而被误覆盖
  const adminGroupOptions = (): { groupId: number; groupName: string }[] => {
    if (!groups) return [];
    if (cfg?.adminGroupId && !groups.some((g) => g.groupId === cfg.adminGroupId)) {
      return [{ groupId: cfg.adminGroupId, groupName: String(cfg.adminGroupId) }, ...groups];
    }
    return groups;
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">配置</h1>
        <p className="text-muted-foreground text-sm">修改后保存即热重载,无需重启进程。密钥字段留空表示不修改。</p>
      </div>

      {!cfg ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <Tabs defaultValue="onebot">
          <TabsList>
            <TabsTrigger value="onebot">OneBot</TabsTrigger>
            <TabsTrigger value="sdk">Claude SDK</TabsTrigger>
            <TabsTrigger value="storage">存储</TabsTrigger>
          </TabsList>

          <TabsContent value="onebot">
            <Card>
              <CardHeader>
                <CardTitle>OneBot 连接</CardTitle>
                <CardDescription>NapCat 正向 WS 连接与群参数。</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="onebotWsUrl">WS 地址</FieldLabel>
                    <Input id="onebotWsUrl" value={cfg.onebotWsUrl} placeholder="ws://127.0.0.1:3001" onChange={(e) => upd("onebotWsUrl", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="onebotAccessToken">Access Token</FieldLabel>
                    <Input id="onebotAccessToken" value={cfg.onebotAccessToken} placeholder="留空不修改" onChange={(e) => upd("onebotAccessToken", e.target.value)} />
                    <FieldDescription>已保存的密钥以掩码显示,留空或不改动则保留原值。</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="botQQ">Bot QQ</FieldLabel>
                    <Input id="botQQ" inputMode="numeric" value={num("botQQ")} onChange={(e) => upd("botQQ", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="adminGroupId">管理群号</FieldLabel>
                    {groups ? (
                      <Select value={cfg.adminGroupId ? String(cfg.adminGroupId) : ""} onValueChange={(v) => upd("adminGroupId", v)}>
                        <SelectTrigger id="adminGroupId">
                          <SelectValue placeholder="选择管理群" />
                        </SelectTrigger>
                        <SelectContent>
                          {adminGroupOptions().map((g) => (
                            <SelectItem key={g.groupId} value={String(g.groupId)}>
                              {g.groupName} ({g.groupId})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <FieldDescription>
                        {groupsLoading ? "正在获取群列表…" : "bot 未连接,无法获取群列表。请先填写连接并启动 bot。"}
                      </FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="enabledGroups">生效群</FieldLabel>
                    {groups ? (
                      <>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button id="enabledGroups" variant="outline" role="combobox" className="justify-between font-normal">
                              {cfg.enabledGroups.length ? `已选 ${cfg.enabledGroups.length} 个群` : "选择生效群"}
                              <ChevronsUpDown className="opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0" align="start">
                            <Command>
                              <CommandInput placeholder="搜索群名…" />
                              <CommandList>
                                <CommandEmpty>无匹配群</CommandEmpty>
                                <CommandGroup>
                                  {groups.map((g) => (
                                    <CommandItem key={g.groupId} value={`${g.groupName} ${g.groupId}`} onSelect={() => toggleGroup(g.groupId)}>
                                      <Checkbox checked={cfg.enabledGroups.includes(g.groupId)} className="mr-2" />
                                      {g.groupName} ({g.groupId})
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        {cfg.enabledGroups.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {cfg.enabledGroups.map((id) => (
                              <Badge key={id} variant="secondary" className="cursor-pointer" onClick={() => toggleGroup(id)}>
                                {groupName(id)} ✕
                              </Badge>
                            ))}
                          </div>
                        )}
                        <FieldDescription>
                          仅这些群里 bot 才会回复 / 缓冲 / 沉淀知识。留空 = 对所有群都不响应。管理群不受此列表影响。
                        </FieldDescription>
                      </>
                    ) : (
                      <FieldDescription>
                        {groupsLoading ? "正在获取群列表…" : "bot 未连接,无法获取群列表。请先填写连接并启动 bot。"}
                      </FieldDescription>
                    )}
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sdk">
            <Card>
              <CardHeader>
                <CardTitle>Claude Agent SDK</CardTitle>
                <CardDescription>模型与凭证目录。SDK 只需一个 CLAUDE_CONFIG_DIR(内含 claude login 生成的凭证)。</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="claudeConfigDir">CLAUDE_CONFIG_DIR</FieldLabel>
                    <Input id="claudeConfigDir" value={cfg.claudeConfigDir} placeholder="./data/claude-config" onChange={(e) => upd("claudeConfigDir", e.target.value)} />
                    <FieldDescription>SDK 认证与配置目录,在该目录 `claude login` 后即可使用。模型等由该目录内配置决定。</FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="storage">
            <Card>
              <CardHeader>
                <CardTitle>存储</CardTitle>
                <CardDescription>SQLite 数据库路径(会话 / 知识库 / 配置)。</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="dbPath">数据库路径</FieldLabel>
                    <Input id="dbPath" value={cfg.dbPath} placeholder="./data/agent.db" onChange={(e) => upd("dbPath", e.target.value)} />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </TabsContent>

          <div className="mt-4">
            <Button onClick={save} disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {busy ? "保存中…" : "保存并热重载"}
            </Button>
          </div>
        </Tabs>
      )}
    </div>
  );
}
