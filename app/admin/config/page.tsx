"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
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
  enabledGroups: number[];
}

const NUM_KEYS: (keyof Cfg)[] = ["botQQ", "adminGroupId", "handoffTimeoutMin"];

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  // 生效群:本地原始文本 state,失焦(onBlur)才 parse 提交到 cfg.enabledGroups
  const [groupsText, setGroupsText] = useState("");

  useEffect(() => {
    fetch("/api/config").then((x) => x.json()).then((r) => {
      if (r.ok) {
        setCfg(r.data);
        setGroupsText(((r.data.enabledGroups ?? []) as number[]).join("\n"));
      }
    });
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
        setGroupsText(((r.data.enabledGroups ?? []) as number[]).join("\n"));
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

  // 失焦时才把本地文本 parse 成 number[] 提交到 cfg
  function commitGroups() {
    if (!cfg) return;
    const ids = groupsText
      .split(/[\s,]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    setCfg({ ...cfg, enabledGroups: Array.from(new Set(ids)) });
  }

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
                    <Input id="adminGroupId" inputMode="numeric" value={num("adminGroupId")} onChange={(e) => upd("adminGroupId", e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="enabledGroups">生效群</FieldLabel>
                    <Textarea
                      id="enabledGroups"
                      className="min-h-24"
                      value={groupsText}
                      placeholder="每行一个群号,或逗号分隔"
                      onChange={(e) => setGroupsText(e.target.value)}
                      onBlur={commitGroups}
                    />
                    <FieldDescription>
                      仅这些群里 bot 才会回复 / 缓冲 / 沉淀知识。留空 = 对所有群都不响应。管理群不受此列表影响。
                    </FieldDescription>
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
