"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, ChevronsUpDown, X } from "lucide-react";
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
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  enabledGroups: number[];
  reflectScanMs: number;
  reflectLookbackMs: number;
  reflectSettleMs: number;
  reflectWindowMax: number;
  proactiveEnabled: boolean;
  proactiveScanMs: number;
  proactiveSilenceMs: number;
  proactiveMaxPerScan: number;
}

const NUM_KEYS: (keyof Cfg)[] = [
  "botQQ",
  "adminGroupId",
  "handoffTimeoutMin",
  "reflectScanMs",
  "reflectLookbackMs",
  "reflectSettleMs",
  "reflectWindowMax",
  "proactiveScanMs",
  "proactiveSilenceMs",
  "proactiveMaxPerScan",
];

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
      <PageHeader
        title="配置"
        description="修改后保存即热重载,无需重启进程。密钥字段留空表示不修改。"
        actions={
          <Button onClick={save} disabled={busy || !cfg}>
            {busy ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {busy ? "保存中…" : "保存并热重载"}
          </Button>
        }
      />

      {!cfg ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <Tabs defaultValue="onebot">
          <TabsList>
            <TabsTrigger value="onebot">OneBot</TabsTrigger>
            <TabsTrigger value="sdk">Claude SDK</TabsTrigger>
            <TabsTrigger value="reflect">反思</TabsTrigger>
            <TabsTrigger value="proactive">主动回复</TabsTrigger>
            <TabsTrigger value="storage">存储</TabsTrigger>
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
                  <FieldDescription>转人工后无人处理超过此时长自动回收工单。默认 30。</FieldDescription>
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
            </SectionCard>
          </TabsContent>

          <TabsContent value="sdk">
            <SectionCard
              title="Claude Agent SDK"
              description="模型、Base URL、Auth Token 等 SDK 凭证不由本程序管理,请直接编辑配置目录下的 settings.json 的 env 块(ANTHROPIC_MODEL / ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)。"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="claudeConfigDir">CLAUDE_CONFIG_DIR</FieldLabel>
                  <Input id="claudeConfigDir" value={cfg.claudeConfigDir} placeholder="./data/claude-config" onChange={(e) => upd("claudeConfigDir", e.target.value)} />
                  <FieldDescription>SDK 认证与配置目录。模型与中转凭证在此目录的 settings.json 内维护,本程序不读写这些字段。</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="reflect">
            <SectionCard title="反思(知识沉淀)" description="后台周期性回看群聊,把人工答复沉淀为 kb 的 human-reflection 条目供 Agent 检索。">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="reflectScanMs">扫描间隔(毫秒)</FieldLabel>
                  <Input id="reflectScanMs" inputMode="numeric" value={num("reflectScanMs")} onChange={(e) => upd("reflectScanMs", e.target.value)} />
                  <FieldDescription>反思轮询周期。默认 300000(5 分钟)。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reflectLookbackMs">回看窗口(毫秒)</FieldLabel>
                  <Input id="reflectLookbackMs" inputMode="numeric" value={num("reflectLookbackMs")} onChange={(e) => upd("reflectLookbackMs", e.target.value)} />
                  <FieldDescription>每次反思往回看多久的聊天记录。默认 7200000(2 小时)。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reflectSettleMs">静置阈值(毫秒)</FieldLabel>
                  <Input id="reflectSettleMs" inputMode="numeric" value={num("reflectSettleMs")} onChange={(e) => upd("reflectSettleMs", e.target.value)} />
                  <FieldDescription>对话静置超过此时长才纳入反思,避免打断进行中的会话。默认 600000(10 分钟)。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reflectWindowMax">单窗最大消息数</FieldLabel>
                  <Input id="reflectWindowMax" inputMode="numeric" value={num("reflectWindowMax")} onChange={(e) => upd("reflectWindowMax", e.target.value)} />
                  <FieldDescription>单次反思送入的最大消息条数。默认 60。</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="proactive">
            <SectionCard title="主动回复(无人应答兜底)" description="群里有人提问但一段时间无人应答时,bot 主动补一句。仅对生效群生效;人工已接管或主链路已答则沉默。">
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="proactiveEnabled"
                    checked={cfg.proactiveEnabled}
                    onCheckedChange={(v) => cfg && setCfg({ ...cfg, proactiveEnabled: v === true })}
                  />
                  <FieldLabel htmlFor="proactiveEnabled">启用主动回复</FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor="proactiveSilenceMs">静默阈值(毫秒)</FieldLabel>
                  <Input id="proactiveSilenceMs" inputMode="numeric" value={num("proactiveSilenceMs")} onChange={(e) => upd("proactiveSilenceMs", e.target.value)} />
                  <FieldDescription>问题发出后无人应答超过此时长才兜底。默认 180000(3 分钟)。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="proactiveScanMs">扫描间隔(毫秒)</FieldLabel>
                  <Input id="proactiveScanMs" inputMode="numeric" value={num("proactiveScanMs")} onChange={(e) => upd("proactiveScanMs", e.target.value)} />
                  <FieldDescription>轮询检查未应答问题的周期。默认 60000(1 分钟)。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="proactiveMaxPerScan">单次最多兜底数</FieldLabel>
                  <Input id="proactiveMaxPerScan" inputMode="numeric" value={num("proactiveMaxPerScan")} onChange={(e) => upd("proactiveMaxPerScan", e.target.value)} />
                  <FieldDescription>每轮扫描最多主动回复几条,防刷屏。溢出保留到下轮,不丢弃。默认 2。</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="storage">
            <SectionCard title="存储" description="SQLite 数据库路径(会话 / 知识库 / 配置)。">
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
