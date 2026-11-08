import type { Metadata } from "next";
import { Orbit } from "@/components/orbit";
import { currentStaff, loadWorkspace } from "@/lib/workspace-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Staff workspace · OrbitLOS", robots: { index: false } };

export default async function Workspace({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  const staff = await currentStaff();
  return <Orbit key={staff?.brokerage.id ?? "local"} initial={await loadWorkspace(staff)} staff={staff} initialGuide={(await searchParams).guide === "1"} />;
}
