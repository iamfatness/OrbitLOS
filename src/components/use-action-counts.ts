"use client";

import { useEffect, useState } from "react";
import { readSidebarActionCounts } from "@/app/actions";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";

type Counts = { today?: number; leads?: number; exceptions?: number; processing?: number };

export function useActionCounts(brokerageId: string, email: string | undefined, enabled: boolean, version: object) {
  const [result, setResult] = useState<{ brokerageId: string; email: string | undefined; counts: Counts }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let pending = false;
    async function read(isCurrent = () => true) {
      if (pending) return;
      pending = true;
      try {
        const counts = await readSidebarActionCounts(brokerageId);
        if (active && isCurrent()) setResult("error" in counts ? undefined : { brokerageId, email, counts });
      } catch {
        // Keep the last visible counts until the next successful foreground check.
      } finally { pending = false; }
    }
    void read();
    const stopReturn = observeTabReturn(document, window, (isCurrent) => void read(isCurrent));
    const stopChecks = observeVisibleChecks(document, window, read, 60_000);
    return () => { active = false; stopReturn(); stopChecks(); };
  }, [brokerageId, email, enabled, version]);

  return enabled && result?.brokerageId === brokerageId && result.email === email ? result.counts : undefined;
}
