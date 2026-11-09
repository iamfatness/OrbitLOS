"use client";

import { useEffect, useState } from "react";
import type { BrokerageSettings, VersionedBrokerageMember } from "@/lib/brokerage-model";

export function useLeadOwners(brokerage: string | null) {
  const [members, setMembers] = useState<VersionedBrokerageMember[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!brokerage) return;
    const controller = new AbortController();
    fetch(`/api/brokerages?brokerage=${encodeURIComponent(brokerage)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load active loan officers. Refresh before assigning.");
      const team = await response.json() as BrokerageSettings;
      if (!controller.signal.aborted) {
        setError("");
        setMembers(team.members.filter((member) => member.status === "Active" && member.role !== "Processor"));
      }
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [brokerage]);
  return { members, error };
}
