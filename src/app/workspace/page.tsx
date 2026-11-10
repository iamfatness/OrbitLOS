import type { Metadata } from "next";
import { Orbit } from "@/components/orbit";
import { currentStaff, loadWorkspace, loadUwmConnection } from "@/lib/workspace-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Staff workspace · OrbitLOS", robots: { index: false } };

export default async function Workspace({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  const staff = await currentStaff();
  const { guide } = await searchParams;
  const initialGuide = guide === "campaign" ? "campaign" : guide === "1" ? "referral" : undefined;
  const deferred = Boolean(staff) && !initialGuide;
  return <Orbit key={`${staff?.brokerage.id ?? "local"}:${initialGuide ?? "daily"}`} initial={await loadWorkspace(staff, deferred)}
    staff={staff} initialGuide={initialGuide} deferredWorkspace={deferred} uwmConnection={await loadUwmConnection(staff)} />;
}
