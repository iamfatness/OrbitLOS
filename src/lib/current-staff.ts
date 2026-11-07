import { headers } from "next/headers";
import type { WorkspaceStaff } from "./staff-store";
import { brokerageIdPattern } from "./brokerage-model";

export async function currentStaff(): Promise<WorkspaceStaff | null> {
  const request = await headers();
  try {
    const email = decodeURIComponent(request.get("x-orbit-staff-email") ?? "");
    const name = decodeURIComponent(request.get("x-orbit-staff-name") ?? "");
    const brokerage = JSON.parse(decodeURIComponent(request.get("x-orbit-brokerage") ?? "null"));
    return email && brokerage && typeof brokerage.id === "string" && brokerageIdPattern.test(brokerage.id) &&
      typeof brokerage.name === "string" && (brokerage.role === "Admin" || brokerage.role === "LO")
      ? { email, name: name || email, brokerage } : null;
  } catch {
    return null;
  }
}
