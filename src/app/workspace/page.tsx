import type { Metadata } from "next";
import { Orbit } from "@/components/orbit";
import { currentStaff, loadWorkspace } from "@/lib/workspace-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Staff workspace · OrbitLOS", robots: { index: false } };

export default async function Workspace() {
  const staff = await currentStaff();
  return <Orbit initial={await loadWorkspace(staff)} staff={staff} />;
}
