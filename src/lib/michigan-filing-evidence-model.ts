import { z } from "zod";
import type { ObligationDraft } from "./compliance-obligations-model";

const reference = z.string().trim().min(5).max(1500);
const receipt = z.strictObject({ on: z.iso.date(), reference });
const amendment = receipt.extend({ reason: reference });

const quarterlyActivitySources = new Set([
  "REQ-MI-REPORTING-RMLA", "REQ-CA-REPORTING-DRE-MCR", "REQ-CA-REPORTING-CFL-MCR", "REQ-CA-REPORTING-CRMLA-MCR",
  "REQ-FL-REPORTING-MCR", "REQ-TX-REPORTING-MCR", "REQ-NY-REPORTING-MCR", "REQ-CO-REPORTING-MCR",
  "REQ-IL-REPORTING-ACTIVITY",
]);
const calendarAnnualConditionSources = new Set([
  "REQ-MI-REPORTING-FC", "REQ-CA-REPORTING-DRE-FC", "REQ-CA-REPORTING-CFL-FC", "REQ-FL-REPORTING-BROKER-FC",
  "REQ-TX-REPORTING-FC",
]);
const quarterlyConditionSources = new Set([
  "REQ-MI-REPORTING-FC", "REQ-CA-REPORTING-DRE-FC", "REQ-CA-REPORTING-CFL-FC", "REQ-CA-REPORTING-CRMLA-FC",
  "REQ-FL-REPORTING-LENDER-FC", "REQ-TX-REPORTING-FC", "REQ-CO-REPORTING-QUARTER-FC",
]);

export function nmlsFilingComponent(source: string, draft: Pick<ObligationDraft, "cadence" | "annualStartMonth">, periodStart: string) {
  if (!source.startsWith("REQ-MI-") && periodStart < "2026-01-01") return null;
  const { cadence, annualStartMonth } = draft;
  if (cadence === "Quarterly" && quarterlyActivitySources.has(source)) return "Residential Mortgage Loan Activity";
  if (cadence === "Quarterly" && quarterlyConditionSources.has(source)) return "Financial Condition";
  if (cadence === "Annual" && (annualStartMonth ?? 1) === 1 && calendarAnnualConditionSources.has(source))
    return "Financial Condition";
  if (source === "REQ-CO-REPORTING-STD-FC" && cadence === "Annual" && annualStartMonth !== undefined) return "Financial Condition";
  if (source === "REQ-TX-REPORTING-SSSF" && cadence === "Quarterly") return "State-Specific Supplemental Form";
  if (source === "REQ-MI-REPORTING-GAAP" && draft.cadence === "Annual" && draft.annualStartMonth !== undefined)
    return "Fiscal-year financial statement";
  return null;
}

export function nmlsFilingDate(now: string, timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export function californiaAnnualFilingComponent(source: string, draft: Pick<ObligationDraft, "cadence" | "annualStartMonth">, periodStart: string) {
  if (draft.cadence !== "Annual" || (draft.annualStartMonth ?? 1) !== 1 || periodStart < "2025-01-01") return null;
  if (source === "REQ-CA-REPORTING-CFLANNUAL") return "California Financing Law annual report";
  if (source === "REQ-CA-REPORTING-CRMLA-ANNUAL") return "California CRMLA annual report";
  return null;
}

export function filingEvidenceComponent(source: string, draft: Pick<ObligationDraft, "cadence" | "annualStartMonth">, periodStart: string) {
  if (source === "FED-HMDA-ANNUAL" && draft.cadence === "Annual" && (draft.annualStartMonth ?? 1) === 1)
    return "HMDA annual filing";
  if (source === "FED-HMDA-QUARTERLY" && draft.cadence === "Quarterly" && /-(01|04|07)-01$/.test(periodStart))
    return "HMDA quarterly filing";
  return californiaAnnualFilingComponent(source, draft, periodStart) ?? nmlsFilingComponent(source, draft, periodStart);
}

export const michiganStatementFormats = [
  "DIFS-prescribed form", "Substantially similar report", "Independent CPA-certified statement",
] as const;

export const michiganFilingEvidence = z.strictObject({
  michiganStatement: z.strictObject({ format: z.enum(michiganStatementFormats), reference }).optional(),
  deadline: receipt.optional(),
  reconciliation: z.strictObject({ reference, activity: z.enum(["Activity recorded", "No reportable activity"]).optional() }).optional(),
  submission: receipt.optional(),
  amendment: amendment.optional(),
  amendments: z.array(amendment).min(1).max(30).optional(),
}).refine(value => Object.values(value).some(Boolean), "Record at least one piece of filing evidence.")
  .refine(value => !(value.amendment && value.amendments), "Use one amendment history.");
export type MichiganFilingEvidence = z.infer<typeof michiganFilingEvidence>;
export const michiganFilingAmendments = (evidence: MichiganFilingEvidence) =>
  evidence.amendments ?? (evidence.amendment ? [evidence.amendment] : []);

export function reviewNmlsFiling(evidence: MichiganFilingEvidence, nominalDueOn: string | null, asOf: string,
  component: ReturnType<typeof filingEvidenceComponent>, periodEnd: string, basisChanged = false) {
  const hmda = component === "HMDA annual filing" || component === "HMDA quarterly filing";
  const stateFiling = component === "California Financing Law annual report" || component === "California CRMLA annual report";
  const dueOn = basisChanged ? null : evidence.deadline?.on ?? nominalDueOn;
  const gaps: string[] = [];
  if (component === "Fiscal-year financial statement" && !evidence.michiganStatement)
    gaps.push("Record the annual financial statement format and supporting reference.");
  if (!evidence.deadline || basisChanged) gaps.push("Verify the component and deadline against the current filing instructions.");
  if (!evidence.reconciliation) gaps.push("Record the reconciliation to the filed report or financial statement.");
  if (component === "Residential Mortgage Loan Activity" && !evidence.reconciliation?.activity)
    gaps.push("Record the period activity or documented no-activity determination.");
  if (!evidence.submission) gaps.push(stateFiling ? "Record the original state filing confirmation." :
    hmda ? "Record the original HMDA submission confirmation." : "Record the original NMLS submission receipt.");
  if (evidence.submission && dueOn && evidence.submission.on > dueOn) gaps.push("Review the late submission.");
  const amendments = michiganFilingAmendments(evidence);
  if (component && !stateFiling && !hmda && component !== "Fiscal-year financial statement") {
    const cutoff = String(Number(periodEnd.slice(0, 4)) + 2) + periodEnd.slice(4);
    if (amendments.some(item => item.on > cutoff))
      gaps.push("Verify amendment evidence after the published two-year NMLS filing window.");
  }
  const summary = basisChanged ? "Filing timing needs review" : !dueOn ? "Filing date needs review" :
    evidence.submission ? (evidence.submission.on <= dueOn ? "Receipt by recorded date" : "Receipt after recorded date") :
      asOf > dueOn ? "Recorded date passed without receipt" : "Awaiting filing receipt";
  return { asOf, dueOn, summary, gaps };
}
