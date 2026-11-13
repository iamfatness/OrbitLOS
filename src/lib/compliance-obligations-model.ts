import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

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
  cadence: z.enum(["Monthly", "Quarterly", "Fiscal quarterly", "Annual"]), internalTargetDay: z.number().int().min(1).max(31),
  annualStartMonth: z.int().min(1).max(12).optional(),
  ownerEmail: z.email(),
}).superRefine((value, ctx) => {
  if (value.preparation && value.cadence !== "Quarterly")
    ctx.addIssue({ code: "custom", path: ["preparation"], message: "Choose a quarterly cadence for Mortgage Call Report preparation." });
  if (value.effectiveThrough && value.effectiveThrough < value.effectiveFrom)
    ctx.addIssue({ code: "custom", path: ["effectiveThrough"], message: "End date precedes effective date." });
  if (value.applicability !== "Needs review" && value.reviewerEvidence.length < 5)
    ctx.addIssue({ code: "custom", path: ["reviewerEvidence"], message: "Record internal reviewer evidence; this is not lawyer approval." });
  if (value.annualStartMonth !== undefined && value.cadence !== "Annual" && value.cadence !== "Fiscal quarterly")
    ctx.addIssue({ code: "custom", path: ["annualStartMonth"], message: "A fiscal start month applies to annual or fiscal quarterly periods." });
  if (value.cadence === "Fiscal quarterly" && value.annualStartMonth === undefined)
    ctx.addIssue({ code: "custom", path: ["annualStartMonth"], message: "Choose the fiscal year start month." });
});
const scope = { entityId: z.uuid() };
const change = { requestId: z.uuid() };
const companyRenewals = [
  "REQ-MI-LICENSING-FIRST-RENEW", "REQ-MI-LICENSING-SECOND-RENEW",
  "REQ-TX-LICENSING-CO-RENEW", "REQ-TX-LICENSING-BANKER-RENEW",
  "REQ-CO-LICENSING-CO-RENEW",
];
export const isObligationStateSource = (key: string) =>
  /^REQ-[A-Z]{2}-REPORTING-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(key) || companyRenewals.includes(key);
export const obligationStateReference = z.strictObject({
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  revision: z.number().int().positive(),
  sourceKey: z.string().max(30).refine(isObligationStateSource),
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
export const reportingDateBasis = z.object({ route: z.string(), nominalDueOn: z.iso.date().nullable(), review: z.string() });

/** Period is its first month; target is in its final month, UTC, clamped to month end. */
export function obligationPeriod(period: string, cadence: ObligationDraft["cadence"], targetDay: number, annualStartMonth = 1) {
  const [year, month] = period.split("-").map(Number);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period) || !Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) return null;
  const quarterly = cadence === "Quarterly" || cadence === "Fiscal quarterly";
  const months = cadence === "Annual" ? 12 : quarterly ? 3 : 1;
  const quarterStart = cadence === "Fiscal quarterly" ? annualStartMonth : 1;
  if ((cadence === "Annual" && month !== annualStartMonth) || (quarterly && (month - quarterStart) % 3)) return null;
  const end = new Date(Date.UTC(year, month - 1 + months, 0));
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return { from: `${period}-01`, through: date(end), internalTarget: date(new Date(Date.UTC(year, month - 2 + months, Math.min(targetDay, end.getUTCDate())))) };
}

export type ObligationReviewBasis = {
  obligationId: string; period: string; version: number; status: string; sourceUrl: string; authority: string;
  report?: { year: string; quarter: number }; stateBasis?: ObligationStateSource;
  reportingBasis?: z.infer<typeof reportingDateBasis>;
};
type FilingRule = {
  route: string; review: string; cadence: "Quarterly" | "Fiscal quarterly" | "Calendar annual" | "Fiscal annual" | "Role-based";
  due: (through: string, cadence: ObligationDraft["cadence"]) => string | null;
  from?: string;
};
const after = (days: number) => (through: string) => shiftReportDate(through, days);
const quarter = (route: string, review: string, from?: string): FilingRule => ({ route, review, cadence: "Quarterly", due: after(45), from });
const financialCondition = (review: string): FilingRule => ({
  route: "NMLS Financial Condition", cadence: "Role-based",
  due: (through, cadence) => shiftReportDate(through, cadence === "Quarterly" ? 45 : 90), review,
});
const michiganRenewal: FilingRule = {
  route: "NMLS company renewal", cadence: "Calendar annual", from: "2025-01-01",
  due: through => `${through.slice(0, 4)}-12-15`,
  review: "Company authority expires December 31 unless renewed. Confirm the current instructions, fee, bond if applicable and renewed status.",
};
const texasRenewal: FilingRule = {
  route: "NMLS company renewal", cadence: "Calendar annual", from: "2026-01-01", due: through => through,
  review: "Verify the applicable Texas SML renewal instructions, receipt and current license or registration status.",
};
const filings: Partial<Record<string, FilingRule>> = {
  "REQ-MI-LICENSING-FIRST-RENEW": michiganRenewal,
  "REQ-MI-LICENSING-SECOND-RENEW": michiganRenewal,
  "REQ-CA-REPORTING-DRE-MCR": quarter("NMLS Mortgage Call Report", "Confirm DRE company coverage and current NMLS quarterly instructions."),
  "REQ-CA-REPORTING-BAR": { route: "DRE Business Activity Reporting System", cadence: "Fiscal annual", due: after(90),
    review: "Confirm the fiscal year end, applicable reporting parts and any calendar adjustment with counsel." },
  "REQ-CA-REPORTING-CFLANNUAL": { route: "DFPI self-service portal", cadence: "Calendar annual",
    due: through => `${Number(through.slice(0, 4)) + 1}-03-15`,
    review: "Verify report-year business-day instructions and the no-business schedules with counsel." },
  "REQ-CA-REPORTING-CRMLA-ANNUAL": { route: "DFPI self-service portal", cadence: "Calendar annual",
    due: through => `${Number(through.slice(0, 4)) + 1}-03-01`,
    review: "Confirm CRMLA authority, the current annual schedules, attestation and applicable no-activity instructions." },
  "REQ-CA-REPORTING-HOLDEN": { route: "DFPI Holden Act submission", cadence: "Calendar annual",
    due: through => `${Number(through.slice(0, 4)) + 1}-03-31`,
    review: "Verify the current form and submission route. Confirm whether to submit loan data or a signed response for HMDA reporting or inactivity." },
  "REQ-CA-REPORTING-CRMLA-MCR": quarter("NMLS Mortgage Call Report", "Confirm the CRMLA scope and whether other California authorities share this NMLS submission."),
  "REQ-CA-REPORTING-CRMLA-AUDIT": { route: "NMLS audited financial statement upload", cadence: "Fiscal annual", due: after(105),
    review: "Confirm the fiscal year end, audited statements and required CPA or trust reconciliation supplements." },
  "REQ-MI-REPORTING-RMLA": quarter("NMLS Residential Mortgage Loan Activity", "Verify the entity, filing calendar and no-activity evidence."),
  "REQ-MI-REPORTING-FC": financialCondition("Confirm the calendar-year broker basis or quarterly lender or servicer basis with counsel."),
  "REQ-MI-REPORTING-GAAP": { route: "NMLS financial statement upload", cadence: "Fiscal annual", due: after(90),
    review: "Confirm the MU1 fiscal year end, GAAP statement requirements and upload evidence with counsel." },
  "REQ-FL-REPORTING-MCR": quarter("NMLS Residential Mortgage Loan Activity", "Confirm the Florida license and current NMLS form version and no-activity evidence.", "2024-10-10"),
  "REQ-FL-REPORTING-BROKER-FC": { route: "NMLS Financial Condition", cadence: "Calendar annual", due: after(90), from: "2024-10-10",
    review: "Confirm Florida broker status and the applicable NMLS form and calendar with counsel." },
  "REQ-FL-REPORTING-LENDER-FC": quarter("NMLS Financial Condition", "Confirm Florida lender status and quarterly filing evidence.", "2024-10-10"),
  "REQ-FL-REPORTING-LENDER-AUDIT": { route: "Florida Office of Financial Regulation", cadence: "Fiscal annual", due: after(120),
    review: "Use the disclosed fiscal year end for an unchanged year. Confirm the OFR channel and any parent audit or fiscal-year change with counsel." },
  "REQ-FL-REPORTING-AUDIT-CHANGE": { route: "Florida Office of Financial Regulation", cadence: "Fiscal annual", due: () => null,
    review: "Confirm the deadline using the prior audit submission date and the 18-month transition provision." },
  "REQ-TX-REPORTING-MCR": quarter("NMLS Residential Mortgage Loan Activity", "Confirm the company or banker authority and required components."),
  "REQ-TX-REPORTING-FC": financialCondition("Confirm the calendar-year broker basis or quarterly lender or servicer basis with counsel."),
  "REQ-TX-REPORTING-SSSF": quarter("NMLS State-Specific Supplemental Form", "Confirm independent processor or underwriter activities, identifiers and current SSSF instructions.", "2026-01-01"),
  "REQ-TX-REPORTING-OCCC-ANNUAL": { route: "Texas OCCC annual reporting portal", cadence: "Calendar annual", from: "2025-01-01",
    due: through => `${Number(through.slice(0, 4)) + 1}-05-01`,
    review: "Confirm Chapter 342 authority and current OCCC schedules. Review partial-year, no-activity and same-entity consolidation requirements." },
  "REQ-TX-LICENSING-CO-RENEW": texasRenewal,
  "REQ-TX-LICENSING-BANKER-RENEW": texasRenewal,
  "REQ-NY-REPORTING-MCR": quarter("NMLS Mortgage Call Report", "Confirm originating entity scope and the limits of any quarterly commitment-data substitution."),
  "REQ-NY-REPORTING-VOOR": { route: "New York DFS VOOR portal or mail", cadence: "Calendar annual",
    due: through => through === "2025-12-31" ? "2026-06-22" : null,
    review: "The verified date covers the 2025 broker report. Confirm the report-year deadline, submission instructions and no-activity treatment." },
  "REQ-NY-REPORTING-BANKER-VOOR": { route: "New York DFS VOOR portal or mail", cadence: "Calendar annual",
    due: through => through === "2025-12-31" ? "2026-06-22" : null,
    review: "The verified date covers the 2025 banker report. Confirm the current banker schedules, attestation and report-year deadline." },
  "REQ-NY-REPORTING-BANKER-QFS": { route: "New York DFS quarterly financial report", cadence: "Fiscal quarterly", due: after(45),
    review: "Confirm the DFS submission instructions. The NMLS substitution applies to quarterly commitment data only." },
  "REQ-NY-REPORTING-BANKER-AUDIT": { route: "New York DFS audited financial statement", cadence: "Fiscal annual", due: after(90),
    review: "Confirm the fiscal year end, audited statements and current DFS submission channel." },
  "REQ-NY-REPORTING-VOSR": { route: "New York DFS VOSR portal", cadence: "Quarterly", due: after(30),
    review: "Confirm covered servicing activity, the current VOSR instructions and attestation with counsel." },
  "REQ-NY-REPORTING-SERVICER-QFS": { route: "New York DFS quarterly financial report", cadence: "Fiscal quarterly", due: after(45),
    review: "Confirm the servicing scope, DFS submission instructions and quarterly net worth certification." },
  "REQ-NY-REPORTING-SERVICER-AUD": { route: "New York DFS audited financial statement", cadence: "Fiscal annual", due: after(90),
    review: "Confirm the fiscal year end, audited statements, submission channel and any DFS-approved substitution." },
  "REQ-NY-REPORTING-QRES": { route: "Mail to New York DFS Mortgage Banking", cadence: "Quarterly", due: after(30), from: "2025-07-01",
    review: "Confirm reportable hires, separations, Temporary Authority, notarization and no-change instructions with counsel." },
  "REQ-CO-REPORTING-MCR": quarter("NMLS Mortgage Call Report", "Confirm registration, current FV7 components and applicable periods."),
  "REQ-CO-LICENSING-CO-RENEW": { route: "NMLS company registration renewal", cadence: "Calendar annual", due: through => through,
    review: "Confirm company registration, timely MCR filings, the current renewal instructions and renewed status." },
  "REQ-CO-REPORTING-STD-FC": { route: "NMLS Financial Condition", cadence: "Fiscal annual", due: () => null,
    review: "Reconcile Colorado's standard-section fiscal-year rule with current FV7 and confirm the filing basis with counsel." },
  "REQ-IL-REPORTING-ACTIVITY": quarter("NMLS Mortgage Call Report",
    "Verify timely, accurate MCR evidence before relying on the Illinois substitution for listed annual activity reports."),
  "REQ-IL-REPORTING-ANNUAL-AUDIT": { route: "Illinois IDFPR or applicable NMLS filing", cadence: "Fiscal annual", due: after(90),
    review: "The date reflects the IDFPR fiscal-year schedule. Confirm the applicable channel, NMLS instructions and any approved extension." },
  "REQ-IL-REPORTING-BROKER-COMP": { route: "Illinois IDFPR or applicable NMLS filing", cadence: "Fiscal annual", due: after(90),
    review: "Confirm that IDFPR accepts a compilation for this broker-only entity and verify the filing channel and applicable calendar." },
  "REQ-IL-REPORTING-ANNUAL-ACT": { route: "Illinois IDFPR annual activity report", cadence: "Calendar annual", due: () => null,
    review: "Confirm a separate return is required and verify the March 1 or applicable regulator-selected date." },
};

export function obligationReportingBasis(sourceKey: string | undefined, cadence: ObligationDraft["cadence"],
  annualStartMonth: number | undefined, period: { from: string; through: string }): z.infer<typeof reportingDateBasis> | undefined {
  const rule = sourceKey && filings[sourceKey];
  if (!rule) return undefined;
  const quarterly = cadence === "Quarterly";
  const annual = cadence === "Annual";
  const calendar = annual && (annualStartMonth ?? 1) === 1;
  const matches = rule.cadence === "Quarterly" ? quarterly : rule.cadence === "Calendar annual" ? calendar :
    rule.cadence === "Fiscal annual" ? annual && annualStartMonth !== undefined :
      rule.cadence === "Fiscal quarterly" ? cadence === "Fiscal quarterly" && annualStartMonth !== undefined : quarterly || calendar;
  return {
    route: rule.route,
    nominalDueOn: matches && (!rule.from || period.from >= rule.from) ? rule.due(period.through, cadence) : null,
    review: rule.review,
  };
}
