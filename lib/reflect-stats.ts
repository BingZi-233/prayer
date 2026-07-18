import type { Repo } from "./db/repo"

function chatKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`
}

// 反思/群活动页共用:每 chat 反思游标 / 消息统计 / 沉淀计数 三个 Map,外加沉淀条目全量
// Map key = `${channel}:${chatId}`
export function buildGroupStatMaps(repo: Repo) {
  const cursors = new Map(
    repo.reflectCursors().map((c) => [chatKey(c.channel, c.chatId), c.cursor])
  )
  const msg = new Map(
    repo.groupMessageStats().map((m) => [chatKey(m.channel, m.chatId), m])
  )
  const entries = repo.reflectionEntries()
  const sed = new Map<string, number>()
  for (const e of entries) {
    if (e.channel != null && e.chatId != null) {
      const k = chatKey(e.channel, e.chatId)
      sed.set(k, (sed.get(k) ?? 0) + 1)
    }
  }
  return { cursors, msg, sed, entries }
}
