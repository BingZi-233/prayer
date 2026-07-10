/** 群管理员候选(跨群去重后) */
export interface AdminCandidate {
  userId: number;
  name: string;
  /** 跨群取最高角色:owner > admin */
  role: "owner" | "admin";
  /** 此人作为管理出现的群号 */
  groupIds: number[];
}

const ROLE_RANK: Record<string, number> = { owner: 2, admin: 1 };

// 群友名最长 9 字,超出截断加省略号。Array.from 按码点切,避免截断 emoji / CJK。
function clamp(name: string): string {
  const chars = Array.from(name);
  return chars.length > 9 ? chars.slice(0, 9).join("") + "…" : name;
}

function parseRole(raw: unknown): "owner" | "admin" | null {
  if (raw === "owner" || raw === "admin") return raw;
  return null;
}

/**
 * 从多群成员原始列表中抽出 owner/admin,按 userId 去重。
 * 同人多群:合并 groupIds;角色取最高;名字优先非空名片/昵称。
 */
export function collectAdmins(
  groupMembers: { groupId: number; members: unknown[] }[],
  opts: { excludeUserIds?: number[] } = {}
): AdminCandidate[] {
  const exclude = new Set((opts.excludeUserIds ?? []).filter((n) => n > 0));
  const byId = new Map<number, AdminCandidate>();

  for (const { groupId, members } of groupMembers) {
    if (!Array.isArray(members)) continue;
    for (const m of members) {
      const o = m as {
        user_id?: unknown;
        card?: unknown;
        nickname?: unknown;
        role?: unknown;
      };
      const userId = Number(o.user_id);
      if (!Number.isFinite(userId) || userId <= 0 || exclude.has(userId)) continue;
      const role = parseRole(o.role);
      if (!role) continue;

      const card = typeof o.card === "string" ? o.card.trim() : "";
      const nickname = typeof o.nickname === "string" ? o.nickname.trim() : "";
      const name = clamp(card || nickname || String(userId));

      const prev = byId.get(userId);
      if (!prev) {
        byId.set(userId, { userId, name, role, groupIds: [groupId] });
        continue;
      }
      if (!prev.groupIds.includes(groupId)) prev.groupIds.push(groupId);
      if ((ROLE_RANK[role] ?? 0) > (ROLE_RANK[prev.role] ?? 0)) prev.role = role;
      // 名字:若当前是裸 uid 而新名字更可读,则更新
      if (prev.name === String(userId) && name !== String(userId)) prev.name = name;
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const rr = (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0);
    if (rr !== 0) return rr;
    return a.userId - b.userId;
  });
}
