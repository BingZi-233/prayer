import { bus } from "../bus";

export function registerReplyMapper(): void {
  bus.on("reply.ready", (r) => {
    bus.emit("action.send", { action: "send_group_msg", groupId: r.groupId, text: r.text });
  });
}
