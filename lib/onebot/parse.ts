import type { IncomingMessage } from "../events";

interface Segment { type: string; data: Record<string, string> }

export function parseGroupMessage(evt: any): IncomingMessage | null {
  if (evt?.post_type !== "message" || evt?.message_type !== "group") return null;

  const atList: number[] = [];
  let text = "";

  if (Array.isArray(evt.message)) {
    for (const seg of evt.message as Segment[]) {
      if (seg.type === "at" && seg.data?.qq) atList.push(Number(seg.data.qq));
      else if (seg.type === "text") text += seg.data?.text ?? "";
    }
  } else if (typeof evt.message === "string") {
    const cq = /\[CQ:at,qq=(\d+)\]/g;
    let mtch: RegExpExecArray | null;
    while ((mtch = cq.exec(evt.message)) !== null) atList.push(Number(mtch[1]));
    text = evt.message.replace(/\[CQ:[^\]]*\]/g, "");
  }

  return {
    groupId: Number(evt.group_id),
    userId: Number(evt.user_id),
    messageId: Number(evt.message_id),
    rawText: text.trim(),
    atList,
  };
}
