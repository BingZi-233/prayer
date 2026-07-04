import { bus } from "../bus";

export function registerReplyMapper(): () => void {
  const onReply = (r: { groupId: number; text: string }) => {
    bus.emit("action.send", { action: "send_group_msg", groupId: r.groupId, text: r.text });
  };
  bus.on("reply.ready", onReply);
  return () => bus.off("reply.ready", onReply);
}
