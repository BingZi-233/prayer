"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldGroup, FieldDescription } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

function LoginForm() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/admin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }).then((x) => x.json());
      if (r.ok) {
        toast.success("已登录");
        router.replace(from.startsWith("/admin") ? from : "/admin");
      } else {
        toast.error(r.error || "登录失败");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-3">
        <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg">
          <Bot className="size-5" />
        </div>
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="text-sm font-semibold">客服 Agent</span>
          <span className="text-muted-foreground text-xs">管理后台</span>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>输入 ADMIN_TOKEN 口令。未配置环境变量时无需登录。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="token">口令</FieldLabel>
                <Input
                  id="token"
                  type="password"
                  autoComplete="current-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ADMIN_TOKEN"
                />
                <FieldDescription>与部署环境中的 ADMIN_TOKEN 一致。</FieldDescription>
              </Field>
              <Button type="submit" disabled={busy || !token} className="w-full">
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {busy ? "登录中…" : "登录"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
