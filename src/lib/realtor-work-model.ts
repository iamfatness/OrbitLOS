import { z } from "zod";
import { contactCursor, type ContactRow } from "./contact-directory-model";
import type { LeadRouting } from "./lead-inbox-model";
import { leadSources, type RealtorPortal } from "./model";

export const realtorWorkUnavailable = "Could not load realtor work. Try again.";
export const conversionMetrics = { referrals: "Referrals", submitted: "Submitted 1003s", funded: "Funded loans" } as const;
export const realtorRecordViews = ["referrals", "submitted", "funded", "linked", "open"] as const;
const id = z.string().max(240);
const date = z.union([z.iso.date(), z.literal("")]);
const filters = z.object({ from: date, through: date, officer: z.string().max(254), source: z.union([z.enum(leadSources), z.literal("")]) })
  .refine(({ from, through }) => !from || !through || from <= through);
const recordCursor = z.object({ at: z.string().max(80), id: id.min(1), kind: z.enum(["loan", "lead"]) });
export const realtorWorkInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("directory"), search: z.string().trim().max(120), filters, after: contactCursor.optional() }),
  z.object({ type: z.literal("profile"), partnerId: id.min(1) }),
  z.object({ type: z.literal("records"), partnerId: id, view: z.enum(realtorRecordViews), filters, after: recordCursor.optional() }),
]);
export type RealtorWorkQuery = z.infer<typeof realtorWorkInput>;
export type RealtorFilters = z.infer<typeof filters>;
export type RealtorRecordView = (typeof realtorRecordViews)[number];
export type ConversionCounts = Record<keyof typeof conversionMetrics, number>;
export type ConversionPartner = { id: string; name: string; counts: ConversionCounts };
export type RealtorDirectoryPage = {
  kind: "directory"; partners: ConversionPartner[]; direct?: ConversionPartner; next: z.infer<typeof contactCursor> | null;
  officers?: { key: string; name: string }[];
};
export type RealtorProfile = {
  kind: "profile"; contact: ContactRow; portal: RealtorPortal | null; checkedAt: string;
  routing: Pick<LeadRouting, "realtorRoute" | "realtorOwner">; linked: number; open: number; closed: number;
};
export type RealtorRecord = {
  id: string; kind: "loan" | "lead"; name: string; status: string; at: string; officer: string;
  source: string | null; submittedAt: string | null; fundedOn: string | null; archived: boolean;
  openTasks?: number; lastActivityAt?: string | null;
};
export type RealtorRecordsPage = {
  kind: "records"; partnerName: string; rows: RealtorRecord[]; next: z.infer<typeof recordCursor> | null; total?: number;
};
export type RealtorWorkResult = RealtorDirectoryPage | RealtorProfile | RealtorRecordsPage | { error: string };
export type RealtorMutationResult = { realtorChanged: true; message: string };
