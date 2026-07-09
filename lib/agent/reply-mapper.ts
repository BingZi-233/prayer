import { bus } from "../bus";

export interface ReplyMapperDeps {
  /** 单条字数上限;超出按句号/换行拆条。0 = 不拆。默认 900 */
  maxChars?: number;
}

/** 尽量在标点处切开,避免硬截断半句 */
export function splitReply(text: string, maxChars: number): string[] {
  if (maxChars <= 0 || text.length <= maxChars) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // 优先在中文标点/换行处切
    let cut = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("\n"),
      window.lastIndexOf("；"),
      window.lastIndexOf("，")
    );
    if (cut < maxChars * 0.4) cut = maxChars;
    else cut = cut + 1;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

export function registerReplyMapper(deps: ReplyMapperDeps = {}): () => void {
  const maxChars = deps.maxChars ?? 900;

  const onReply = (r: { groupId: number; text: string; replyToId?: number }) => {
    const chunks = splitReply(r.text, maxChars);
    chunks.forEach((text, i) => {
      bus.emit("action.send", {
        action: "send_group_msg",
        groupId: r.groupId,
        text,
        // 仅首条引用原消息,避免刷一串 reply
        replyToId: i === 0 ? r.replyToId : undefined,
      });
    });
  };
  bus.on("reply.ready", onReply);
  return () => bus.off("reply.ready", onReply);
}
