/**
 * TG 旁路（反思 / 主动补位）按 chat 开关。
 * 默认启用；admins-cache 失败或 Privacy Mode 启发式命中后关闭。
 * 主链路 @ 问答不受影响。
 */

const blocked = new Map<string, string>() // chatId → reason

/** 关闭指定 chat 的旁路，reason 写入 status.detail */
export function setTgBypassBlocked(chatId: string, reason: string): void {
  blocked.set(String(chatId), reason)
}

/** 清除旁路封锁（管理员拉取成功 + 看到非 @ 消息等） */
export function clearTgBypassBlocked(chatId: string): void {
  blocked.delete(String(chatId))
}

/** 默认 true；被 block 后 false */
export function isTgChatBypassEnabled(chatId: string): boolean {
  return !blocked.has(String(chatId))
}

export function getTgBypassBlockReason(chatId: string): string | undefined {
  return blocked.get(String(chatId))
}

export function listTgBypassBlocks(): { chatId: string; reason: string }[] {
  return [...blocked.entries()].map(([chatId, reason]) => ({ chatId, reason }))
}

/** 清空全部封锁（channel stop / reconfigure 时调用，避免双状态残留） */
export function clearAllTgBypassBlocked(): void {
  blocked.clear()
}

/** 仅单测用 */
export function _resetTgBypassStateForTests(): void {
  blocked.clear()
}
