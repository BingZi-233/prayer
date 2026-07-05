"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface Status {
  state: string;
  wsConnected: boolean;
  sessionCount: number;
  handoffQueue: number;
  lastError?: string;
  bootedAt?: number;
}
interface Overview {
  enabledGroups: number;
  reflectionCount: number;
  openTickets: number;
  humanSessions: number;
}
interface Live {
  status: Status | null;
  overview: Overview | null;
  lastUpdated: number | null;
}

const LiveCtx = createContext<Live>({ status: null, overview: null, lastUpdated: null });

export function useLive() {
  return useContext(LiveCtx);
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [st, ov] = await Promise.all([
          fetch("/api/status").then((x) => x.json()),
          fetch("/api/overview").then((x) => x.json()),
        ]);
        if (!alive) return;
        if (st.ok) setStatus(st.data);
        if (ov.ok) setOverview(ov.data);
        setLastUpdated(Date.now());
      } catch {
        /* 轮询失败静默,保留上次值 */
      }
    }
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // tab 标题:有待处理工单 → "(N) 客服 Agent",离开页面也瞥得见
  useEffect(() => {
    const n = overview?.openTickets ?? 0;
    document.title = n > 0 ? `(${n}) 客服 Agent` : "客服 Agent";
  }, [overview?.openTickets]);

  return <LiveCtx.Provider value={{ status, overview, lastUpdated }}>{children}</LiveCtx.Provider>;
}
