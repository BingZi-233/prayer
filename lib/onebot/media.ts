interface Segment {
  type: string
  data: Record<string, string>
}

// 从任意段数组抽文本与图片 url(get_msg / get_forward_msg 节点复用)。
// 不递归 reply/forward,防死循环与 token 爆炸。
export function extractSegments(segs: unknown): {
  text: string
  imageUrls: string[]
} {
  const imageUrls: string[] = []
  let text = ""
  if (Array.isArray(segs)) {
    for (const seg of segs as Segment[]) {
      if (seg?.type === "text") text += seg.data?.text ?? ""
      else if (seg?.type === "image") {
        const u = seg.data?.url ?? seg.data?.file
        if (u) imageUrls.push(u)
      }
    }
  } else if (typeof segs === "string") {
    const cq = /\[CQ:image,([^\]]*)\]/g
    let m: RegExpExecArray | null
    while ((m = cq.exec(segs)) !== null) {
      const args = Object.fromEntries(
        m[1]
          .split(",")
          .filter(Boolean)
          .map((kv) => {
            const i = kv.indexOf("=")
            return [kv.slice(0, i), kv.slice(i + 1)]
          })
      )
      const u = args.url ?? args.file
      if (u) imageUrls.push(u)
    }
    text = segs.replace(/\[CQ:[^\]]*\]/g, "")
  }
  return { text: text.trim(), imageUrls }
}

export interface ImageData {
  data: string // base64
  mediaType: string
}

/** 下载硬超时:NapCat 返回的多媒体 URL 不可信,挂起会卡死入站富化 */
export const DEFAULT_DL_TIMEOUT_MS = 15_000
/** 图片大小上限:base64 后 ~1.33x 进内存,超限直接放弃 */
export const DEFAULT_DL_MAX_BYTES = 5 * 1024 * 1024

export interface FetchImageBase64Opts {
  fetchFn?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

// 下载图片 url → base64 + media_type。失败抛错,由调用方(enrich)兜底跳过。
// 带 AbortController 硬超时 + Content-Length 预检 + 实际字节数上限(对齐 tg/media.ts)。
export async function fetchImageBase64(
  url: string,
  opts: FetchImageBase64Opts = {}
): Promise<ImageData> {
  const fetchFn = opts.fetchFn ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_DL_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_DL_MAX_BYTES
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchFn(url, { signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`)
  // 优先 Content-Length 预检,再兜底实际字节数
  const cl = res.headers.get("content-length")
  if (cl != null && Number(cl) > maxBytes) {
    throw new Error(`图片超过大小上限 ${maxBytes} 字节`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > maxBytes) {
    throw new Error(`图片超过大小上限 ${maxBytes} 字节`)
  }
  const ct = res.headers.get("content-type")?.split(";")[0]?.trim()
  const mediaType = ct && ct.startsWith("image/") ? ct : "image/jpeg"
  return { data: buf.toString("base64"), mediaType }
}
