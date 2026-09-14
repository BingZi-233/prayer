import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"
import {
  contentLengthExceeds,
  emptyBodyFailure,
  isSameOriginRequest,
  MAX_REQUEST_BODY_BYTES,
  readEmptyBody,
  readJsonBody,
  REQUEST_BODY_PRESENT,
  REQUEST_BODY_TOO_LARGE,
} from "@/lib/core/http-security"

describe("HTTP security boundaries", () => {
  it("bounds advertised and chunked JSON bodies", async () => {
    const headers = new Headers({
      "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
    })
    expect(contentLengthExceeds(headers)).toBe(true)

    const oversized = new Request("http://localhost/api/config", {
      method: "POST",
      headers,
      body: "{}",
    })
    await expect(readJsonBody(oversized)).resolves.toBe(REQUEST_BODY_TOO_LARGE)

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("x".repeat(MAX_REQUEST_BODY_BYTES + 1))
        )
        controller.close()
      },
    })
    const chunked = new Request("http://localhost/api/config", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
    await expect(readJsonBody(chunked)).resolves.toBe(REQUEST_BODY_TOO_LARGE)
  })

  it("rejects a chunked JSON body that lands exactly on the proxy boundary", async () => {
    // This is valid JSON at exactly the configured byte limit. A proxy may
    // have cut a larger chunked request at that boundary, so it must not be
    // accepted without an advertised length proving completeness.
    const body = JSON.stringify("x".repeat(MAX_REQUEST_BODY_BYTES - 2))
    expect(new TextEncoder().encode(body).byteLength).toBe(
      MAX_REQUEST_BODY_BYTES
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(body)
        controller.enqueue(bytes.subarray(0, 17))
        controller.enqueue(bytes.subarray(17))
        controller.close()
      },
    })
    const chunked = new Request("http://localhost/api/config", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    await expect(readJsonBody(chunked)).resolves.toBe(REQUEST_BODY_TOO_LARGE)
  })

  it("rejects non-empty chunked requests without buffering them", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"))
        controller.enqueue(new TextEncoder().encode("x".repeat(1024 * 1024)))
        controller.close()
      },
    })
    const request = new Request("http://localhost/api/runtime/restart", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    await expect(readEmptyBody(request)).resolves.toBe(REQUEST_BODY_PRESENT)
    expect(emptyBodyFailure(REQUEST_BODY_PRESENT)).toEqual({
      status: 400,
      message: "该接口不接受请求体",
    })
    expect(emptyBodyFailure(null)).toBeNull()
  })

  it("fails closed for malformed or oversized advertised empty bodies", async () => {
    const malformed = new Request("http://localhost/api/runtime/restart", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
    })
    await expect(readEmptyBody(malformed)).resolves.toBe(REQUEST_BODY_TOO_LARGE)

    const oversized = new Request("http://localhost/api/runtime/restart", {
      method: "POST",
      headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
    })
    await expect(readEmptyBody(oversized)).resolves.toBe(REQUEST_BODY_TOO_LARGE)
  })

  it("requires an origin or same-origin referer for cookie mutations", () => {
    const base = {
      url: "https://admin.example/api/config",
      headers: new Headers({ origin: "https://admin.example" }),
    }
    expect(isSameOriginRequest(base)).toBe(true)
    base.headers.set("origin", "https://evil.example")
    expect(isSameOriginRequest(base)).toBe(false)
    base.headers.delete("origin")
    base.headers.set("referer", "https://admin.example/login")
    expect(isSameOriginRequest(base)).toBe(true)
  })
})

describe("admin proxy guards", () => {
  it("rejects cross-origin cookie mutations and oversized bodies", () => {
    vi.stubEnv("ADMIN_TOKEN", "test-token")
    const csrf = proxy(
      new NextRequest("https://admin.example/api/config", {
        method: "PUT",
        headers: {
          cookie: "admin_token=test-token",
          origin: "https://evil.example",
        },
        body: "{}",
      })
    )
    expect(csrf.status).toBe(403)

    const tooLarge = proxy(
      new NextRequest("https://admin.example/api/config", {
        method: "PUT",
        headers: {
          "x-admin-token": "test-token",
          "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
        },
        body: "{}",
      })
    )
    expect(tooLarge.status).toBe(413)
    vi.unstubAllEnvs()
  })

  it("leaves health endpoints outside the admin matcher", () => {
    vi.stubEnv("ADMIN_TOKEN", "test-token")
    const response = proxy(new NextRequest("https://admin.example/health/live"))
    expect(response.headers.get("x-middleware-next")).toBe("1")
    vi.unstubAllEnvs()
  })

  it("does not turn an unprotected health probe into production fail-closed", () => {
    vi.stubEnv("ADMIN_TOKEN", "")
    vi.stubEnv("NODE_ENV", "production")
    const response = proxy(
      new NextRequest("https://admin.example/health/ready")
    )
    expect(response.headers.get("x-middleware-next")).toBe("1")
    vi.unstubAllEnvs()
  })

  it("uses forwarded origin only when the deployment trusts its proxy", () => {
    vi.stubEnv("ADMIN_TOKEN", "test-token")
    const request = () =>
      new NextRequest("http://127.0.0.1:3000/api/config", {
        method: "PUT",
        headers: {
          cookie: "admin_token=test-token",
          host: "public.example",
          "x-forwarded-host": "public.example",
          "x-forwarded-proto": "https",
          origin: "https://public.example",
        },
        body: "{}",
      })

    expect(proxy(request()).status).toBe(403)
    vi.stubEnv("TRUST_PROXY", "true")
    expect(proxy(request()).headers.get("x-middleware-next")).toBe("1")
    vi.unstubAllEnvs()
  })

  it("uses the requested Host when Next binds to a wildcard address", () => {
    vi.stubEnv("ADMIN_TOKEN", "test-token")
    const response = proxy(
      new NextRequest("http://0.0.0.0:3000/api/config", {
        method: "PUT",
        headers: {
          host: "localhost:3000",
          cookie: "admin_token=test-token",
          origin: "http://localhost:3000",
        },
        body: "{}",
      })
    )
    expect(response.headers.get("x-middleware-next")).toBe("1")
    vi.unstubAllEnvs()
  })
})
