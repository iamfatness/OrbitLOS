import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

export const texasLogSources = {
  rules: "https://www.sml.texas.gov/mortgage-origination/laws/",
  origination: "https://www.sml.texas.gov/wp-content/uploads/2026/02/mortgage-compliance-guide-v12.pdf",
  processing: "https://www.sml.texas.gov/news/announcement-new-required-loan-processing-and-underwriting-log/",
};
export const texasLogTypes = ["Origination", "Third-party processing or underwriting"] as const;
export const texasLogDispositions = ["Unresolved", "In process", "Withdrawn", "Denied", "Cancelled", "Closed", "Other"] as const;
export const texasLogZones = ["America/Chicago", "America/Denver"] as const;
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const text = (max: number) => z.string().trim().min(1).max(max);
const reference = text(240).min(4);
const nmls = z.string().trim().regex(/^\d{1,15}$/);
const party = z.strictObject({ name: text(160), nmls: nmls.optional() });
const money = z.int().nonnegative().max(100_000_000_000);
const common = {
  fileNumber: text(100), lenderFileNumber: text(100).optional(),
  applicants: z.array(z.strictObject({ last: text(100), first: text(100) })).max(12),
  property: z.strictObject({ street: text(160), city: text(100), state: z.string().regex(/^[A-Z]{2}$/), zip: z.string().regex(/^\d{5}(-\d{4})?$/) }).optional(),
  occupancy: text(120).optional(), disposition: z.enum(texasLogDispositions),
  dispositionDetails: text(200).optional(), closedOn: date.optional(),
  entryEventOn: date, evidence: reference, zone: z.enum(texasLogZones),
};
export const texasLogFacts = z.discriminatedUnion("log", [
  z.strictObject({ ...common, log: z.literal("Origination"), applicationOn: date.optional(),
    interestRate: z.number().min(0).max(100).optional(), purpose: text(120).optional(), product: text(120).optional(),
    fundingLender: party.optional(), lenderNmlsException: reference.optional(), initialOriginator: party.optional(), lien: text(120).optional() }),
  z.strictObject({ ...common, log: z.literal("Third-party processing or underwriting"), serviceStartedOn: date.optional(),
    clientFileNumber: text(100).optional(), client: party.optional(),
    workers: z.array(party.extend({ employment: text(100).optional() })).max(30),
    fees: z.strictObject({ invoiced: money.optional(), assessed: money.optional(), charged: money.optional(),
      collected: money.optional(), paid: money.optional(), reference }).optional(),
    closingDisclosureFee: z.enum(["Unresolved", "On CD", "Not on CD", "No closing disclosure"]),
    closingDisclosureReference: reference.optional() }),
]).superRefine((facts, ctx) => {
  const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
  const first = texasLogStart(facts);
  if (first && facts.entryEventOn < first) issue("entryEventOn", "The recorded event cannot precede the first application or service event.");
  if (first && facts.closedOn && facts.closedOn < first) issue("closedOn", "Closing cannot precede the first application or service event.");
  if (facts.closedOn && facts.disposition !== "Closed") issue("closedOn", "Record the closed disposition for a completed closing.");
});
export type TexasLogFacts = z.infer<typeof texasLogFacts>;
export const texasLogStart = (facts: TexasLogFacts) => facts.log === "Origination" ? facts.applicationOn : facts.serviceStartedOn;

export function texasLogGaps(facts: TexasLogFacts) {
  const gaps: string[] = [];
  const start = texasLogStart(facts);
  if (start && start < (facts.log === "Origination" ? "2024-11-23" : "2025-01-01"))
    gaps.push("Review the earlier rule or transition with counsel");
  if (!start) gaps.push(facts.log === "Origination" ? "Initial application date" : "Service start date for examination scope");
  if (!facts.applicants.length) gaps.push("Applicant names");
  if (!facts.property) gaps.push("Subject property address");
  if (!facts.occupancy) gaps.push("Intended occupancy");
  if (facts.disposition === "Unresolved" || (facts.disposition === "Other" && !facts.dispositionDetails)) gaps.push("Current status or disposition");
  if (facts.disposition === "Closed" && !facts.closedOn) gaps.push("Closing date");
  if (facts.log === "Origination") {
    if (facts.interestRate === undefined) gaps.push("Interest rate");
    if (!facts.purpose) gaps.push("Loan purpose");
    if (!facts.product) gaps.push("Loan product");
    if (!facts.initialOriginator?.nmls) gaps.push("Initial originator name and NMLS ID");
    if (!facts.lien) gaps.push("Lien position");
    if (facts.disposition === "Closed" && (!facts.fundingLender || (!facts.fundingLender.nmls && !facts.lenderNmlsException)))
      gaps.push("Initial funding lender and applicable NMLS ID");
  } else {
    if (!facts.client?.nmls) gaps.push("Client company or banker name and NMLS ID");
    if (!facts.workers.length || facts.workers.some(worker => !worker.nmls || !worker.employment))
      gaps.push("Each processor or underwriter name, NMLS ID and employment status");
    if (!facts.fees || [facts.fees.invoiced, facts.fees.assessed, facts.fees.charged, facts.fees.collected, facts.fees.paid].every(amount => amount === undefined))
      gaps.push("Applicable fee amounts, including a documented zero");
    if (facts.closingDisclosureFee === "Unresolved" || !facts.closingDisclosureReference)
      gaps.push("Direct fee on Closing Disclosure or documented explanation");
  }
  return gaps;
}

export function texasLogTiming(facts: TexasLogFacts, savedOn: string, originalSavedOn: string) {
  const start = texasLogStart(facts);
  const initialDue = start ? shiftReportDate(start, 7) : null;
  const due = shiftReportDate(facts.entryEventOn, 7);
  return { due, late: savedOn > due, initialDue, initialLate: initialDue === null ? null : originalSavedOn > initialDue };
}

export const texasLoanLogRequest = z.strictObject({
  type: z.literal("texasLoanLog"), entityId: z.uuid(),
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), from: date, through: date, log: z.enum(["All", ...texasLogTypes]),
      search: z.string().trim().max(120), offset: z.int().nonnegative().max(10000) }),
    z.strictObject({ operation: z.literal("history"), entryId: z.uuid(), before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), entryId: z.uuid(), requestId: z.uuid(), expected: z.int().nonnegative(),
      authority: z.enum(["Mortgage company", "Mortgage banker"]), facts: texasLogFacts, correction: reference.optional() }),
    z.strictObject({ operation: z.literal("void"), entryId: z.uuid(), requestId: z.uuid(), expected: z.int().positive(), correction: reference }),
    z.strictObject({ operation: z.literal("export"), from: date, through: date }),
  ]),
});
export type TexasLoanLogRequest = z.infer<typeof texasLoanLogRequest>;
