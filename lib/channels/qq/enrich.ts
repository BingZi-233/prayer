import type { IncomingMessage, ImageInput } from "../../core/chat/events"
import type { ParsedMessage } from "./parse"
import { extractSegments, fetchImageBase64, type ImageData } from "./media"
import { errorMessage } from "../../core/log-context"
import { logger } from "../../core/logger"

// OneBot API 调用器:client 注入(基于 echo 请求-响应)。失败/超时返回 undefined。
// 应答载荷各 API 形状不同,统一 unknown,由下方收据类型窄化
export type CallFn = (
  action: string,
  params: Record<string, unknown>
) => Promise<unknown>

export interface EnrichDeps {
  call: CallFn
  dl?: (url: string) => Promise<ImageData>
}

// get_msg 回执的取用子集(OneBot 字段众多,只声明用到的)
interface MsgReceipt {
  message?: unknown
  sender?: { nickname?: string; card?: string }
}

// get_forward_msg 回执:node 列表在 messages 或 message 字段(实现不一),node 内正文在 message 或 content
interface ForwardNode {
  message?: unknown
  content?: unknown
  sender?: { nickname?: string; card?: string }
}
interface ForwardReceipt {
  messages?: ForwardNode[]
  message?: ForwardNode[]
}

// 把 ParsedMessage 富化为 IncomingMessage:回查引用/转发文本 + 下载所有图(含嵌套)。
// 旁路降级:任一 API/下载失败只跳过该部分,主文本仍传,整体不抛。
// botMentioned 由 gateway 按 atList ∩ botQQ 回退计算,此处不填。
//
// 引用/转发回查与顶层图下载互相独立,全部并行(allSettled):此前三层串行 await,
// 最坏入站延迟 = 各超时上限 + 逐张图片下载之和;并行后取最慢一路。
export async function enrich(
  parsed: ParsedMessage,
  deps: EnrichDeps
): Promise<IncomingMessage> {
  const dl = deps.dl ?? fetchImageBase64
  const imageUrls = [...parsed.imageUrls]
  const topLevelCount = imageUrls.length

  const [quotedSettled, fwdSettled, ...topDlSettled] = await Promise.allSettled(
    [
      parsed.replyId
        ? deps.call("get_msg", { message_id: parsed.replyId })
        : Promise.resolve(undefined),
      parsed.forwardId
        ? deps.call("get_forward_msg", { message_id: parsed.forwardId })
        : Promise.resolve(undefined),
      ...imageUrls.map((url) => dl(url)),
    ]
  )

  let quoted: string | undefined
  if (quotedSettled.status === "fulfilled") {
    const m = quotedSettled.value as MsgReceipt | undefined
    if (m) {
      const { text, imageUrls: imgs } = extractSegments(m.message)
      const nick = m.sender?.nickname ?? m.sender?.card ?? ""
      quoted =
        [nick, text].filter(Boolean).join(": ") || (imgs.length ? "[图片]" : "")
      imageUrls.push(...imgs)
    }
  } else {
    logger.warn(
      `[enrich] get_msg 回查失败,quoted 降级: ${errorMessage(quotedSettled.reason)}`,
      { scope: "enrich", raw: String(parsed.messageId) }
    )
  }

  let forwarded: string | undefined
  if (fwdSettled.status === "fulfilled") {
    const f = fwdSettled.value as ForwardReceipt | undefined
    const nodes: ForwardNode[] = f?.messages ?? f?.message ?? []
    const parts: string[] = []
    for (const n of nodes) {
      const { text, imageUrls: imgs } = extractSegments(
        n?.message ?? n?.content
      )
      const nick = n?.sender?.nickname ?? n?.sender?.card ?? ""
      parts.push(
        [nick, text || (imgs.length ? "[图片]" : "")].filter(Boolean).join(": ")
      )
      imageUrls.push(...imgs)
    }
    forwarded = parts.filter(Boolean).join("\n") || undefined
  } else {
    logger.warn(
      `[enrich] get_forward_msg 回查失败,forwarded 降级: ${errorMessage(fwdSettled.reason)}`,
      { scope: "enrich", raw: String(parsed.messageId) }
    )
  }

  // 顶层图已在上面的 allSettled 里下载;引用/转发里抽出的嵌套图补一轮并行下载
  const nestedUrls = imageUrls.slice(topLevelCount)
  const nestedDlSettled = await Promise.allSettled(
    nestedUrls.map((url) => dl(url))
  )

  // 单张失败跳过(记日志带 url,不再无声消失)
  const images: ImageInput[] = []
  const allDl = [
    ...topDlSettled.map((r, i) => ({ r, url: imageUrls[i] })),
    ...nestedDlSettled.map((r, j) => ({ r, url: nestedUrls[j] })),
  ]
  for (const { r, url } of allDl) {
    if (r.status === "fulfilled") {
      images.push(r.value)
    } else {
      logger.warn(
        `[enrich] 跳过下载失败图片 ${url}: ${errorMessage(r.reason)}`,
        { scope: "enrich", raw: String(parsed.messageId) }
      )
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
