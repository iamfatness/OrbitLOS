import { z } from "zod";
import { easternDate } from "./client-retention";
import type { QuarterReviewPage, QuarterReviewSummary } from "./call-report-quarter-model";
import type { buildFv7QuarterWorkpaper } from "./mcr-fv7-quarter-evidence";

export const fv7EvidenceFileLimit = 1_000_000;
export type Fv7Workpaper = ReturnType<typeof buildFv7QuarterWorkpaper>;
export type Fv7SavedWorkpaper = {
  sequence: number;
  version: number;
  entityReference: string;
  reconciled: boolean;
  recordedAt: string;
  recordedBy: string;
};

export const reportingReadinessUnavailable = "Reporting readiness is available to brokerage admins.";
export const callReportFactsTarget = "loan-call-report";
const quarter = z.number().int().min(1).max(4);
const year = z.number().int().min(1900).max(9998);
const cursor = z.object({ id: z.string().min(1).max(160), sortOn: z.union([z.iso.date(), z.literal("")]) });
const version = z.number().int().positive();
export const reportingReadinessInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), year, quarter, after: cursor.optional() }),
  z.object({ type: z.literal("export"), year, quarter }),
  z.object({ type: z.literal("quarterReview"), year, quarter, offset: z.number().int().min(0).max(2000).default(0) }),
  z.object({ type: z.literal("saveQuarterReview"), year, quarter, previousVersion: version.nullable(),
    evidenceKey: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.uuid(), note: z.string().trim().max(500).default("") }),
  z.object({ type: z.literal("downloadQuarterReview"), year, quarter, version }),
  z.object({ type: z.literal("fv7Template"), year, quarter, version }),
  z.object({ type: z.literal("fv7Preview"), year, quarter, version,
    evidence: z.string().min(1).max(fv7EvidenceFileLimit) }),
  z.object({ type: z.literal("fv7Save"), year, quarter, version,
    evidence: z.string().min(1).max(fv7EvidenceFileLimit), checked: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ type: z.literal("fv7History"), year, quarter, before: version.optional() }),
  z.object({ type: z.literal("fv7Read"), year, quarter, sequence: version }),
]);
export type ReportingReadinessInput = z.infer<typeof reportingReadinessInput>;
export type ReportingPeriod = { year: string; quarter: number };
export function currentReportingPeriod(now = new Date()): ReportingPeriod {
  const today = easternDate(now);
  return { year: today.slice(0, 4), quarter: Math.ceil(Number(today.slice(5, 7)) / 3) };
}
export type ReportingBlocker = z.infer<typeof cursor> & { borrower: string; officer: string; issues: string[]; revision: number;
  firstApplication: string; fundingDate: string };
export type ReportingReadiness = { kind: "list"; indexing: boolean; blockers: number; items: ReportingBlocker[]; next: z.infer<typeof cursor> | null;
  from: string; through: string } | { kind: "export"; csv: string; count: number } | QuarterReviewPage |
  { kind: "quarterReviewSaved"; review: QuarterReviewSummary } |
  { kind: "quarterReviewDownload"; version: number; csv: string } |
  { kind: "fv7Template"; version: number; json: string } |
  { kind: "fv7Preview"; workpaper: Fv7Workpaper; checked: string } |
  { kind: "fv7Saved"; saved: Fv7SavedWorkpaper } |
  { kind: "fv7History"; items: Fv7SavedWorkpaper[]; next: number | null } |
  { kind: "fv7Read"; saved: Fv7SavedWorkpaper; workpaper: Fv7Workpaper; evidence: string } | { error: string };
