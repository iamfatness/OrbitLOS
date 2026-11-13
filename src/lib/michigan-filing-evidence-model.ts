import { z } from "zod";
import type { ObligationDraft } from "./compliance-obligations-model";

const reference = z.string().trim().min(5).max(1500);
const receipt = z.strictObject({ on: z.iso.date(), reference });
const amendment = receipt.extend({ reason: reference });

export function michiganFilingComponent(source: string, draft: Pick<ObligationDraft, "cadence" | "annualStartMonth">) {
  if (source === "REQ-MI-REPORTING-RMLA" && draft.cadence === "Quarterly") return "Residential Mortgage Loan Activity";
  if (source === "REQ-MI-REPORTING-FC" && (draft.cadence === "Quarterly" ||
    (draft.cadence === "Annual" && (draft.annualStartMonth ?? 1) === 1))) return "Financial Condition";
  if (source === "REQ-MI-REPORTING-GAAP" && draft.cadence === "Annual" && draft.annualStartMonth !== undefined)
    return "Fiscal-year financial statement";
  return null;
}

export const michiganFilingEvidence = z.strictObject({
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

export function reviewMichiganFiling(evidence: MichiganFilingEvidence, nominalDueOn: string | null, asOf: string,
  component: ReturnType<typeof michiganFilingComponent>, periodEnd: string) {
  const dueOn = evidence.deadline?.on ?? nominalDueOn;
  const gaps: string[] = [];
  if (!evidence.deadline) gaps.push("Verify the component and deadline against the current filing instructions.");
  if (!evidence.reconciliation) gaps.push("Record the reconciliation to the filed report or financial statement.");
  if (component === "Residential Mortgage Loan Activity" && !evidence.reconciliation?.activity)
    gaps.push("Record the period activity or documented no-activity determination.");
  if (!evidence.submission) gaps.push("Record the original NMLS submission receipt.");
  if (evidence.submission && dueOn && evidence.submission.on > dueOn) gaps.push("Review the late submission.");
  const amendments = michiganFilingAmendments(evidence);
  if (component === "Residential Mortgage Loan Activity" || component === "Financial Condition") {
    const cutoff = String(Number(periodEnd.slice(0, 4)) + 2) + periodEnd.slice(4);
    if (amendments.some(item => item.on > cutoff))
      gaps.push("Verify amendment evidence after the published two-year NMLS filing window.");
  }
  const summary = !dueOn ? "Filing date needs review" :
    evidence.submission ? (evidence.submission.on <= dueOn ? "Receipt by recorded date" : "Receipt after recorded date") :
      asOf > dueOn ? "Recorded date passed without receipt" : "Awaiting filing receipt";
  return { asOf, dueOn, summary, gaps };
}
