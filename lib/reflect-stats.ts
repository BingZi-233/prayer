import type { Repo } from "./db/repo";

// 反思/群活动页共用:每群 反思游标 / 消息统计 / 沉淀计数 三个 Map,外加沉淀条目全量
export function buildGroupStatMaps(repo: Repo) {
  const cursors = new Map(repo.reflectCursors().map((c) => [c.groupId, c.cursor]));
  const msg = new Map(repo.groupMessageStats().map((m) => [m.groupId, m]));
  const entries = repo.reflectionEntries();
  const sed = new Map<number, number>();
  for (const e of entries) if (e.groupId != null) sed.set(e.groupId, (sed.get(e.groupId) ?? 0) + 1);
  return { cursors, msg, sed, entries };
}
