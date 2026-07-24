import { describe, it, expect, vi, afterEach } from "vitest"
import { extractSegments, fetchImageBase64 } from "@/lib/onebot/media"

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
})
