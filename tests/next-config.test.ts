import { afterEach, describe, expect, it, vi } from "vitest"
import nextConfig from "@/next.config"

afterEach(() => {
  vi.unstubAllEnvs()
})

async function headersFor(source: string) {
  const rules = await nextConfig.headers!()
  const rule = rules.find((candidate) => candidate.source === source)
  return new Headers(rule?.headers.map(({ key, value }) => [key, value]))
}

describe("response security headers", () => {
  it("protects every route with browser security headers", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const headers = await headersFor("/:path*")

    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    )
    expect(headers.get("x-content-type-options")).toBe("nosniff")
    expect(headers.get("x-frame-options")).toBe("DENY")
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin")
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin")
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains"
    )
  })

  it("keeps HSTS out of development and API responses out of caches", async () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(
      (await headersFor("/:path*")).get("strict-transport-security")
    ).toBeNull()
    expect((await headersFor("/api/:path*")).get("cache-control")).toBe(
      "private, no-store"
    )
  })
})
