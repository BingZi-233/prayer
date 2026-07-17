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
  /**
   * Privacy 启发式观察。
   * 第二参为 botRelated（@bot / 回复 bot / bot_command），非仅 botMentioned。
   */
  observeMessage?: (chatId: string, botRelated: boolean) => void
  /** 本 bot 的 user id，用于判定 reply-to-bot */
  botId?: number
}

/**
 * Privacy Mode 下 bot 仍能收到的消息：@ 提及、回复 bot、以命令实体出现。
 * 普通群聊闲聊不算 botRelated。
 */
export function isBotRelatedMessage(
  raw: Message,
  botId: number | undefined,
  botMentioned: boolean
): boolean {
  if (botMentioned) return true
  if (botId != null && raw.reply_to_message?.from?.id === botId) return true
  const entities = raw.entities ?? raw.caption_entities
  if (entities?.some((e) => e.type === "bot_command")) return true
  return false
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
    const botRelated = isBotRelatedMessage(
      raw,
      deps.botId,
      !!msg.botMentioned
    )
    deps.observeMessage?.(msg.chatId, botRelated)
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
