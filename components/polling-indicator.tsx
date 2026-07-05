"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/components/live-provider";

export function PollingIndicator() {
  const { lastUpdated } = useLive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lastUpdated) return null;
  const sec = Math.max(0, Math.floor((now - lastUpdated) / 1000));
  return (
    <span className="text-muted-foreground flex items-center gap-1.5" suppressHydrationWarning>
      <span className="bg-primary size-1.5 animate-pulse rounded-full" />
      实时 · {sec}s 前
    </span>
  );
}
