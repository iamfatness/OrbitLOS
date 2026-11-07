import { env } from "cloudflare:workers";

function demoWorkspace() {
  return env.WORKSPACE.getByName("orbit-demo");
}

export async function loadWorkspace() {
  return demoWorkspace().read();
}

export async function updateWorkspace(input: unknown) {
  return demoWorkspace().write(input);
}

export async function updateBorrowerApplication(input: unknown) {
  return demoWorkspace().borrower(input);
}
export async function reserveBorrowerAddressLookup(token: string) {
  return demoWorkspace().reserveAddressLookup(token);
}
