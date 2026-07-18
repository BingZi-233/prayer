import type { IncomingMessage, ImageInput } from "../events"
import type { ParsedMessage } from "./parse"
import { extractSegments, fetchImageBase64, type ImageData } from "./media"

// OneBot API 调用器:client 注入(基于 echo 请求-响应)。失败/超时返回 undefined。
export type CallFn = (
  action: string,
  params: Record<string, unknown>
) => Promise<any>

export interface EnrichDeps {
  call: CallFn
  dl?: (url: string) => Promise<ImageData>
}

// 把 ParsedMessage 富化为 IncomingMessage:回查引用/转发文本 + 下载所有图(含嵌套)。
// 旁路降级:任一 API/下载失败只跳过该部分,主文本仍传,整体不抛。
// botMentioned 由 gateway 按 atList ∩ botQQ 回退计算,此处不填。
export async function enrich(
  parsed: ParsedMessage,
  deps: EnrichDeps
): Promise<IncomingMessage> {
  const dl = deps.dl ?? fetchImageBase64
  const imageUrls = [...parsed.imageUrls]
  let quoted: string | undefined
  let forwarded: string | undefined

  // 引用回复 → get_msg
  if (parsed.replyId) {
    try {
      const m = await deps.call("get_msg", { message_id: parsed.replyId })
      if (m) {
        const { text, imageUrls: imgs } = extractSegments(m.message)
        const nick = m.sender?.nickname ?? m.sender?.card ?? ""
        quoted =
          [nick, text].filter(Boolean).join(": ") ||
          (imgs.length ? "[图片]" : "")
        imageUrls.push(...imgs)
      }
    } catch {
      /* 回查失败:降级,quoted 留空 */
    }
  }

  // 合并转发 → get_forward_msg
  if (parsed.forwardId) {
    try {
      const f = await deps.call("get_forward_msg", {
        message_id: parsed.forwardId,
      })
      const nodes: any[] = f?.messages ?? f?.message ?? []
      const parts: string[] = []
      for (const n of nodes) {
        const { text, imageUrls: imgs } = extractSegments(
          n?.message ?? n?.content
        )
        const nick = n?.sender?.nickname ?? n?.sender?.card ?? ""
        parts.push(
          [nick, text || (imgs.length ? "[图片]" : "")]
            .filter(Boolean)
            .join(": ")
        )
        imageUrls.push(...imgs)
      }
      forwarded = parts.filter(Boolean).join("\n") || undefined
    } catch {
      /* 降级 */
    }
  }

  // 下载所有图(顶层 + 嵌套),单张失败跳过
  const images: ImageInput[] = []
  for (const url of imageUrls) {
    try {
      images.push(await dl(url))
    } catch {
      console.warn(`[enrich] 跳过下载失败图片: ${url}`)
    }
  }

  return {
    channel: "qq",
    chatId: String(parsed.groupId),
    userId: String(parsed.userId),
    messageId: String(parsed.messageId),
    rawText: parsed.rawText,
    atList: parsed.atList.map(String),
    senderRole: parsed.senderRole,
    images: images.length ? images : undefined,
    quoted,
    forwarded,
  }
}
