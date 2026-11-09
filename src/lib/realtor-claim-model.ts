import { z } from "zod";
import type { WorkspaceStaff } from "./staff-store";

export const sharedRealtorQueueUnavailable = "The shared realtor referral queue is unavailable in this workspace.";
export const sharedRealtorOfficerLimit = 20;
export const saveRealtorClaimPolicyInput = z.object({
  type: z.literal("saveRealtorClaimPolicy"), revision: z.number().int().nonnegative(),
  officers: z.array(z.email().max(254)).max(sharedRealtorOfficerLimit).refine((emails) => new Set(emails).size === emails.length),
});
export const claimSharedRealtorInput = z.object({ type: z.literal("claimSharedRealtor"), leadId: z.uuid() });
const cursor = z.object({ id: z.uuid(), dueAt: z.iso.datetime() });
export const sharedRealtorQueueInput = z.object({ after: cursor.optional() });
export type RealtorClaimPolicy = { revision: number; officers: { email: string; accessRevision: number }[] };
export type SharedRealtorQueue = { leads: (z.infer<typeof cursor> & { realtor: string; purpose: string; firstContactLogged: boolean })[];
  next: z.infer<typeof cursor> | null };

export function canClaimSharedRealtor(staff: WorkspaceStaff | null, policy?: RealtorClaimPolicy) {
  return staff?.brokerage.role === "LO" && !!policy?.officers.some((officer) =>
    officer.email === staff.email && officer.accessRevision === staff.brokerage.accessRevision);
}
