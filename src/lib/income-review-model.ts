import { z } from "zod";
import { documentRecipients, type DocumentRecipient } from "./document-model";
import type { incomeVerificationKinds } from "./service-order-model";

export const incomeReviewUnavailable = "Income review is available on fictional loans you can work.";
export const repriceIncomeMessage = "The reviewed income or its evidence changed. Review the worksheet and reprice.";
export const incomeWorksheetMethod = "monthly-arithmetic-v1";
export const incomeSourceLimit = 12;
export const incomeEvidenceLimit = 4;
export const incomeMethods = ["Monthly amount", "Total across months", "Amount per pay period"] as const;
export const incomeKinds = ["Wages", "Self-employment", "Other"] as const;
export const maxIncomeCents = 1_000_000_000;
const date = z.union([z.literal(""), z.iso.date()]);
const cents = z.number().int().min(0).max(maxIncomeCents);
const revision = z.number().int().nonnegative();
const loanId = z.string().min(1).max(100);
const evidence = z.object({ id: z.uuid(), revision, returnReference: z.string().min(1).max(100).optional() });
export const incomeSource = z.object({
  id: z.uuid(), recipient: z.enum(documentRecipients), label: z.string().trim().max(100), kind: z.enum(incomeKinds),
  method: z.enum(incomeMethods), included: z.boolean(), start: date, end: date,
  amount: cents.nullable(), periods: z.number().int().min(1).max(60).nullable(),
  adjustment: z.number().int().min(-maxIncomeCents).max(maxIncomeCents), rationale: z.string().trim().max(400),
  evidence: z.array(evidence).max(incomeEvidenceLimit),
});
const mutation = { loanId, revision, applicationRevision: revision, requestId: z.uuid() };
export const incomeWorksheetRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), loanId, worksheetRevision: revision.positive().optional() }),
  z.object({ type: z.literal("save"), ...mutation, sources: z.array(incomeSource).max(incomeSourceLimit) }),
  z.object({ type: z.literal("submit"), ...mutation }),
  z.object({ type: z.literal("approve"), ...mutation, note: z.string().trim().min(1).max(400) }),
]);

export type IncomeSource = z.infer<typeof incomeSource>;
export type IncomeEvidenceReference = z.infer<typeof evidence>;
export type IncomeEvidence = IncomeEvidenceReference & { label: string; recipient: DocumentRecipient;
  verification?: { kind: (typeof incomeVerificationKinds)[number]; returnedAt: string; acceptedAt: string; acceptedBy: string } };
export const incomeEvidenceKey = ({ id, returnReference }: IncomeEvidenceReference) => `${returnReference ? "verification" : "document"}:${id}`;
export function sameIncomeEvidence(a: IncomeEvidenceReference, b: IncomeEvidenceReference) {
  return a.id === b.id && a.revision === b.revision && a.returnReference === b.returnReference;
}
export type IncomeStage = "Draft" | "Ready for review" | "Approved";
export type IncomeWorksheetRecord = {
  revision: number; applicationRevision: number; stage: IncomeStage; amount: number; sources: IncomeSource[];
  method: string; updatedBy: string; updatedAt: string; note: string; evidence: IncomeEvidence[];
};
export type ReviewedIncomeSource = Pick<IncomeWorksheetRecord, "revision" | "applicationRevision" | "amount">;
export type IncomeWorksheetPage = {
  applicationRevision: number | null; reviewed: boolean; canEdit: boolean; canApprove: boolean; asOf: string;
  recipients: DocumentRecipient[];
  declared: { recipient: DocumentRecipient; amount: number | null }[]; eligible: IncomeEvidence[];
  record: IncomeWorksheetRecord | null; stale: "1003 changed" | "Evidence changed" | null;
  requested?: IncomeWorksheetRecord;
  history: Omit<IncomeWorksheetRecord, "sources" | "evidence">[];
};

export function incomeSourceMonthly(source: IncomeSource) {
  if (!source.included || source.amount === null) return 0;
  const { amount, method, periods, adjustment } = source;
  if (method === "Monthly amount") return amount + adjustment;
  if (!periods) return 0;
  return Math.round(method === "Total across months" ? amount / periods : amount * periods / 12) + adjustment;
}

export function monthlyWorksheetTotal(sources: IncomeSource[]) {
  return sources.reduce((total, source) => total + incomeSourceMonthly(source), 0);
}

export function incomeCompletionIssue(sources: IncomeSource[], asOf: string) {
  if (!sources.some((source) => source.included)) return "Include at least one documented income source.";
  for (const [index, source] of sources.entries()) {
    const name = source.label || `Source ${index + 1}`;
    if (!source.label) return `Name source ${index + 1}.`;
    if (!source.included) {
      if (!source.rationale) return `Explain why ${name} was excluded.`;
      continue;
    }
    if (!source.start || !source.end || source.start > source.end || source.end > asOf) return `Enter the source period for ${name}.`;
    if (source.amount === null || (source.method !== "Monthly amount" && !source.periods)) return `Enter the amount and period count for ${name}.`;
    if (!source.evidence.length) return `Select accepted evidence for ${name}.`;
    if (source.adjustment && !source.rationale) return `Explain the adjustment for ${name}.`;
    if (incomeSourceMonthly(source) < 0) return `Review the negative monthly amount for ${name}.`;
  }
  const total = monthlyWorksheetTotal(sources);
  if (total <= 0 || total > maxIncomeCents) return "Enter a positive monthly total within the demo pricing range.";
  return null;
}
