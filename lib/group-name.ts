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
