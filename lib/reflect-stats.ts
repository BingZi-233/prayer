import { parseReflectionSource, type Repo } from "./db/repo"

function chatKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`
}

// 反思/群活动页共用:每 chat 反思游标 / 消息统计 / 沉淀计数 三个 Map
// Map key = `${channel}:${chatId}`
// 沉淀计数只依赖 source 列;曾按 reflectionEntries 全量全文统计,
// 群活动页每 3s 轮询时白白把所有条目 content/question/answer 拉进内存
export function buildGroupChatStats(repo: Repo) {
  const cursors = new Map(
    repo.reflectCursors().map((c) => [chatKey(c.channel, c.chatId), c.cursor])
  )
  const msg = new Map(
    repo.groupMessageStats().map((m) => [chatKey(m.channel, m.chatId), m])
  )
  const sed = new Map<string, number>()
  for (const r of repo.reflectionSources()) {
    const p = parseReflectionSource(r.source)
    if (p) {
      const k = chatKey(p.channel, p.chatId)
      sed.set(k, (sed.get(k) ?? 0) + 1)
    }
  }
  return { cursors, msg, sed }
}
