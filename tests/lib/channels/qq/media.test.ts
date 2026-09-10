import { describe, it, expect, vi, afterEach } from "vitest"
import { extractSegments, fetchImageBase64 } from "@/lib/channels/qq/media"

afterEach(() => vi.restoreAllMocks())

describe("extractSegments", () => {
  it("数组段抽文本 + 图 url(url 优先 file)", () => {
    const r = extractSegments([
      { type: "text", data: { text: "看图 " } },
      { type: "image", data: { url: "http://a/1.jpg", file: "1.jpg" } },
      { type: "image", data: { file: "2.jpg" } },
      { type: "face", data: { id: "1" } },
    ])
    expect(r.text).toBe("看图")
    expect(r.imageUrls).toEqual(["http://a/1.jpg", "2.jpg"])
  })

  it("CQ 字符串抽图", () => {
    const r = extractSegments("你好[CQ:image,file=x.jpg,url=http://b/x.jpg]")
    expect(r.text).toBe("你好")
    expect(r.imageUrls).toEqual(["http://b/x.jpg"])
  })

  it("非法输入返回空", () => {
    expect(extractSegments(undefined)).toEqual({ text: "", imageUrls: [] })
  })
})

describe("fetchImageBase64", () => {
  it("下载转 base64,mediaType 取 content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: {
          get: (k: string) =>
            k === "content-type" ? "image/png; charset=binary" : null,
        },
      }))
    )
    const r = await fetchImageBase64("http://x/y.png")
    expect(r.mediaType).toBe("image/png")
    expect(r.data).toBe(Buffer.from([1, 2, 3]).toString("base64"))
  })

  it("content-type 非 image → 缺省 image/jpeg", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([9]).buffer,
        headers: { get: () => "application/octet-stream" },
      }))
    )
    expect((await fetchImageBase64("http://x")).mediaType).toBe("image/jpeg")
  })

  it("HTTP 错误抛异常", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
      }))
    )
    await expect(fetchImageBase64("http://x")).rejects.toThrow("404")
  })

  it("挂起的下载在 timeoutMs 后抛错(AbortController 硬超时)", async () => {
    const fetchFn = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        )
      })) as unknown as typeof fetch
    await expect(
      fetchImageBase64("http://x/slow.jpg", { fetchFn, timeoutMs: 30 })
    ).rejects.toThrow()
  })

  it("content-length 超过 maxBytes → 不读 body 直接抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => {
          throw new Error("不应读取 body")
        },
        headers: {
          get: (k: string) =>
            k === "content-length" ? String(6 * 1024 * 1024) : null,
        },
      }))
    )
    await expect(fetchImageBase64("http://x/big.jpg")).rejects.toThrow(
      "大小上限"
    )
  })

  it("实际字节数超过 maxBytes → 抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array(6 * 1024 * 1024).buffer,
        headers: { get: () => null },
      }))
    )
    await expect(fetchImageBase64("http://x/big2.jpg")).rejects.toThrow(
      "大小上限"
    )
  })

  it("headers 已回但 body 挂起:超时同样掐断(abort 覆盖到读取完毕)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => ({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted"))
            )
          }),
      }))
    )
    const t0 = Date.now()
    await expect(
      fetchImageBase64("http://x/slowbody.jpg", { timeoutMs: 30 })
    ).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(5_000)
  })
})
