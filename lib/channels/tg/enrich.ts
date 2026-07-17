import type { Message } from "grammy/types"
import type { ImageInput, IncomingMessage } from "../../events"
import type { SenderRole } from "./admins-cache"
import {
  downloadTelegramImage,
  extractTelegramImageFileIds,
  type DownloadTelegramImageDeps,
} from "./media"

export interface EnrichTelegramDeps {
  getRole: (chatId: string, userId: string) => Promise<SenderRole>
  /** 下载单图；缺省则不下载 */
  downloadImage?: (fileId: string) => Promise<ImageInput | null>
  /** Privacy 启发式观察 */
  observeMessage?: (chatId: string, botMentioned: boolean) => void
}

/**
 * 富化 parse 结果：填 senderRole + 下载图片。
 * 任一失败降级（member / 无图），整体不抛。
 */
export async function enrichTelegramMessage(
  msg: IncomingMessage,
  raw: Message,
  deps: EnrichTelegramDeps
): Promise<IncomingMessage> {
  let senderRole: string = "member"
  try {
    senderRole = await deps.getRole(msg.chatId, msg.userId)
  } catch {
    senderRole = "member"
  }

  try {
    deps.observeMessage?.(msg.chatId, !!msg.botMentioned)
  } catch {
    /* 观察失败忽略 */
  }

  const images: ImageInput[] = []
  if (deps.downloadImage) {
    const fileIds = extractTelegramImageFileIds(raw)
    for (const fid of fileIds) {
      try {
        const img = await deps.downloadImage(fid)
        if (img) images.push(img)
      } catch {
        /* 单张跳过 */
      }
    }
  }

  return {
    ...msg,
    senderRole,
    images: images.length ? images : undefined,
  }
}

/** 用 token + getFile 组装 downloadImage 闭包 */
export function makeTelegramImageDownloader(
  deps: DownloadTelegramImageDeps
): (fileId: string) => Promise<ImageInput | null> {
  return (fileId) => downloadTelegramImage(fileId, deps)
}
