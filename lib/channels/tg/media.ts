import type { ImageInput } from "../../events"

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_TIMEOUT_MS = 15_000

export interface TelegramFileInfo {
  file_path?: string
  file_size?: number
}

export interface DownloadTelegramImageDeps {
  getFile: (fileId: string) => Promise<TelegramFileInfo>
  /** bot token，拼 file URL */
  token: string
  fetchFn?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
}

function mimeFromPath(filePath: string): string | undefined {
  const base = filePath.split("/").pop() ?? filePath
  const dot = base.lastIndexOf(".")
  if (dot < 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  return EXT_MIME[ext]
}

/**
 * 按 file_id 下载 Telegram 图片 → ImageInput。
 * 超限 / 超时 / 非 image / HTTP 失败 → 返回 null（调用方跳过）。
 */
export async function downloadTelegramImage(
  fileId: string,
  deps: DownloadTelegramImageDeps
): Promise<ImageInput | null> {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchFn = deps.fetchFn ?? fetch

  let info: TelegramFileInfo
  try {
    info = await deps.getFile(fileId)
  } catch {
    return null
  }

  if (info.file_size != null && info.file_size > maxBytes) {
    return null
  }
  const filePath = info.file_path
  if (!filePath) return null

  const url = `https://api.telegram.org/file/bot${deps.token}/${filePath}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { signal: ac.signal })
    if (!res.ok) return null

    // 优先 Content-Length 预检
    const cl = res.headers.get("content-length")
    if (cl != null && Number(cl) > maxBytes) return null

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > maxBytes) return null

    const ct = res.headers.get("content-type")?.split(";")[0]?.trim()
    let mediaType = ct && ct.startsWith("image/") ? ct : mimeFromPath(filePath)
    if (!mediaType || !mediaType.startsWith("image/")) {
      return null
    }

    return { data: buf.toString("base64"), mediaType }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从 message.photo / image document 抽出 file_id 列表（photo 取最大尺寸一张）。
 */
export function extractTelegramImageFileIds(message: {
  photo?: { file_id: string; file_size?: number; width?: number }[]
  document?: { file_id: string; mime_type?: string; file_size?: number }
}): string[] {
  const ids: string[] = []
  if (message.photo?.length) {
    // Telegram 按从小到大排列；取最后一张
    const largest = message.photo[message.photo.length - 1]
    if (largest?.file_id) ids.push(largest.file_id)
  }
  const doc = message.document
  if (doc?.file_id && doc.mime_type?.startsWith("image/")) {
    ids.push(doc.file_id)
  }
  return ids
}
