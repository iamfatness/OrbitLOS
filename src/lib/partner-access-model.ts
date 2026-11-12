import { z } from "zod";

export const partnerPermissions = {
  "events.read": { label: "CRM events", sample: { eventId: "sample-event-01", eventType: "lead.created", source: "Website quote request" } },
  "leads.read": { label: "Lead summaries", sample: { leadId: "sample-lead-01", source: "Realtor referral", status: "New" } },
  "loans.read": { label: "Loan status", sample: { loanId: "sample-loan-01", stage: "Application", nextAction: "Review submitted 1003" } },
} as const;
export type PartnerPermission = keyof typeof partnerPermissions;
const scope = z.enum(Object.keys(partnerPermissions) as PartnerPermission[]);
const scopes = z.array(scope).min(1).max(Object.keys(partnerPermissions).length)
  .refine(values => new Set(values).size === values.length);
const before = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
export const partnerAccessQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), before }).strict(),
  z.object({ type: z.literal("detail"), id: z.uuid(), before }).strict(),
  z.object({ type: z.literal("approve"), id: z.uuid(), name: z.string().trim().min(1).max(80), scopes, expiresAt: z.iso.datetime() }).strict(),
  z.object({ type: z.literal("revoke"), id: z.uuid(), revision: z.literal(1), operationId: z.uuid() }).strict(),
  z.object({ type: z.literal("check"), id: z.uuid(), clientId: z.uuid(), scope, operationId: z.uuid() }).strict(),
  z.object({ type: z.literal("issueEventCredential"), id: z.uuid(), previous: z.uuid().nullable(), operationId: z.uuid() }).strict(),
]);

export type PartnerGrantState = "Active" | "Expired" | "Approval changed" | "Revoked";
export type PartnerGrant = { id: string; clientId: string; name: string; scopes: PartnerPermission[];
  state: PartnerGrantState; approvedBy: string; approvedAt: string; expiresAt: string;
  revokedBy: string | null; revokedAt: string | null; revision: 1 | 2 };
export const partnerCheckMessages = {
  Allowed: "This permission allows the fictional response below.",
  "Scope missing": "The grant does not include this permission.",
  "Client mismatch": "This grant belongs to a different sandbox client.",
  Expired: "The grant has expired.",
  "Approval changed": "The approving admin’s brokerage access changed. A new approval is required.",
  Revoked: "The grant has been revoked.",
} as const;
export type PartnerCheck = { id: string; scope: PartnerPermission; decision: keyof typeof partnerCheckMessages;
  at: string; actor: string };
export type PartnerGrantPage = { kind: "grants"; grants: PartnerGrant[]; next: number | null };
export type PartnerEventCredential = { id: string; issuedAt: string };
export type PartnerEventReceipt = { id: string; clientId: string; credentialId: string; at: string; decision: string; eventCount: number };
export type PartnerCredentialIssue = { kind: "eventCredential"; credential: PartnerEventCredential; bearer: string };
export type PartnerGrantDetail = { kind: "grant"; grant: PartnerGrant; checks: PartnerCheck[]; next: number | null;
  eventCredential: PartnerEventCredential | null; eventReceipts: PartnerEventReceipt[] };
export type PartnerCheckResult = { kind: "check"; grant: PartnerGrant; check: PartnerCheck; sample?: Record<string, string> };
