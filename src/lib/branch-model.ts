import { z } from "zod";
import type { VersionedBrokerageMember } from "./brokerage-model";

export const branchLimit = 24;
export const branchStaffLimit = 24;
export const branchesUnavailable = "Branch setup is available to admins in this brokerage.";
const email = z.email().toLowerCase().max(254);
const version = { id: z.uuid(), revision: z.int().nonnegative() };
export const branchChange = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("saveBranch"), ...version, name: z.string().trim().min(2).max(60),
    staffEmails: z.array(email).max(branchStaffLimit).refine((emails) => new Set(emails).size === emails.length), ownerEmail: email.nullable() }),
  z.strictObject({ type: z.literal("setBranchActive"), ...version, active: z.boolean() }),
]);
export type BranchChange = z.infer<typeof branchChange>;

export type BranchStaff = { email: string; accessRevision: number };
export type BrokerageBranch = { id: string; name: string; active: boolean; revision: number; staff: BranchStaff[]; ownerEmail: string | null };
export type BranchChoice = Pick<BrokerageBranch, "id" | "name" | "active" | "ownerEmail">;

export function branchAccessRevision(member: VersionedBrokerageMember) {
  return (member.accessRevision ?? 0) + Number(member.status === "Invited");
}

export function branchStaffCurrent(assignment: BranchStaff, member?: VersionedBrokerageMember) {
  return !!member && member.status !== "Revoked" && branchAccessRevision(member) === assignment.accessRevision;
}
