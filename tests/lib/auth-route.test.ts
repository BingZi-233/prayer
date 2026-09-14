import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/auth/login/route"

afterEach(() => {
  vi.unstubAllEnvs()
})

function login() {
  return POST(
    new NextRequest("https://admin.example/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "cookie-test-token" }),
    })
  )
}

describe("admin auth cookie", () => {
  it("sets Secure only in production", async () => {
    vi.stubEnv("ADMIN_TOKEN", "cookie-test-token")
    vi.stubEnv("NODE_ENV", "production")
    expect((await login()).headers.get("set-cookie")).toMatch(/Secure/i)

    vi.stubEnv("NODE_ENV", "development")
    expect((await login()).headers.get("set-cookie")).not.toMatch(/Secure/i)
  })
})
