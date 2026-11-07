import type { Metadata } from "next";
import { Orbit } from "@/components/orbit";
import { loadWorkspace } from "@/lib/workspace-service";
import { currentStaff } from "@/lib/current-staff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Staff workspace · OrbitLOS", robots: { index: false } };

export default async function Workspace() {
  return <Orbit initial={await loadWorkspace()} staff={await currentStaff()} />;
}
