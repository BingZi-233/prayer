import { describe, it, expect, vi, afterEach } from "vitest"
import {
  downloadTelegramImage,
  extractTelegramImageFileIds,
  DEFAULT_MAX_BYTES,
} from "@/lib/channels/tg/media"

afterEach(() => vi.restoreAllMocks())

describe("extractTelegramImageFileIds", () => {
  it("photo 取最大尺寸（数组末张）", () => {
    const ids = extractTelegramImageFileIds({
      photo: [
        { file_id: "small", width: 90 },
        { file_id: "large", width: 800 },
      ],
    })
    expect(ids).toEqual(["large"])
  })

  it("image document 收录；非 image 跳过", () => {
    expect(
      extractTelegramImageFileIds({
        document: { file_id: "d1", mime_type: "image/png" },
      })
    ).toEqual(["d1"])
    expect(
      extractTelegramImageFileIds({
        document: { file_id: "d2", mime_type: "application/pdf" },
      })
    ).toEqual([])
  })
})

describe("downloadTelegramImage", () => {
  const token = "tok123"

  it("getFile + 下载转 base64", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: {
        get: (k: string) =>
          k === "content-type" ? "image/png" : null,
      },
    }))
    const r = await downloadTelegramImage("fid", {
      token,
      getFile: async () => ({ file_path: "photos/a.png", file_size: 3 }),
      fetchFn: fetchFn as never,
    })
    expect(r).toEqual({
      data: Buffer.from([1, 2, 3]).toString("base64"),
      mediaType: "image/png",
    })
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.telegram.org/file/bottok123/photos/a.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it("file_size 超 maxBytes → null", async () => {
    const r = await downloadTelegramImage("fid", {
      token,
      maxBytes: 10,
      getFile: async () => ({ file_path: "a.jpg", file_size: 11 }),
      fetchFn: vi.fn() as never,
    })
    expect(r).toBeNull()
  })

  it("content-type 非 image 且扩展名非图 → null", async () => {
    const r = await downloadTelegramImage("fid", {
      token,
      getFile: async () => ({ file_path: "docs/a.bin" }),
      fetchFn: vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
        headers: { get: () => "application/octet-stream" },
      })) as never,
    })
    expect(r).toBeNull()
  })

  it("扩展名推断 image/*", async () => {
    const r = await downloadTelegramImage("fid", {
      token,
      getFile: async () => ({ file_path: "photos/x.webp" }),
      fetchFn: vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([9]).buffer,
        headers: { get: () => "application/octet-stream" },
      })) as never,
    })
    expect(r?.mediaType).toBe("image/webp")
  })

  it("getFile 失败 → null", async () => {
    const r = await downloadTelegramImage("fid", {
      token,
      getFile: async () => {
        throw new Error("no")
      },
    })
    expect(r).toBeNull()
  })

  it("HTTP 错误 → null", async () => {
    const r = await downloadTelegramImage("fid", {
      token,
      getFile: async () => ({ file_path: "a.jpg" }),
      fetchFn: vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
      })) as never,
    })
    expect(r).toBeNull()
  })

  it("DEFAULT_MAX_BYTES 为 5MB", () => {
    expect(DEFAULT_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})
