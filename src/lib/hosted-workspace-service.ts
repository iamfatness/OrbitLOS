import { env } from "cloudflare:workers";
import type { StaffIdentity } from "./staff-store";

function demoWorkspace() {
  return env.WORKSPACE.getByName("orbit-demo");
}

export async function loadWorkspace() {
  return demoWorkspace().read();
}

export async function updateWorkspace(input: unknown, staff: StaffIdentity | null) {
  return demoWorkspace().write(input, staff);
}

export async function updateBorrowerApplication(input: unknown) {
  return demoWorkspace().borrower(input);
}
export async function reserveBorrowerAddressLookup(token: string) {
  return demoWorkspace().reserveAddressLookup(token);
}
