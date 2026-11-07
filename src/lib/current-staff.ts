import { headers } from "next/headers";
import type { StaffIdentity } from "./staff-store";

export async function currentStaff(): Promise<StaffIdentity | null> {
  const request = await headers();
  try {
    const email = decodeURIComponent(request.get("x-orbit-staff-email") ?? "");
    const name = decodeURIComponent(request.get("x-orbit-staff-name") ?? "");
    return email ? { email, name: name || email } : null;
  } catch {
    return null;
  }
}
