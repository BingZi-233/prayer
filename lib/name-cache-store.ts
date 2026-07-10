// name-cache 的 SQLite 持久化层:群列表快照 / 群名分表 / 用户分表 / 成员列表快照。
// 与内存 NameCache 同步写入,进程重启后从 DB 灌回,TTL 未过则不再打 OneBot。
// 过期判定的 now 由调用方传入,便于单测注入时钟。

import type Database from "better-sqlite3";

export type GroupNameRow = { groupId: number; groupName: string };
export type UserNameRow = { userId: number; name: string };

export type PersistedGroupsSnap = { rows: GroupNameRow[]; exp: number };
export type PersistedMembersSnap = { groupId: number; rows: UserNameRow[]; exp: number };

export type NameCacheSnapshot = {
  groupsSnap: PersistedGroupsSnap | null;
  groups: Array<{ groupId: number; name: string; exp: number }>;
  users: Array<{ userId: number; name: string; exp: number }>;
  membersSnaps: PersistedMembersSnap[];
};

export type NameCachePersistence = {
  /** now: 当前时钟(ms),用于过滤/清扫过期行 */
  load(now: number): NameCacheSnapshot;
  saveGroupsList(rows: GroupNameRow[], exp: number, now: number): void;
  saveMembersList(groupId: number, rows: UserNameRow[], exp: number, now: number): void;
  clear(): void;
};

function parseGroupRows(raw: string): GroupNameRow[] | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    return v
      .map((x) => {
        const o = x as { groupId?: unknown; groupName?: unknown };
        return { groupId: Number(o.groupId), groupName: String(o.groupName ?? "") };
      })
      .filter((r) => Number.isFinite(r.groupId) && r.groupId > 0);
  } catch {
    return null;
  }
}

function parseUserRows(raw: string): UserNameRow[] | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    return v
      .map((x) => {
        const o = x as { userId?: unknown; name?: unknown };
        return { userId: Number(o.userId), name: String(o.name ?? "") };
      })
      .filter((r) => Number.isFinite(r.userId) && r.userId > 0);
  } catch {
    return null;
  }
}

export function createSqliteNameCachePersistence(db: Database.Database): NameCachePersistence {
  const loadGroupsList = db.prepare("SELECT rows_json, exp FROM name_cache_groups_list WHERE id = 1");
  const loadGroups = db.prepare("SELECT group_id, name, exp FROM name_cache_group");
  const loadUsers = db.prepare("SELECT user_id, name, exp FROM name_cache_user");
  const loadMembers = db.prepare("SELECT group_id, rows_json, exp FROM name_cache_members");

  const upsertGroupsList = db.prepare(
    `INSERT INTO name_cache_groups_list (id, rows_json, exp) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET rows_json = excluded.rows_json, exp = excluded.exp`,
  );
  const upsertGroup = db.prepare(
    `INSERT INTO name_cache_group (group_id, name, exp) VALUES (?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET name = excluded.name, exp = excluded.exp`,
  );
  const upsertUser = db.prepare(
    `INSERT INTO name_cache_user (user_id, name, exp) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, exp = excluded.exp`,
  );
  const upsertMembers = db.prepare(
    `INSERT INTO name_cache_members (group_id, rows_json, exp) VALUES (?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET rows_json = excluded.rows_json, exp = excluded.exp`,
  );

  const clearGroupsList = db.prepare("DELETE FROM name_cache_groups_list");
  const clearGroups = db.prepare("DELETE FROM name_cache_group");
  const clearUsers = db.prepare("DELETE FROM name_cache_user");
  const clearMembers = db.prepare("DELETE FROM name_cache_members");
  const purgeGroups = db.prepare("DELETE FROM name_cache_group WHERE exp <= ?");
  const purgeUsers = db.prepare("DELETE FROM name_cache_user WHERE exp <= ?");
  const purgeMembers = db.prepare("DELETE FROM name_cache_members WHERE exp <= ?");
  const purgeGroupsList = db.prepare("DELETE FROM name_cache_groups_list WHERE exp <= ?");

  function purgeExpired(now: number): void {
    purgeGroupsList.run(now);
    purgeGroups.run(now);
    purgeUsers.run(now);
    purgeMembers.run(now);
  }

  const saveGroupsTx = db.transaction((rows: GroupNameRow[], exp: number, now: number) => {
    purgeExpired(now);
    upsertGroupsList.run(JSON.stringify(rows), exp);
    for (const r of rows) upsertGroup.run(r.groupId, r.groupName, exp);
  });

  const saveMembersTx = db.transaction(
    (groupId: number, rows: UserNameRow[], exp: number, now: number) => {
      purgeExpired(now);
      upsertMembers.run(groupId, JSON.stringify(rows), exp);
      for (const r of rows) upsertUser.run(r.userId, r.name, exp);
    },
  );

  const clearTx = db.transaction(() => {
    clearGroupsList.run();
    clearGroups.run();
    clearUsers.run();
    clearMembers.run();
  });

  return {
    load(now: number): NameCacheSnapshot {
      purgeExpired(now);

      const gl = loadGroupsList.get() as { rows_json: string; exp: number } | undefined;
      let groupsSnap: PersistedGroupsSnap | null = null;
      if (gl && gl.exp > now) {
        const rows = parseGroupRows(gl.rows_json);
        // 解析失败 → 丢弃快照(强制下次走 OneBot);合法空数组 [] 仍算命中
        if (rows) groupsSnap = { rows, exp: gl.exp };
      }

      const groups = (loadGroups.all() as { group_id: number; name: string; exp: number }[])
        .filter((r) => r.exp > now)
        .map((r) => ({ groupId: r.group_id, name: r.name, exp: r.exp }));

      const users = (loadUsers.all() as { user_id: number; name: string; exp: number }[])
        .filter((r) => r.exp > now)
        .map((r) => ({ userId: r.user_id, name: r.name, exp: r.exp }));

      const membersSnaps: PersistedMembersSnap[] = [];
      for (const r of loadMembers.all() as { group_id: number; rows_json: string; exp: number }[]) {
        if (r.exp <= now) continue;
        const rows = parseUserRows(r.rows_json);
        if (!rows) continue; // 损坏 JSON → 跳过,下次 miss 重拉
        membersSnaps.push({ groupId: r.group_id, rows, exp: r.exp });
      }

      return { groupsSnap, groups, users, membersSnaps };
    },

    saveGroupsList(rows, exp, now) {
      saveGroupsTx(rows, exp, now);
    },

    saveMembersList(groupId, rows, exp, now) {
      saveMembersTx(groupId, rows, exp, now);
    },

    clear() {
      clearTx();
    },
  };
}
