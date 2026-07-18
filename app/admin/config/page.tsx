"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Save,
  ChevronsUpDown,
  X,
  Cable,
  Send,
  MessageSquareText,
  Bot,
  MessagesSquare,
  Brain,
  Zap,
  Bell,
  HardDrive,
  Plus,
  Shield,
  TriangleAlert,
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
import { PageShell } from "@/components/admin/page-shell";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { ChannelDot } from "@/components/channel-status-lights";
import { useLive } from "@/components/live-provider";

interface ChatRef {
  channel: "qq" | "tg" | "discord";
  chatId: string;
}

interface Cfg {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  extraAtQQs: number[];
  /** 管理命令 + 通知面；null = 无 */
  adminSurface: ChatRef | null;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  /** 跨通道生效会话 */
  enabledChats: ChatRef[];
  /** 空 = 不启 TG；掩码显示，留空不覆盖 */
  telegramBotToken: string;
  reflectScanMs: number;
  reflectLookbackMs: number;
  reflectSettleMs: number;
  reflectWindowMax: number;
  reflectCompactMs: number;
  reflectCompactMinEntries: number;
  reflectPromoteMs: number;
  reflectPromoteMinEntries: number;
  reflectPromoteMaxPerRun: number;
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

function qqChatIds(chats: ChatRef[]): number[] {
  return chats
    .filter((c) => c.channel === "qq")
    .map((c) => Number(c.chatId))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function tgChatIds(chats: ChatRef[]): string[] {
  return chats.filter((c) => c.channel === "tg").map((c) => c.chatId);
}

function withQqChats(chats: ChatRef[], ids: number[]): ChatRef[] {
  return [
    ...chats.filter((c) => c.channel !== "qq"),
    ...ids.map((id) => ({ channel: "qq" as const, chatId: String(id) })),
  ];
}

function withTgChats(chats: ChatRef[], ids: string[]): ChatRef[] {
  return [
    ...chats.filter((c) => c.channel !== "tg"),
    ...ids.map((id) => ({ channel: "tg" as const, chatId: id })),
  ];
}

function adminQqId(surface: ChatRef | null | undefined): number {
  if (surface?.channel === "qq") {
    const n = Number(surface.chatId);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

interface AdminCandidate {
  userId: number;
  name: string;
  role: "owner" | "admin";
  groupIds: number[];
}

const NUM_KEYS: (keyof Cfg)[] = [
  "botQQ",
  "handoffTimeoutMin",
  "reflectScanMs",
  "reflectLookbackMs",
  "reflectSettleMs",
  "reflectWindowMax",
  "reflectCompactMs",
  "reflectCompactMinEntries",
  "reflectPromoteMs",
  "reflectPromoteMinEntries",
  "reflectPromoteMaxPerRun",
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
  const { status } = useLive();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<{ groupId: number; groupName: string }[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [admins, setAdmins] = useState<AdminCandidate[] | null>(null);
  const [adminsLoading, setAdminsLoading] = useState(false);
  /** 待加入的 TG chat id 草稿（点添加 / 保存时合并） */
  const [tgChatDraft, setTgChatDraft] = useState("");
  /** chatId 字符串 → 显示名（/api/chats/names，含 TG 负 id） */
  const [chatNames, setChatNames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/config").then((x) => x.json()).then((r) => {
      if (r.ok) {
        const data = r.data as Cfg;
        setCfg({
          ...data,
          groupPolicies: data.groupPolicies ?? {},
          supportUrl: data.supportUrl ?? "https://www.packyapi.com",
          ackEnabled: data.ackEnabled !== false,
          maxReplyChars: data.maxReplyChars ?? 900,
          usageBudgetUsd: data.usageBudgetUsd ?? 0,
          extraAtQQs: data.extraAtQQs ?? [],
          telegramBotToken: data.telegramBotToken ?? "",
          enabledChats: Array.isArray(data.enabledChats) ? data.enabledChats : [],
          adminSurface: data.adminSurface ?? null,
        });
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

  // 多通道会话显示名（TG 负 id 以 Number 映射）
  useEffect(() => {
    fetch("/api/chats/names")
      .then((x) => x.json())
      .then((r) => {
        if (!r.ok || !Array.isArray(r.data)) return;
        const map: Record<string, string> = {};
        for (const row of r.data as { groupId: number; groupName: string }[]) {
          map[String(row.groupId)] = row.groupName;
        }
        setChatNames(map);
      })
      .catch(() => {
        /* 名称仅展示用，失败静默 */
      });
  }, []);

  // QQ 生效群变化后重拉跨群管理员名单(去重)。服务端 name-cache(含 role)命中时几乎瞬时。
  const enabledQq = cfg ? qqChatIds(cfg.enabledChats) : [];
  const enabledKey = enabledQq.slice().sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!cfg) return;
    if (!enabledQq.length) {
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
    // 仅随 QQ 生效群集合变化刷新;cfg 本体其它字段不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey]);

  function upd(k: keyof Cfg, v: string) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: NUM_KEYS.includes(k) ? Number(v) : v });
  }

  /** 从草稿/批量文本拆出 chat id（字符串原样，禁止 Number） */
  function parseChatIdParts(text: string): string[] {
    return text
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function mergeTgChats(base: string[], ...extraTexts: string[]): string[] {
    const set = new Set((base ?? []).map(String));
    for (const t of extraTexts) {
      for (const id of parseChatIdParts(t)) set.add(id);
    }
    return Array.from(set);
  }

  async function save() {
    if (!cfg) return;
    // 管理面校验：已选通道则 chatId 必填
    if (cfg.adminSurface && !cfg.adminSurface.chatId.trim()) {
      toast.error("管理面已选通道但未填会话");
      return;
    }
    // TG 管理面但 token 真正为空（非掩码）时仅警告，仍允许保存
    if (
      cfg.adminSurface?.channel === "tg" &&
      !(cfg.telegramBotToken ?? "").includes("•") &&
      !(cfg.telegramBotToken ?? "").trim()
    ) {
      toast.message("管理面为 TG 但未配置 Bot Token，通知可能发送失败");
    }
    setBusy(true);
    // 保存前把输入框未点「添加」的内容一并写入
    const tgIds = mergeTgChats(tgChatIds(cfg.enabledChats), tgChatDraft);
    const enabledChats = withTgChats(cfg.enabledChats, tgIds);
    const payload: Partial<Cfg> = {
      ...cfg,
      enabledChats,
      // chatId 去空白，避免 isAdminSurface 精确匹配失败
      adminSurface: cfg.adminSurface
        ? {
            channel: cfg.adminSurface.channel,
            chatId: cfg.adminSurface.chatId.trim(),
          }
        : null,
    };
    if (typeof payload.onebotAccessToken === "string" && payload.onebotAccessToken.includes("•")) {
      delete payload.onebotAccessToken;
    }
    if (typeof payload.telegramBotToken === "string" && payload.telegramBotToken.includes("•")) {
      delete payload.telegramBotToken;
    }
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then((x) => x.json());
      if (r.ok) {
        const data = r.data as Cfg;
        const saved = Array.isArray(data.enabledChats) ? data.enabledChats : enabledChats;
        const savedTg = tgChatIds(saved);
        setCfg({
          ...data,
          groupPolicies: data.groupPolicies ?? {},
          extraAtQQs: data.extraAtQQs ?? [],
          telegramBotToken: data.telegramBotToken ?? "",
          enabledChats: saved,
          adminSurface: data.adminSurface ?? null,
        });
        setTgChatDraft("");
        if (savedTg.length === 0 && !cfg.telegramBotToken) {
          toast.success("配置已保存并生效");
        } else if (savedTg.length === 0) {
          toast.success("配置已保存（TG 生效 Chat 仍为空，@bot 不会应答）");
        } else {
          toast.success(`配置已保存并生效（TG ${savedTg.length} 个 chat）`);
        }
      } else {
        toast.error(`保存失败:${r.error}`);
      }
    } catch (e) {
      toast.error(`保存失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function addTgChat() {
    if (!cfg) return;
    const id = tgChatDraft.trim();
    if (!id) return;
    // 禁止 Number 化：超级群 id 常为负大整数，字符串原样保留
    const next = mergeTgChats(tgChatIds(cfg.enabledChats), id);
    setCfg({ ...cfg, enabledChats: withTgChats(cfg.enabledChats, next) });
    setTgChatDraft("");
  }

  function removeTgChat(id: string) {
    if (!cfg) return;
    const next = tgChatIds(cfg.enabledChats).filter((c) => c !== id);
    setCfg({ ...cfg, enabledChats: withTgChats(cfg.enabledChats, next) });
  }

  const num = (k: keyof Cfg) => (cfg ? String(cfg[k] ?? "") : "");

  function toggleGroup(id: number) {
    if (!cfg) return;
    const set = new Set(qqChatIds(cfg.enabledChats));
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setCfg({ ...cfg, enabledChats: withQqChats(cfg.enabledChats, Array.from(set)) });
  }

  /** 管理面通道：none → null；qq/tg → { channel, chatId }（chatId 可暂空） */
  function setAdminChannel(channel: "none" | "qq" | "tg") {
    if (!cfg) return;
    if (channel === "none") {
      setCfg({ ...cfg, adminSurface: null });
      return;
    }
    const prev = cfg.adminSurface;
    setCfg({
      ...cfg,
      adminSurface: {
        channel,
        chatId: prev?.channel === channel ? prev.chatId : "",
      },
    });
  }

  function setAdminChatId(chatId: string) {
    if (!cfg || !cfg.adminSurface) return;
    setCfg({
      ...cfg,
      adminSurface: { ...cfg.adminSurface, chatId },
    });
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
  const adminQq = adminQqId(cfg?.adminSurface);
  const adminGroupOptions = (): { groupId: number; groupName: string }[] => {
    if (!groups) return [];
    if (adminQq && !groups.some((g) => g.groupId === adminQq)) {
      return [{ groupId: adminQq, groupName: String(adminQq) }, ...groups];
    }
    return groups;
  };
  /** TG 管理面：生效列表 + 当前 chatId 不在列表时注入占位 */
  const adminTgOptions = (): string[] => {
    const ids = cfg ? tgChatIds(cfg.enabledChats) : [];
    const cur =
      cfg?.adminSurface?.channel === "tg" ? cfg.adminSurface.chatId.trim() : "";
    if (cur && !ids.includes(cur)) return [cur, ...ids];
    return ids;
  };
  const enabledQqIds = cfg ? qqChatIds(cfg.enabledChats) : [];
  const enabledTgIds = cfg ? tgChatIds(cfg.enabledChats) : [];

  const tgChannel = useMemo(
    () => status?.channels?.find((c) => c.id === "tg"),
    [status?.channels]
  );
  const tgTokenConfigured =
    !!cfg &&
    ((cfg.telegramBotToken ?? "").includes("•") ||
      !!(cfg.telegramBotToken ?? "").trim());
  const tgBypassWarn = !!(
    tgChannel?.detail &&
    /bypass-off|privacy/i.test(tgChannel.detail)
  );
  const tgChatTitle = (id: string) => {
    const n = chatNames[id] ?? chatNames[String(Number(id))];
    if (n && n !== id && n !== String(Number(id))) return n;
    return null;
  };

  return (
    <PageShell>
      <PageHeader
        title="配置"
        description="修改后保存即生效。通道连接与业务参数分栏。"
        actions={
          <Button onClick={save} disabled={busy || !cfg}>
            {busy ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {busy ? "保存中…" : "保存并生效"}
          </Button>
        }
      />

      {!cfg && <Skeleton className="h-72 w-full" />}

      {cfg && (
        <Tabs defaultValue="qq">
          <TabsList className="h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="qq"><Cable data-icon="inline-start" /> QQ 通道</TabsTrigger>
            <TabsTrigger value="tg"><Send data-icon="inline-start" /> TG 通道</TabsTrigger>
            <TabsTrigger value="admin"><Shield data-icon="inline-start" /> 管理面</TabsTrigger>
            <TabsTrigger value="reply"><MessageSquareText data-icon="inline-start" /> 回复体验</TabsTrigger>
            <TabsTrigger value="session"><MessagesSquare data-icon="inline-start" /> 会话</TabsTrigger>
            <TabsTrigger value="reflect"><Brain data-icon="inline-start" /> 反思</TabsTrigger>
            <TabsTrigger value="proactive"><Zap data-icon="inline-start" /> 主动回复</TabsTrigger>
            <TabsTrigger value="notify"><Bell data-icon="inline-start" /> 通知</TabsTrigger>
            <TabsTrigger value="sdk"><Bot data-icon="inline-start" /> Claude SDK</TabsTrigger>
            <TabsTrigger value="storage"><HardDrive data-icon="inline-start" /> 存储</TabsTrigger>
          </TabsList>

          <TabsContent value="qq">
            <SectionCard title="QQ 通道" description="OneBot 连接地址与群相关参数。">
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
                  <FieldLabel htmlFor="enabledChatsQq">生效群</FieldLabel>
                  {groups ? (
                    <>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button id="enabledChatsQq" variant="outline" role="combobox" className="justify-between font-normal">
                            {enabledQqIds.length ? `已选 ${enabledQqIds.length} 个群` : "选择生效群"}
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
                                    <Checkbox checked={enabledQqIds.includes(g.groupId)} className="mr-2" />
                                    {g.groupName} ({g.groupId})
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {enabledQqIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {enabledQqIds.map((id) => (
                            <Badge key={id} variant="secondary" className="cursor-pointer gap-1" onClick={() => toggleGroup(id)}>
                              {groupName(id)}
                              <X className="size-3" />
                            </Badge>
                          ))}
                        </div>
                      )}
                      <FieldDescription>
                        仅这些群里 bot 才会回复。也可在「生效会话」页一键开关。
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
                  {!enabledQqIds.length ? (
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

          <TabsContent value="tg" className="space-y-4">
            {/* 1. 连接 */}
            <SectionCard
              title="连接"
              description="token 非空时注册 long poll，与 QQ 并行。同 token 仅允许单进程 poll（pm2 fork 单实例）。"
              icon={Send}
              action={
                tgChannel ? (
                  <ChannelDot ch={tgChannel} />
                ) : !tgTokenConfigured ? (
                  <span className="text-muted-foreground text-xs">未配置</span>
                ) : (
                  <span className="text-muted-foreground text-xs">状态同步中…</span>
                )
              }
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="telegramBotToken">Bot Token</FieldLabel>
                  <Input
                    id="telegramBotToken"
                    value={cfg.telegramBotToken ?? ""}
                    placeholder="留空不修改；清空需先保存再在环境/库中清"
                    onChange={(e) => setCfg({ ...cfg, telegramBotToken: e.target.value })}
                    autoComplete="off"
                  />
                  <FieldDescription>
                    来自 @BotFather。已保存密钥以掩码显示，留空或不改动则保留原值。token 为空则不启动 TG 通道。
                  </FieldDescription>
                </Field>
                {!tgTokenConfigured && (
                  <p className="text-muted-foreground text-sm">
                    未配置：填写 Token 并保存后启动 TG 通道。
                  </p>
                )}
                {tgChannel?.lastError && (
                  <div className="border-destructive/40 bg-destructive/5 text-destructive flex gap-2 rounded-md border px-3 py-2 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium">通道异常</p>
                      <p className="text-destructive/90 break-all text-xs">{tgChannel.lastError}</p>
                    </div>
                  </div>
                )}
                {tgBypassWarn && (
                  <div className="border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-200 flex gap-2 rounded-md border px-3 py-2 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium">旁路已降级</p>
                      <p className="text-xs opacity-90">
                        运行状态 detail 提示 Privacy / bypass 关闭：反思与主动补位可能不可用。
                        请在 @BotFather 关闭 Group Privacy Mode，并将 bot 重新拉进群。
                        {tgChannel?.detail ? (
                          <>
                            {" "}
                            <code className="text-[10px]">{tgChannel.detail}</code>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                )}
              </FieldGroup>
            </SectionCard>

            {/* 2. 生效会话 */}
            <SectionCard
              title="生效会话"
              description="仅白名单内超级群/群会应答。也可在「生效会话」页开关与策略覆盖。"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="tgChatDraft">添加 Chat ID</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="tgChatDraft"
                      value={tgChatDraft}
                      placeholder="如 -1001234567890"
                      className="font-mono text-sm"
                      onChange={(e) => setTgChatDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTgChat();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addTgChat} className="shrink-0">
                      <Plus data-icon="inline-start" />
                      添加
                    </Button>
                  </div>
                  <FieldDescription>
                    id 按字符串保存（可负号）。Enter 或点添加写入列表；保存时也会合并未点添加的输入。
                  </FieldDescription>
                </Field>

                {enabledTgIds.length > 0 ? (
                  <ul className="divide-border divide-y rounded-md border">
                    {enabledTgIds.map((id) => {
                      const title = tgChatTitle(id);
                      return (
                        <li
                          key={id}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <div className="min-w-0 flex flex-col">
                            {title ? (
                              <span className="truncate font-medium">{title}</span>
                            ) : null}
                            <span className="text-muted-foreground font-mono text-xs">{id}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                            onClick={() => removeTgChat(id)}
                            aria-label={`移除 ${id}`}
                          >
                            <X className="size-4" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    尚未添加会话。添加后 bot 才会在对应群内 @ 应答。
                  </p>
                )}
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="admin">
            <SectionCard
              title="管理面"
              description="转人工/反思/用量告警抄送与 !reset / !resume 落点。可与生效白名单无关。"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="adminChannel">通道</FieldLabel>
                  <Select
                    value={cfg.adminSurface?.channel ?? "none"}
                    onValueChange={(v) => setAdminChannel(v as "none" | "qq" | "tg")}
                  >
                    <SelectTrigger id="adminChannel">
                      <SelectValue placeholder="选择管理面通道" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">无</SelectItem>
                      <SelectItem value="qq">QQ</SelectItem>
                      <SelectItem value="tg">Telegram</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>选择通知与管理命令落点通道；选「无」关闭管理面。</FieldDescription>
                </Field>

                {cfg.adminSurface?.channel === "qq" && (
                  <Field>
                    <FieldLabel htmlFor="adminSurfaceQq">管理群</FieldLabel>
                    {groups ? (
                      <Select
                        value={adminQq ? String(adminQq) : ""}
                        onValueChange={(v) => setAdminChatId(v)}
                      >
                        <SelectTrigger id="adminSurfaceQq">
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
                        {groupsLoading
                          ? "正在获取群列表…"
                          : "bot 未连接,无法获取群列表。请先填写 QQ 通道连接并启动 bot。"}
                      </FieldDescription>
                    )}
                  </Field>
                )}

                {cfg.adminSurface?.channel === "tg" && (
                  <Field>
                    <FieldLabel htmlFor="adminSurfaceTg">管理 Chat ID</FieldLabel>
                    {adminTgOptions().length > 0 && (
                      <Select
                        value={
                          cfg.adminSurface.chatId &&
                          adminTgOptions().includes(cfg.adminSurface.chatId)
                            ? cfg.adminSurface.chatId
                            : ""
                        }
                        onValueChange={(v) => setAdminChatId(v)}
                      >
                        <SelectTrigger id="adminSurfaceTgSelect">
                          <SelectValue placeholder="从生效 Chat 中选择" />
                        </SelectTrigger>
                        <SelectContent>
                          {adminTgOptions().map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      id="adminSurfaceTg"
                      className="mt-2 font-mono"
                      value={cfg.adminSurface.chatId}
                      placeholder="如 -1001234567890（可负号，字符串原样）"
                      onChange={(e) => setAdminChatId(e.target.value)}
                    />
                    <FieldDescription>
                      可从已生效 TG Chat 选择，或直接输入任意 chat id（不必在白名单内）。
                    </FieldDescription>
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="handoffTimeoutMin">转人工超时(分钟)</FieldLabel>
                  <Input
                    id="handoffTimeoutMin"
                    inputMode="numeric"
                    value={num("handoffTimeoutMin")}
                    onChange={(e) => upd("handoffTimeoutMin", e.target.value)}
                  />
                  <FieldDescription>
                    转人工后无人处理超过此时长自动恢复自动答。默认 30 分钟。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="reply">
            <SectionCard title="回复体验" description="收到消息确认、支持链接与长文拆分。">
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
                  <FieldDescription>超过后向管理面告警。0 = 不告警。</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="sdk">
            <SectionCard
              title="Claude Agent SDK"
              description="模型与 API 密钥请直接编辑配置目录下的 settings.json，本页仅管理配置路径。"
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
            <SectionCard title="会话" description="空闲超时后开启新对话。">
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
            <SectionCard title="反思(知识沉淀)" description="从人工答复提炼知识。时间单位：分钟 / 小时。">
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
                <Field>
                  <FieldLabel>自动升格周期(小时)</FieldLabel>
                  <Input inputMode="numeric" value={msToHr(cfg.reflectPromoteMs)} onChange={(e) => setCfg({ ...cfg, reflectPromoteMs: hrToMs(e.target.value) })} />
                  <FieldDescription>Agent 评审高质量反思并固化为正式文档。默认 24 小时。设 0 关闭。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reflectPromoteMinEntries">升格最少候选</FieldLabel>
                  <Input id="reflectPromoteMinEntries" inputMode="numeric" value={num("reflectPromoteMinEntries")} onChange={(e) => upd("reflectPromoteMinEntries", e.target.value)} />
                  <FieldDescription>候选(已入库未升格)达到此数才调 LLM。默认 1。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reflectPromoteMaxPerRun">单轮最多升格</FieldLabel>
                  <Input id="reflectPromoteMaxPerRun" inputMode="numeric" value={num("reflectPromoteMaxPerRun")} onChange={(e) => upd("reflectPromoteMaxPerRun", e.target.value)} />
                  <FieldDescription>防止一次升格过多。默认 5。</FieldDescription>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="proactive">
            <SectionCard title="主动回复" description="无人应答时谨慎补位。也可在主动回复页一键开关。">
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
                  <FieldDescription>默认 3 分钟无人应答才主动补位。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>扫描间隔(分钟)</FieldLabel>
                  <Input inputMode="numeric" value={msToMin(cfg.proactiveScanMs)} onChange={(e) => setCfg({ ...cfg, proactiveScanMs: minToMs(e.target.value) })} />
                  <FieldDescription>默认 1 分钟。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="proactiveMaxPerScan">单次最多补位数</FieldLabel>
                  <Input id="proactiveMaxPerScan" inputMode="numeric" value={num("proactiveMaxPerScan")} onChange={(e) => upd("proactiveMaxPerScan", e.target.value)} />
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="notify">
            <SectionCard title="通知" description="向管理面推送的运行通知。">
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="reflectNotifyAdmin"
                    checked={cfg.reflectNotifyAdmin}
                    onCheckedChange={(v) => setCfg({ ...cfg, reflectNotifyAdmin: v === true })}
                  />
                  <FieldLabel htmlFor="reflectNotifyAdmin">反思通知管理面</FieldLabel>
                </Field>
              </FieldGroup>
            </SectionCard>
          </TabsContent>

          <TabsContent value="storage">
            <SectionCard title="存储" description="数据库文件路径。">
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
    </PageShell>
  );
}
