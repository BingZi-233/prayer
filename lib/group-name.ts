"use client";

import { useEffect, useState } from "react";

/** 与服务端 name-cache 一致:24h */
const CLIENT_NAME_TTL_MS = 24 * 60 * 60 * 1000;

// ── 浏览器端模块级缓存:跨页切换不重复打 API ──
// 群列表 / 成员列表分存;成员按群整包(名片随群),不与群 id 混 key。

type ExpMap = { data: Record<number, string>; exp: number };
type MemberSnap = { data: Record<string, string>; exp: number }; // key = "gid:uid"

let groupsCache: ExpMap | null = null;
let groupsInflight: Promise<Record<number, string>> | null = null;

const membersByGroup = new Map<number, MemberSnap>();
const membersInflight = new Map<number, Promise<Record<string, string>>>();

function alive(exp: number): boolean {
  return Date.now() < exp;
}

async function loadGroups(): Promise<Record<number, string>> {
  if (groupsCache && alive(groupsCache.exp)) return groupsCache.data;
  if (groupsInflight) return groupsInflight;

  groupsInflight = fetch("/api/onebot/groups")
    .then((x) => x.json())
    .then((r) => {
      if (!r.ok) return groupsCache?.data ?? {};
      const data = Object.fromEntries(
        (r.data as { groupId: number; groupName: string }[]).map((g) => [g.groupId, g.groupName]),
      ) as Record<number, string>;
      groupsCache = { data, exp: Date.now() + CLIENT_NAME_TTL_MS };
      return data;
    })
    .catch(() => groupsCache?.data ?? {})
    .finally(() => {
      groupsInflight = null;
    });

  return groupsInflight;
}

async function loadMembers(groupId: number): Promise<Record<string, string>> {
  const hit = membersByGroup.get(groupId);
  if (hit && alive(hit.exp)) return hit.data;

  const pending = membersInflight.get(groupId);
  if (pending) return pending;

  const p = fetch(`/api/onebot/members?group=${groupId}`)
    .then((x) => x.json())
    .then((r) => {
      if (!r.ok) return hit?.data ?? {};
      const data = Object.fromEntries(
        (r.data as { userId: number; name: string }[]).map((m) => [`${groupId}:${m.userId}`, m.name]),
      ) as Record<string, string>;
      membersByGroup.set(groupId, { data, exp: Date.now() + CLIENT_NAME_TTL_MS });
      return data;
    })
    .catch(() => hit?.data ?? {})
    .finally(() => {
      membersInflight.delete(groupId);
    });

  membersInflight.set(groupId, p);
  return p;
}

/** 测试用:清空浏览器端名称缓存 */
export function clearClientNameCache(): void {
  groupsCache = null;
  groupsInflight = null;
  membersByGroup.clear();
  membersInflight.clear();
}

// 拉 /api/onebot/groups 建 groupId→groupName 映射;bot 断连时失败 → name(gid) 回退裸 id。
// 24h 内复用模块缓存,多组件挂载不重复请求。
export function useGroupNames() {
  const [names, setNames] = useState<Record<number, string>>(() =>
    groupsCache && alive(groupsCache.exp) ? groupsCache.data : {},
  );

  useEffect(() => {
    let aliveFlag = true;
    void loadGroups().then((data) => {
      if (aliveFlag) setNames(data);
    });
    return () => {
      aliveFlag = false;
    };
  }, []);

  const name = (gid: number) => names[gid] ?? String(gid);
  // session key "gid:uid" → "群名 · uid";非法则原样返回
  const label = (key: string) => {
    const [gid, uid] = key.split(":");
    const g = Number(gid);
    if (!gid || Number.isNaN(g)) return key;
    return uid ? `${name(g)} · ${uid}` : name(g);
  };
  return { names, name, label };
}

// 解析 session key("gid:uid")对应的群成员群名片/昵称。
// 按 gid 分组,每群拉一次 /api/onebot/members(整群成员);24h 内命中模块缓存则跳过请求。
// bot 断连/查不到 → memberName(key) 返回 ""(调用方回退 uid)。
export function useMemberNames(keys: string[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const joined = keys.join(",");

  useEffect(() => {
    const uniq = Array.from(new Set(joined.split(",").filter(Boolean))).filter((k) => /^\d+:\d+$/.test(k));
    const gids = Array.from(new Set(uniq.map((k) => Number(k.split(":")[0]))));
    if (gids.length === 0) return;

    let aliveFlag = true;

    // 先同步灌入仍新鲜的群缓存,首屏立刻有名
    const seeded: Record<string, string> = {};
    const missing: number[] = [];
    for (const g of gids) {
      const hit = membersByGroup.get(g);
      if (hit && alive(hit.exp)) Object.assign(seeded, hit.data);
      else missing.push(g);
    }
    if (Object.keys(seeded).length > 0) {
      setMap((prev) => ({ ...prev, ...seeded }));
    }
    if (missing.length === 0) return;

    void Promise.all(missing.map((g) => loadMembers(g))).then((parts) => {
      if (!aliveFlag) return;
      const merged = Object.assign({}, ...parts) as Record<string, string>;
      setMap((prev) => ({ ...prev, ...merged }));
    });

    return () => {
      aliveFlag = false;
    };
  }, [joined]);

  return (key: string) => map[key] || "";
}
