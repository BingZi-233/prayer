import { bus } from "../bus";

export function registerReplyMapper(): () => void {
  const onReply = (r: { groupId: number; text: string; replyToId?: number }) => {
    bus.emit("action.send", { action: "send_group_msg", groupId: r.groupId, text: r.text, replyToId: r.replyToId });
  };
  bus.on("reply.ready", onReply);
  return () => bus.off("reply.ready", onReply);
}
