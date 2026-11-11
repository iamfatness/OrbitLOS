import type { Metadata } from "next";
import { currentStaff } from "@/lib/workspace-service";
import { WorkspaceMaintenance } from "@/components/workspace-maintenance";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Workspace maintenance · OrbitLOS",robots:{index:false}};
export default async function MaintenancePage() {
  const staff=await currentStaff();
  return <WorkspaceMaintenance staff={staff}/>;
}
