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
// 逐 key 查 /api/onebot/member,缓存;bot 断连/查不到 → memberName(key) 返回 ""(调用方回退 uid)。
export function useMemberNames(keys: string[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const joined = keys.join(",");

  useEffect(() => {
    const uniq = Array.from(new Set(joined.split(",").filter(Boolean)));
    const missing = uniq.filter((k) => !(k in map) && /^\d+:\d+$/.test(k));
    if (missing.length === 0) return;
    let alive = true;
    Promise.all(
      missing.map(async (k) => {
        const [g, u] = k.split(":");
        try {
          const r = await fetch(`/api/onebot/member?group=${g}&user=${u}`).then((x) => x.json());
          return [k, r.ok ? String(r.data.name) : ""] as const;
        } catch {
          return [k, ""] as const;
        }
      }),
    ).then((pairs) => {
      if (alive) setMap((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      alive = false;
    };
    // map 仅读不入依赖:避免每次 setMap 触发重跑;新 key 由 joined 变化驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  // 返回群名片/昵称;未知或查不到 → ""
  return (key: string) => map[key] || "";
}
