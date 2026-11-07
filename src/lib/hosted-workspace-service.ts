import { env } from "cloudflare:workers";
import type { WorkspaceStaff } from "./staff-store";
import { demoBrokerageId, portalBrokerage } from "./brokerage-model";
import { googleSettings } from "./staff-auth";
export { currentStaff } from "./current-staff";

function staffWorkspace(staff: WorkspaceStaff | null) {
  if (!staff && googleSettings(env)) throw new Error("Workspace access denied.");
  return env.WORKSPACE.getByName(staff?.brokerage.id ?? demoBrokerageId);
}

export async function loadWorkspace(staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).read(staff);
}

export async function updateWorkspace(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).write(input, staff);
}

async function linkedWorkspace(input: unknown) {
  const id = portalBrokerage(input && typeof input === "object" && "token" in input ? input.token : input);
  if (!id || (id !== demoBrokerageId && !await env.WORKSPACE.getByName(demoBrokerageId).hasBrokerage(id))) return null;
  return env.WORKSPACE.getByName(id);
}
export async function updateBorrowerApplication(input: unknown) {
  return (await linkedWorkspace(input))?.borrower(input) ?? { status: 404, error: "This application link is invalid or expired." };
}
export async function reserveBorrowerAddressLookup(token: string) {
  return (await linkedWorkspace(token))?.reserveAddressLookup(token) ?? 404;
}

export async function loadRealtorReferrals(input: unknown) {
  return (await linkedWorkspace(input))?.realtor(input) ?? { status: 404, error: "This referral link is invalid or expired." };
}

export async function submitQuoteRequest(input: unknown) {
  const workspace = await linkedWorkspace(input);
  return workspace?.quoteLead(input, [...(googleSettings(env)?.allowedEmails ?? [])]) ?? { status: 404, error: "This quote request link is unavailable." };
}
