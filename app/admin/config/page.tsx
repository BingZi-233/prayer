"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, KeyRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

interface Cfg {
  onebotWsUrl: string;
  onebotAccessToken: string;
  botQQ: number;
  adminGroupId: number;
  handoffTimeoutMin: number;
  dbPath: string;
  claudeConfigDir: string;
  model: string;
}

const NUM_KEYS: (keyof Cfg)[] = ["botQQ", "adminGroupId", "handoffTimeoutMin"];

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    fetch("/api/config").then((x) => x.json()).then((r) => { if (r.ok) setCfg(r.data); });
    fetch("/api/settings").then((x) => x.json()).then((r) => { if (r.ok) setSettings(r.data); });
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

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw: settings }),
      }).then((x) => x.json());
      if (r.ok) toast.success("settings.json 已保存(下次重启 / 热重载生效)");
      else toast.error(`保存失败:${r.error}`);
    } catch (e) {
      toast.error(`保存失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingSettings(false);
    }
  }

  const num = (k: keyof Cfg) => (cfg ? String(cfg[k]) : "");

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
                <CardDescription>NapCat 正向 WS 连接与群 / 转人工参数。</CardDescription>
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
                    <Input id="adminGroupId" inputMode="numeric" value={num("adminGroupId")} onChange={(e) => upd("adminGroupId", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="handoffTimeoutMin">转人工超时(分钟)</FieldLabel>
                    <Input id="handoffTimeoutMin" inputMode="numeric" value={num("handoffTimeoutMin")} onChange={(e) => upd("handoffTimeoutMin", e.target.value)} />
                    <FieldDescription>人工接管超过该时长未 !resume 则自动恢复自动应答。</FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sdk">
            <Card>
              <CardHeader>
                <CardTitle>Claude Agent SDK</CardTitle>
                <CardDescription>模型与凭证目录;env / 权限等写入下方 settings.json。</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="model">模型</FieldLabel>
                    <Input id="model" value={cfg.model} placeholder="claude-sonnet-5" onChange={(e) => upd("model", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="claudeConfigDir">CLAUDE_CONFIG_DIR</FieldLabel>
                    <Input id="claudeConfigDir" value={cfg.claudeConfigDir} placeholder="./data/claude-config" onChange={(e) => upd("claudeConfigDir", e.target.value)} />
                    <FieldDescription>settings.json 存于此目录,SDK 经 settingSources 加载。</FieldDescription>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            SDK settings.json(高级)
          </CardTitle>
          <CardDescription>
            SDK 认证 / env(ANTHROPIC_BASE_URL / AUTH_TOKEN / MODEL 等)与权限。写入 CLAUDE_CONFIG_DIR/settings.json。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={settings}
            onChange={(e) => setSettings(e.target.value)}
            className="min-h-[240px] font-mono text-xs"
            spellCheck={false}
          />
        </CardContent>
        <CardFooter>
          <Button variant="secondary" onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            保存 settings.json
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
