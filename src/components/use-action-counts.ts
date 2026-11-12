"use client";

import { useEffect, useState } from "react";
import { readSidebarActionCounts } from "@/app/actions";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";

export type ActionCounts = { today?: number; leads?: number; exceptions?: number; deliveryExceptions?: number; processing?: number };

export function useActionCounts(brokerageId: string, email: string | undefined, enabled: boolean, version: object) {
  const [result, setResult] = useState<{ brokerageId: string; email: string | undefined; counts?: ActionCounts; unavailable?: boolean }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let pending = false;
    async function read(isCurrent = () => true) {
      if (pending) return;
      pending = true;
      try {
        const counts = await readSidebarActionCounts(brokerageId);
        if (active && isCurrent()) setResult("error" in counts ? { brokerageId, email, unavailable: true } : { brokerageId, email, counts });
      } catch {
        if (active && isCurrent()) setResult((previous) => ({
          brokerageId, email, unavailable: true,
          counts: previous?.brokerageId === brokerageId && previous.email === email ? previous.counts : undefined,
        }));
      } finally { pending = false; }
    }
    void read();
    const stopReturn = observeTabReturn(document, window, (isCurrent) => void read(isCurrent));
    const stopChecks = observeVisibleChecks(document, window, read, 60_000);
    return () => { active = false; stopReturn(); stopChecks(); };
  }, [brokerageId, email, enabled, retry, version]);

  const current = enabled && result?.brokerageId === brokerageId && result.email === email ? result : undefined;
  return { counts: current?.counts, unavailable: current?.unavailable ?? false, refresh: () => {
    setResult(undefined);
    setRetry((value) => value + 1);
  } };
}
