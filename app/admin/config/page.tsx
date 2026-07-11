"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Save,
  ChevronsUpDown,
  X,
  Cable,
  MessageSquareText,
  Bot,
  MessagesSquare,
  Brain,
  Zap,
  Bell,
  HardDrive,
} from "lucide-react";
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
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";

interface Cfg {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  extraAtQQs: number[];
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  enabledGroups: number[];
  reflectScanMs: number;
  reflectLookbackMs: number;
  reflectSettleMs: number;
  reflectWindowMax: number;
  reflectCompactMs: number;
  reflectCompactMinEntries: number;
  reflectNotifyAdmin: boolean;
  resumeTtlMs: number;
  proactiveEnabled: boolean;
  proactiveScanMs: number;
  proactiveSilenceMs: number;
  proactiveMaxPerScan: number;
  supportUrl: string;
  ackEnabled: boolean;
  maxReplyChars: number;
  usageBudgetUsd: number;
  groupPolicies: Record<string, { proactiveEnabled?: boolean; proactiveSilenceMs?: number; notifyAdminOnHandoff?: boolean }>;
}

interface AdminCandidate {
  userId: number;
  name: string;
  role: "owner" | "admin";
  groupIds: number[];
}

const NUM_KEYS: (keyof Cfg)[] = [
  "botQQ",
  "adminGroupId",
  "handoffTimeoutMin",
  "reflectScanMs",
  "reflectLookbackMs",
  "reflectSettleMs",
  "reflectWindowMax",
  "reflectCompactMs",
  "reflectCompactMinEntries",
  "resumeTtlMs",
  "proactiveScanMs",
  "proactiveSilenceMs",
  "proactiveMaxPerScan",
  "maxReplyChars",
  "usageBudgetUsd",
];

const msToMin = (ms: number) => String(Math.round(ms / 60_000));
const minToMs = (min: string) => Math.round(Number(min) * 60_000) || 0;
const msToHr = (ms: number) => String(Math.round(ms / 3_600_000));
const hrToMs = (hr: string) => Math.round(Number(hr) * 3_600_000) || 0;

const roleLabel = (role: "owner" | "admin") => (role === "owner" ? "群主" : "管理");

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<{ groupId: number; groupName: string }[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [admins, setAdmins] = useState<AdminCandidate[] | null>(null);
  const [adminsLoading, setAdminsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/config").then((x) => x.json()).then((r) => {
      if (r.ok) {
        setCfg({ groupPolicies: {}, supportUrl: "https://www.packyapi.com", ackEnabled: true, maxReplyChars: 900, usageBudgetUsd: 0, extraAtQQs: [], ...r.data });
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

  // 生效群变化后重拉跨群管理员名单(去重)。服务端 name-cache(含 role)命中时几乎瞬时。
  const enabledKey = cfg?.enabledGroups?.slice().sort((a, b) => a - b).join(",") ?? "";
  useEffect(() => {
    if (!cfg) return;
    if (!cfg.enabledGroups.length) {
      setAdmins([]);
      setAdminsLoading(false);
      return;
    }
    let cancelled = false;
    setAdminsLoading(true);
    fetch(`/api/onebot/admins?groups=${encodeURIComponent(enabledKey)}`)
      .then((x) => x.json())
      .then((r) => {
        if (cancelled) return;
        setAdmins(r.ok ? (r.data as AdminCandidate[]) : null);
      })
      .catch(() => {
        if (!cancelled) setAdmins(null);
      })
      .finally(() => {
        if (!cancelled) setAdminsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // 仅随生效群集合变化刷新;cfg 本体其它字段不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  function upd(k: keyof Cfg, v: string) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: NUM_KEYS.includes(k) ? Number(v) : v });
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
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
        setCfg({ groupPolicies: {}, extraAtQQs: [], ...r.data });
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

  const num = (k: keyof Cfg) => (cfg ? String(cfg[k] ?? "") : "");

  function toggleGroup(id: number) {
    if (!cfg) return;
    const set = new Set(cfg.enabledGroups);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setCfg({ ...cfg, enabledGroups: Array.from(set) });
  }

  function toggleExtraAt(qq: number) {
    if (!cfg) return;
    const set = new Set(cfg.extraAtQQs);
    if (set.has(qq)) set.delete(qq);
    else set.add(qq);
    setCfg({ ...cfg, extraAtQQs: Array.from(set) });
  }

  const groupName = (id: number) => groups?.find((g) => g.groupId === id)?.groupName ?? String(id);
  const adminLabel = (qq: number) => {
    const a = admins?.find((x) => x.userId === qq);
    if (a) return `${a.name} (${qq})`;
    return String(qq);
  };
  const adminGroupOptions = (): { groupId: number; groupName: string }[] => {
    if (!groups) return [];
    if (cfg?.adminGroupId && !groups.some((g) => g.groupId === cfg.adminGroupId)) {
      return [{ groupId: cfg.adminGroupId, groupName: String(cfg.adminGroupId) }, ...groups];
    }
    return groups;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="配置"
        description="修改后保存即热重载。常用项用「分钟」显示;高级毫秒值仍写入配置。"
        actions={
          <Button onClick={save} disabled={busy || !cfg}>
            {busy ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {busy ? "保存中…" : "保存并热重载"}
          </Button>
        }
      />

      {!cfg && <Skeleton className="h-72 w-full" />}

      {cfg && (
        <Tabs defaultValue="onebot">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="onebot"><Cable data-icon="inline-start" /> OneBot</TabsTrigger>
            <TabsTrigger value="reply"><MessageSquareText data-icon="inline-start" /> 回复体验</TabsTrigger>
            <TabsTrigger value="sdk"><Bot data-icon="inline-start" /> Claude SDK</TabsTrigger>
            <TabsTrigger value="session"><MessagesSquare data-icon="inline-start" /> 会话</TabsTrigger>
            <TabsTrigger value="reflect"><Brain data-icon="inline-start" /> 反思</TabsTrigger>
            <TabsTrigger value="proactive"><Zap data-icon="inline-start" /> 主动回复</TabsTrigger>
            <TabsTrigger value="notify"><Bell data-icon="inline-start" /> 通知</TabsTrigger>
            <TabsTrigger value="storage"><HardDrive data-icon="inline-start" /> 存储</TabsTrigger>
          </TabsList>

          <TabsContent value="onebot">
            <SectionCard title="OneBot 连接" description="NapCat 正向 WS 连接与群参数。">
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
                  <FieldLabel htmlFor="handoffTimeoutMin">转人工超时(分钟)</FieldLabel>
                  <Input id="handoffTimeoutMin" inputMode="numeric" value={num("handoffTimeoutMin")} onChange={(e) => upd("handoffTimeoutMin", e.target.value)} />
                  <FieldDescription>转人工后无人处理超过此时长自动恢复自动答。默认 30 分钟。</FieldDescription>
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
                            <Badge key={id} variant="secondary" className="cursor-pointer gap-1" onClick={() => toggleGroup(id)}>
                              {groupName(id)}
                              <X className="size-3" />
                            </Badge>
                          ))}
                        </div>
                      )}
                      <FieldDescription>
                        仅这些群里 bot 才会回复。也可在「生效群」页一键开关。
                      </FieldDescription>
                    </>
                  ) : (
                    <FieldDescription>
                      {groupsLoading ? "正在获取群列表…" : "bot 未连接,无法获取群列表。"}
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="extraAtQQs">额外监听 AT</FieldLabel>
                  {!cfg.enabledGroups.length ? (
                    <FieldDescription>请先选择生效群,再从群管理员中勾选。</FieldDescription>
                  ) : adminsLoading ? (
                    <FieldDescription>正在拉取生效群管理员…</FieldDescription>
                  ) : admins === null ? (
                    <FieldDescription>bot 未连接或无法获取群成员,请确认 OneBot 已连接。</FieldDescription>
                  ) : (
                    <>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button id="extraAtQQs" variant="outline" role="combobox" className="justify-between font-normal">
                            {cfg.extraAtQQs.length ? `已选 ${cfg.extraAtQQs.length} 人` : "选择群管理员"}
                            <ChevronsUpDown className="opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0" align="start">
                          <Command>
                            <CommandInput placeholder="搜索昵称或 QQ…" />
                            <CommandList>
                              <CommandEmpty>无匹配管理员</CommandEmpty>
                              <CommandGroup>
                                {admins.map((a) => (
                                  <CommandItem
                                    key={a.userId}
                                    value={`${a.name} ${a.userId} ${roleLabel(a.role)}`}
                                    onSelect={() => toggleExtraAt(a.userId)}
                                  >
                                    <Checkbox checked={cfg.extraAtQQs.includes(a.userId)} className="mr-2" />
                                    <span className="min-w-0 flex-1 truncate">
                                      {a.name} ({a.userId})
                                    </span>
                                    <span className="ml-2 shrink-0 text-muted-foreground text-xs">
                                      {roleLabel(a.role)}
                                      {a.groupIds.length > 1 ? ` · ${a.groupIds.length} 群` : ""}
                                    </span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {cfg.extraAtQQs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {cfg.extraAtQQs.map((qq) => (
                            <Badge key={qq} variant="secondary" className="cursor-pointer gap-1" onClick={() => toggleExtraAt(qq)}>
                              {adminLabel(qq)}
                              <X className="size-3" />
                            </Badge>
                          ))}
                        </div>
                      )}
                      <FieldDescription>
                        从生效群的群主/管理员中多选(跨群已去重,不含 Bot QQ)。群友 @ 这些人时也当作 @bot 处理。
                        {admins.length === 0 ? " 当前生效群未识别到管理员。" : ""}
                      </FieldDescription>
                    </>
                  )}
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="reply">
            <SectionCard title="回复体验" description="ACK、支持链接、长文拆条。">
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="ackEnabled"
                    checked={cfg.ackEnabled !== false}
                    onCheckedChange={(v) => setCfg({ ...cfg, ackEnabled: v === true })}
                  />
                  <FieldLabel htmlFor="ackEnabled">@ 后先回「收到,正在查」</FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor="supportUrl">支持链接(官网)</FieldLabel>
                  <Input id="supportUrl" value={cfg.supportUrl ?? ""} onChange={(e) => upd("supportUrl", e.target.value)} />
                  <FieldDescription>办不了订单/退款时引导此链接;帮助文案也会附带。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="maxReplyChars">单条字数上限</FieldLabel>
                  <Input id="maxReplyChars" inputMode="numeric" value={num("maxReplyChars")} onChange={(e) => upd("maxReplyChars", e.target.value)} />
                  <FieldDescription>超出按标点拆成多条发送。0 = 不拆。默认 900。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="usageBudgetUsd">日用量预算(USD)</FieldLabel>
                  <Input id="usageBudgetUsd" inputMode="decimal" value={num("usageBudgetUsd")} onChange={(e) => upd("usageBudgetUsd", e.target.value)} />
                  <FieldDescription>超过后向管理群告警。0 = 不告警。</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="sdk">
            <SectionCard
              title="Claude Agent SDK"
              description="模型、Base URL、Auth Token 等 SDK 凭证不由本程序管理,请直接编辑配置目录下的 settings.json。"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="claudeConfigDir">CLAUDE_CONFIG_DIR</FieldLabel>
                  <Input id="claudeConfigDir" value={cfg.claudeConfigDir} placeholder="./data/claude-config" onChange={(e) => upd("claudeConfigDir", e.target.value)} />
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="session">
            <SectionCard title="会话" description="空闲超时后开全新对话。">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="resumeTtlMin">会话空闲超时(分钟)</FieldLabel>
                  <Input
                    id="resumeTtlMin"
                    inputMode="numeric"
                    value={msToMin(cfg.resumeTtlMs)}
                    onChange={(e) => setCfg({ ...cfg, resumeTtlMs: minToMs(e.target.value) })}
                  />
                  <FieldDescription>默认 5 分钟。设 0 关闭超时。</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="reflect">
            <SectionCard title="反思(知识沉淀)" description="从人工答复沉淀知识。时间单位:分钟 / 小时。">
              <FieldGroup>
                <Field>
                  <FieldLabel>扫描间隔(分钟)</FieldLabel>
                  <Input inputMode="numeric" value={msToMin(cfg.reflectScanMs)} onChange={(e) => setCfg({ ...cfg, reflectScanMs: minToMs(e.target.value) })} />
                  <FieldDescription>默认 5 分钟。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>回看窗口(分钟)</FieldLabel>
                  <Input inputMode="numeric" value={msToMin(cfg.reflectLookbackMs)} onChange={(e) => setCfg({ ...cfg, reflectLookbackMs: minToMs(e.target.value) })} />
                  <FieldDescription>默认 120 分钟(2 小时)。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>静置阈值(分钟)</FieldLabel>
                  <Input inputMode="numeric" value={msToMin(cfg.reflectSettleMs)} onChange={(e) => setCfg({ ...cfg, reflectSettleMs: minToMs(e.target.value) })} />
                  <FieldDescription>默认 10 分钟。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reflectWindowMax">单窗最大消息数</FieldLabel>
                  <Input id="reflectWindowMax" inputMode="numeric" value={num("reflectWindowMax")} onChange={(e) => upd("reflectWindowMax", e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>整理周期(小时)</FieldLabel>
                  <Input inputMode="numeric" value={msToHr(cfg.reflectCompactMs)} onChange={(e) => setCfg({ ...cfg, reflectCompactMs: hrToMs(e.target.value) })} />
                  <FieldDescription>默认 24 小时。设 0 关闭自动整理。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reflectCompactMinEntries">整理最少条目</FieldLabel>
                  <Input id="reflectCompactMinEntries" inputMode="numeric" value={num("reflectCompactMinEntries")} onChange={(e) => upd("reflectCompactMinEntries", e.target.value)} />
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="proactive">
            <SectionCard title="主动回复" description="无人应答时谨慎补位。可在主动回复页一键开关。">
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="proactiveEnabled"
                    checked={cfg.proactiveEnabled}
                    onCheckedChange={(v) => setCfg({ ...cfg, proactiveEnabled: v === true })}
                  />
                  <FieldLabel htmlFor="proactiveEnabled">启用主动回复(全局)</FieldLabel>
                </Field>
                <Field>
                  <FieldLabel>静默阈值(分钟)</FieldLabel>
                  <Input inputMode="numeric" value={msToMin(cfg.proactiveSilenceMs)} onChange={(e) => setCfg({ ...cfg, proactiveSilenceMs: minToMs(e.target.value) })} />
                  <FieldDescription>默认 3 分钟无人应答才兜底。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>扫描间隔(分钟)</FieldLabel>
                  <Input inputMode="numeric" value={msToMin(cfg.proactiveScanMs)} onChange={(e) => setCfg({ ...cfg, proactiveScanMs: minToMs(e.target.value) })} />
                  <FieldDescription>默认 1 分钟。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="proactiveMaxPerScan">单次最多兜底数</FieldLabel>
                  <Input id="proactiveMaxPerScan" inputMode="numeric" value={num("proactiveMaxPerScan")} onChange={(e) => upd("proactiveMaxPerScan", e.target.value)} />
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="notify">
            <SectionCard title="通知" description="向管理群推送的运行时通知。">
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="reflectNotifyAdmin"
                    checked={cfg.reflectNotifyAdmin}
                    onCheckedChange={(v) => setCfg({ ...cfg, reflectNotifyAdmin: v === true })}
                  />
                  <FieldLabel htmlFor="reflectNotifyAdmin">反思通知管理群</FieldLabel>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="storage">
            <SectionCard title="存储" description="SQLite 数据库路径。">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="dbPath">数据库路径</FieldLabel>
                  <Input id="dbPath" value={cfg.dbPath} placeholder="./data/agent.db" onChange={(e) => upd("dbPath", e.target.value)} />
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
