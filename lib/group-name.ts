"use client";

import { useEffect, useState } from "react";

// 拉 /api/onebot/groups 建 groupId→groupName 映射;bot 断连时失败 → name(gid) 回退裸 id
export function useGroupNames() {
  const [names, setNames] = useState<Record<number, string>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/onebot/groups")
      .then((x) => x.json())
      .then((r) => {
        if (alive && r.ok) {
          setNames(
            Object.fromEntries(
              (r.data as { groupId: number; groupName: string }[]).map((g) => [g.groupId, g.groupName]),
            ),
          );
        }
      })
      .catch(() => {
        /* bot 断连 → 回退裸 id */
      });
    return () => {
      alive = false;
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
// 按 gid 分组,每群拉一次 /api/onebot/members(整群成员),本地建 "gid:uid"→name 映射。
// 请求数按群数收敛(而非成员数);bot 断连/查不到 → memberName(key) 返回 ""(调用方回退 uid)。
export function useMemberNames(keys: string[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const [fetched, setFetched] = useState<Record<number, boolean>>({}); // 已拉过的群(含失败,避免重试风暴)
  const joined = keys.join(",");

  useEffect(() => {
    const uniq = Array.from(new Set(joined.split(",").filter(Boolean))).filter((k) => /^\d+:\d+$/.test(k));
    const gids = Array.from(new Set(uniq.map((k) => Number(k.split(":")[0]))));
    const missing = gids.filter((g) => !fetched[g]);
    if (missing.length === 0) return;
    let alive = true;
    // 每群一请求:一次拿整群成员,展开成 "gid:uid"→name
    Promise.all(
      missing.map(async (g) => {
        try {
          const r = await fetch(`/api/onebot/members?group=${g}`).then((x) => x.json());
          if (!r.ok) return [] as (readonly [string, string])[];
          return (r.data as { userId: number; name: string }[]).map((m) => [`${g}:${m.userId}`, m.name] as const);
        } catch {
          return [] as (readonly [string, string])[];
        }
      }),
    ).then((groupPairs) => {
      if (!alive) return;
      setMap((prev) => ({ ...prev, ...Object.fromEntries(groupPairs.flat()) }));
      setFetched((prev) => ({ ...prev, ...Object.fromEntries(missing.map((g) => [g, true])) }));
    });
    return () => {
      alive = false;
    };
    // map/fetched 仅读不入依赖:避免 setState 触发重跑;新群由 joined 变化驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  // 返回群名片/昵称;未知或查不到 → ""
  return (key: string) => map[key] || "";
}
