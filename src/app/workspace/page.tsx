import type { Metadata } from "next";
import { Orbit } from "@/components/orbit";
import { currentStaff, loadWorkspace, loadUwmConnection } from "@/lib/workspace-service";
import { supportWorkGroup, supportWorkOffset } from "@/lib/pilot-support-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Staff workspace · OrbitLOS", robots: { index: false } };

export default async function Workspace({ searchParams }: { searchParams: Promise<{ guide?: string; supportLoan?: string; supportWork?: string; offset?: string }> }) {
  const staff = await currentStaff();
  const { guide, supportLoan, supportWork, offset } = await searchParams;
  const initialGuide = guide === "campaign" ? "campaign" : guide === "1" ? "referral" : undefined;
  const group = supportWorkGroup(supportWork);
  const initialSupport = !initialGuide && staff?.brokerage.pilot && staff.brokerage.role === "Admin" && group &&
    typeof supportLoan === "string" && supportLoan.length > 0 && supportLoan.length <= 200
    ? { loanId: supportLoan, group, offset: supportWorkOffset(offset) } : undefined;
  const deferred = Boolean(staff) && !initialGuide;
  return <Orbit key={`${staff?.brokerage.id ?? "local"}:${initialGuide ?? "daily"}`} initial={await loadWorkspace(staff, deferred)}
    staff={staff} initialGuide={initialGuide} initialSupport={initialSupport} deferredWorkspace={deferred} uwmConnection={await loadUwmConnection(staff)} />;
}
