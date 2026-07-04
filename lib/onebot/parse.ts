interface Segment { type: string; data: Record<string, string> }

// parse 只做同步结构化抽取;引用/转发内容与图片下载在 enrich 阶段异步完成
export interface ParsedMessage {
  groupId: number;
  userId: number;
  messageId: number;
  rawText: string;
  atList: number[]; // 被 @ 的 QQ 列表
  senderRole?: string; // owner / admin / member
  imageUrls: string[]; // 顶层图片 url(或 file)
  replyId?: string; // 引用回复:被引消息 id,待 get_msg 回查
  forwardId?: string; // 合并转发:res_id,待 get_forward_msg 回查
}

export function parseGroupMessage(evt: any): ParsedMessage | null {
  if (evt?.post_type !== "message" || evt?.message_type !== "group") return null;

  const atList: number[] = [];
  const imageUrls: string[] = [];
  let text = "";
  let replyId: string | undefined;
  let forwardId: string | undefined;

  if (Array.isArray(evt.message)) {
    for (const seg of evt.message as Segment[]) {
      switch (seg.type) {
        case "text":
          text += seg.data?.text ?? "";
          break;
        case "at":
          if (seg.data?.qq) atList.push(Number(seg.data.qq));
          break;
        case "image": {
          const u = seg.data?.url ?? seg.data?.file;
          if (u) imageUrls.push(u);
          break;
        }
        case "reply":
          if (seg.data?.id) replyId = String(seg.data.id);
          break;
        case "forward":
          if (seg.data?.id) forwardId = String(seg.data.id);
          break;
        default:
          break; // 其余段(face/json/record/video/file…)丢弃
      }
    }
  } else if (typeof evt.message === "string") {
    const cq = /\[CQ:(\w+)((?:,[^\]]*)?)\]/g;
    let mtch: RegExpExecArray | null;
    while ((mtch = cq.exec(evt.message)) !== null) {
      const [, type, argStr] = mtch;
      const args = Object.fromEntries(
        argStr
          .split(",")
          .filter(Boolean)
          .map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i), kv.slice(i + 1)];
          })
      );
      if (type === "at" && args.qq) atList.push(Number(args.qq));
      else if (type === "image") {
        const u = args.url ?? args.file;
        if (u) imageUrls.push(u);
      } else if (type === "reply" && args.id) replyId = args.id;
      else if (type === "forward" && args.id) forwardId = args.id;
    }
    text = evt.message.replace(/\[CQ:[^\]]*\]/g, "");
  }

  return {
    groupId: Number(evt.group_id),
    userId: Number(evt.user_id),
    messageId: Number(evt.message_id),
    rawText: text.trim(),
    atList,
    senderRole: evt.sender?.role,
    imageUrls,
    replyId,
    forwardId,
  };
}
