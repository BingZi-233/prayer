"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
} from "@/components/ui/field"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { DEFAULT_BRAND } from "@/lib/brand"

function LoginForm() {
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const params = useSearchParams()
  const from = params.get("from") || "/admin"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }).then((x) => x.json())
      if (r.ok) {
        toast.success("已登录")
        router.replace(from.startsWith("/admin") ? from : "/admin")
      } else {
        toast.error(r.error || "登录失败")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="size-4" />
          </div>
          {DEFAULT_BRAND.name} 客服中台
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">登录后台</CardTitle>
            <CardDescription>
              输入 ADMIN_TOKEN 口令。未配置环境变量时无需登录。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} aria-busy={busy}>
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
                  <FieldDescription>
                    与部署环境中的 ADMIN_TOKEN 一致。
                  </FieldDescription>
                </Field>
                <Button
                  type="submit"
                  disabled={busy || !token}
                  className="w-full"
                >
                  {busy ? <Spinner data-icon="inline-start" /> : null}
                  {busy ? "登录中…" : "登录"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <p className="self-center text-xs text-muted-foreground">
          管理口令仅用于本地后台访问，请勿分享给他人。
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
