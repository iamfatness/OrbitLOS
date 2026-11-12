import { z } from "zod";
import type { BrokerageMember } from "./brokerage-model";

export const departureKinds = ["Lead", "Loan", "Processing", "Contact follow-up", "Contact conversation", "Review requester", "Reviewer", "Coverage", "Realtor link", "Intake route", "Branch default"] as const;
const email = z.email().max(254);
const id = z.string().min(1).max(160);
const kind = z.enum(departureKinds);
const revision = z.number().int().nonnegative();
const target = { email };
const key = { kind, id };

export const offboardingInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("offboardingPreview"), ...target, filter: z.enum(["All work", ...departureKinds]), after: z.object(key).optional() }),
  z.object({ type: z.literal("offboardingTransfer"), ...target, ...key, revision, memberRevision: revision, replacement: email.nullable(),
    operationId: z.uuid(), routeKey: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  z.object({ type: z.literal("offboardingRevoke"), ...target, memberRevision: revision, immediate: z.boolean() }),
]);
export type OffboardingInput = z.infer<typeof offboardingInput>;
export type DepartureKind = (typeof departureKinds)[number];
export type DepartureMember = BrokerageMember & { accessRevision: number; ownsFinancials: boolean };
export type DepartureItem = { kind: DepartureKind; id: string; recordId: string; title: string; detail: string; revision: number;
  due: string | null; dueLabel: string; campaignId: string | null; loanOfficer: string | null; processor: string | null; otherReviewer: string | null; routeKey?: string; branchStaffEmails?: string[] };
export type DepartureRoster = { member: DepartureMember; replacement: DepartureMember | null; canRevoke: boolean };
export type DeparturePage = { member: DepartureMember; items: DepartureItem[]; next: Pick<DepartureItem, "kind" | "id"> | null; remaining: boolean; canRevoke: boolean };
export const offboardingUnavailable = "Staff offboarding is available to brokerage admins.";
