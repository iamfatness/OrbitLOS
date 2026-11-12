import { z } from "zod";

export const obligationPlanningNotice = "Internal planning only; statutory applicability and lawyer approval remain unverified.";
const note = z.string().trim().min(5).max(1500);
export const obligationDraft = z.strictObject({
  title: z.string().trim().min(3).max(160),
  sourceUrl: z.url().max(2000).refine(value => new URL(value).protocol === "https:", "Use an HTTPS authority source."),
  authority: note, basis: note,
  applicability: z.enum(["Required", "Not applicable", "Needs review"]).default("Needs review"), applicabilityReason: note,
  reviewerEvidence: z.string().trim().max(1500),
  effectiveFrom: z.iso.date(), effectiveThrough: z.union([z.iso.date(), z.literal("")]),
  preparation: z.literal("Mortgage Call Report").optional(),
  cadence: z.enum(["Monthly", "Quarterly", "Annual"]), internalTargetDay: z.number().int().min(1).max(31),
  ownerEmail: z.email(),
}).superRefine((value, ctx) => {
  if (value.preparation && value.cadence !== "Quarterly")
    ctx.addIssue({ code: "custom", path: ["preparation"], message: "Choose a quarterly cadence for Mortgage Call Report preparation." });
  if (value.effectiveThrough && value.effectiveThrough < value.effectiveFrom)
    ctx.addIssue({ code: "custom", path: ["effectiveThrough"], message: "End date precedes effective date." });
  if (value.applicability !== "Needs review" && value.reviewerEvidence.length < 5)
    ctx.addIssue({ code: "custom", path: ["reviewerEvidence"], message: "Record internal reviewer evidence; this is not lawyer approval." });
});
const scope = { entityId: z.uuid() };
const change = { requestId: z.uuid() };
export const obligationStateReference = z.strictObject({
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  revision: z.number().int().positive(),
  sourceKey: z.string().regex(/^REQ-[A-Z]{2}-REPORTING-[A-Z0-9]+$/).max(30),
});
export const obligationStateSource = obligationStateReference.extend({
  title: z.string(), authority: z.string(), sourceUrl: z.url(),
});
export type ObligationStateSource = z.infer<typeof obligationStateSource>;
const filingPeriod = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const filingScope = { ...scope, id: z.uuid(), period: filingPeriod };
export const filingReceiptStatuses = ["Submitted", "Accepted", "Returned"] as const;
export const filingReceiptFields = z.strictObject({
  status: z.enum(filingReceiptStatuses),
  confirmation: z.string().trim().min(3).max(120),
  confirmedOn: z.iso.date(),
  documentReference: z.string().trim().max(350),
  note: z.string().trim().max(500),
});
export const filingReceiptLocation = z.string().trim().min(3).max(350);
export const filingReceiptEntry = filingReceiptFields.extend({
  version: z.int().positive(), recordedBy: z.string(), recordedAt: z.string(),
  addedReceiptReference: z.object({ location: filingReceiptLocation, recordedBy: z.string(), recordedAt: z.string() }).optional(),
});
export const filingReceiptHistory = z.object({
  kind: z.literal("filingReceipts"), items: z.array(filingReceiptEntry), today: z.iso.date(),
});
export const filingArchiveFilters = z.strictObject({
  entityId: z.union([z.uuid(), z.literal("")]), year: z.string().regex(/^(20\d{2})?$/),
  confirmation: z.string().trim().max(120),
});
export const filingArchiveRow = z.object({
  entityId: z.uuid(), entityName: z.string(), obligationId: z.uuid(), title: z.string(), period: filingPeriod,
  version: z.int().positive(), status: z.enum(filingReceiptStatuses),
  confirmation: z.string(), confirmedOn: z.iso.date(), matchedVersion: z.int().positive(),
  matched: z.object({
    status: z.enum(filingReceiptStatuses), confirmation: z.string(), confirmedOn: z.iso.date(), hasReceiptReference: z.boolean(),
  }),
  basis: z.object({ obligationId: z.uuid(), period: filingPeriod, version: z.int().positive(),
    status: z.string(), sourceUrl: z.url(), authority: z.string(), report: z.object({ year: z.string(), quarter: z.int().min(1).max(4) }) }),
});
export const filingArchivePage = z.object({
  kind: z.literal("filingArchive"), items: z.array(filingArchiveRow), more: z.boolean(),
  entities: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export const obligationRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("filingArchive"), filters: filingArchiveFilters, offset: z.int().min(0).max(10000).default(0) }),
  z.strictObject({ operation: z.literal("filingReceipts"), ...filingScope }),
  z.strictObject({ operation: z.literal("recordFilingReceipt"), ...filingScope, ...change,
    expectedVersion: z.int().nonnegative(), ...filingReceiptFields.shape }),
  z.strictObject({ operation: z.literal("addFilingReceiptReference"), ...filingScope, ...change,
    version: z.int().positive(), location: filingReceiptLocation }),
  z.strictObject({ operation: z.literal("planWork"), ...scope, ...change, id: z.uuid(), period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/) }),
  z.strictObject({ operation: z.literal("occurrences"), ...scope, id: z.uuid(), offset: z.number().int().min(0).max(10000).default(0) }),
  z.strictObject({ operation: z.literal("list"), ...scope, offset: z.number().int().min(0).max(10000).default(0) }),
  z.strictObject({ operation: z.literal("stateSources"), ...scope }),
  z.strictObject({ operation: z.literal("save"), ...scope, ...change, id: z.uuid(), expectedRevision: z.number().int().min(0),
    draft: obligationDraft, stateReference: obligationStateReference.optional() }),
  z.strictObject({ operation: z.literal("generate"), ...scope, ...change, id: z.uuid(), expectedRevision: z.number().int().positive(),
    period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/) }),
]);
export type ObligationRequest = z.infer<typeof obligationRequest>;
export type ObligationDraft = z.infer<typeof obligationDraft>;

/** Period is its first month; target is in its final month, UTC, clamped to month end. */
export function obligationPeriod(period: string, cadence: ObligationDraft["cadence"], targetDay: number) {
  const [year, month] = period.split("-").map(Number);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period) || !Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) return null;
  const months = cadence === "Annual" ? 12 : cadence === "Quarterly" ? 3 : 1;
  if ((cadence === "Annual" && month !== 1) || (cadence === "Quarterly" && (month - 1) % 3)) return null;
  const end = new Date(Date.UTC(year, month - 1 + months, 0));
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return { from: `${period}-01`, through: date(end), internalTarget: date(new Date(Date.UTC(year, month - 2 + months, Math.min(targetDay, end.getUTCDate())))) };
}

export type ObligationReviewBasis = {
  obligationId: string; period: string; version: number; status: string; sourceUrl: string; authority: string;
  report?: { year: string; quarter: number }; stateBasis?: ObligationStateSource;
};
