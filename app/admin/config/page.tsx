"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState("");
  const [sMsg, setSMsg] = useState("");

  useEffect(() => {
    fetch("/api/config").then((x) => x.json()).then((r) => { if (r.ok) setCfg(r.data); });
    fetch("/api/settings").then((x) => x.json()).then((r) => { if (r.ok) setSettings(r.data); });
  }, []);

  async function saveSettings() {
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: settings }),
    }).then((x) => x.json());
    setSMsg(r.ok ? "settings.json 已保存(下次重启/热重载生效)" : `失败:${r.error}`);
  }

  function upd(k: keyof Cfg, v: string) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: NUM_KEYS.includes(k) ? Number(v) : v });
  }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setMsg("");
    // token 若仍是掩码(含 •)则不提交该字段
    const payload: Partial<Cfg> = { ...cfg };
    if (typeof payload.onebotAccessToken === "string" && payload.onebotAccessToken.includes("•")) {
      delete payload.onebotAccessToken;
    }
    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((x) => x.json());
    setMsg(r.ok ? "已保存并热重载" : `失败:${r.error}`);
    if (r.ok) setCfg(r.data);
    setBusy(false);
  }

  if (!cfg) return <div>加载中…</div>;

  const fields: { k: keyof Cfg; label: string; secret?: boolean }[] = [
    { k: "onebotWsUrl", label: "OneBot WS 地址" },
    { k: "onebotAccessToken", label: "OneBot Access Token", secret: true },
    { k: "botQQ", label: "Bot QQ" },
    { k: "adminGroupId", label: "管理群号" },
    { k: "handoffTimeoutMin", label: "转人工超时(分钟)" },
    { k: "model", label: "模型" },
    { k: "claudeConfigDir", label: "CLAUDE_CONFIG_DIR" },
    { k: "dbPath", label: "数据库路径" },
  ];

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold">配置</h1>
      <Card className="flex flex-col gap-3 p-4">
        {fields.map((f) => (
          <div key={f.k} className="flex flex-col gap-1">
            <Label htmlFor={f.k}>{f.label}</Label>
            <Input
              id={f.k}
              value={String(cfg[f.k])}
              placeholder={f.secret ? "留空不修改" : ""}
              onChange={(e) => upd(f.k, e.target.value)}
            />
          </div>
        ))}
      </Card>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>{busy ? "保存中…" : "保存并热重载"}</Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
      <Card className="flex flex-col gap-3 p-4">
        <Label>SDK settings.json(高级)</Label>
        <Textarea
          value={settings}
          onChange={(e) => setSettings(e.target.value)}
          className="min-h-[240px] font-mono text-xs"
        />
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={saveSettings}>保存 settings.json</Button>
          {sMsg && <span className="text-sm text-muted-foreground">{sMsg}</span>}
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        提示:SDK 认证/env(ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL 等)写在上方 settings.json,存入 CLAUDE_CONFIG_DIR;query 经 settingSources 加载。
      </p>
    </div>
  );
}
