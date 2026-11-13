import { z } from "zod";

export const texasRecordkeepingSources = {
  rules: "https://www.fc.texas.gov/sites/default/files/2024-10/10252024-FC-Packet.pdf",
  guide: "https://www.sml.texas.gov/wp-content/uploads/2026/02/mortgage-compliance-guide-v12.pdf",
};
export const texasRecordGroups = {
  application: "Signed applications and evaluation records",
  disclosures: "State and federal disclosures and delivery evidence",
  communications: "Correspondence, agreements and notes",
  creditAndFees: "Credit, valuation, fees and refund records",
  settlement: "Settlement and executed closing documents",
  lender: "Lender note, security instrument and supporting records",
  adverseOutcome: "Incompleteness, counteroffer or adverse-action evidence",
  homeEquity: "Texas home equity and HELOC evidence",
  other: "Other applicable transaction records",
} as const;

const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
const group = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("On file"), reference }),
  z.strictObject({ status: z.literal("Not applicable"), reference }),
]);
export const texasRecordkeepingFacts = z.strictObject({
  entityId: z.uuid(),
  authority: z.enum(["SML mortgage company", "SML mortgage banker"]),
  authorityReference: reference,
  zone: z.enum(["America/Chicago", "America/Denver"]),
  role: z.enum(["Unreviewed", "Brokered", "Made the loan"]),
  application: event.optional(),
  inventory: reference.optional(),
  records: z.strictObject({
    application: group.optional(), disclosures: group.optional(), communications: group.optional(), creditAndFees: group.optional(),
    settlement: group.optional(), lender: group.optional(), adverseOutcome: group.optional(), homeEquity: group.optional(), other: group.optional(),
  }),
  lenderCopies: event.optional(),
  archive: z.strictObject({
    location: z.enum(["Main office", "NMLS MU1 designated location"]), reference, retrieval: event.optional(),
  }).optional(),
  retentionBasis: event.optional(),
  examination: z.strictObject({ notice: event, production: event.optional() }).optional(),
}).superRefine(({ examination }, ctx) => {
  if (examination?.production && examination.production.on < examination.notice.on)
    ctx.addIssue({ code: "custom", path: ["examination"], message: "Production cannot precede the examination request." });
});
export type TexasRecordkeepingFacts = z.infer<typeof texasRecordkeepingFacts>;

export const texasRecordkeepingRequest = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("texasRecordkeepingHistory"), loanId: z.string().min(1).max(200), before: z.int().positive().optional() }),
  z.strictObject({ type: z.literal("saveTexasRecordkeeping"), loanId: z.string().min(1).max(200), expected: z.int().nonnegative(),
    requestId: z.uuid(), facts: texasRecordkeepingFacts, correction: reference.optional() }),
]);
export type TexasRecordkeepingRequest = z.infer<typeof texasRecordkeepingRequest>;

export function texasRecordkeepingDates(facts: TexasRecordkeepingFacts) {
  return [facts.application?.on, facts.lenderCopies?.on, facts.archive?.retrieval?.on, facts.retentionBasis?.on,
    facts.examination?.notice.on, facts.examination?.production?.on];
}

export function reviewTexasRecordkeeping(facts: TexasRecordkeepingFacts, loan: { closed: boolean; closingOn: string | null; dispositionOn: string | null }) {
  const findings: { key: string; message: string; source: string }[] = [];
  const add = (key: string, message: string, source = texasRecordkeepingSources.rules) => findings.push({ key, message, source });
  if (!facts.application) add("ruleEdition", "Record the initial application date to identify the rule edition.");
  else if (facts.application.on < "2024-11-23") add("ruleEdition", "Review the Texas rules in effect before November 23, 2024.");
  if (facts.role === "Unreviewed") add("role", "Confirm the entity's role in this transaction.");
  if (!facts.inventory) add("inventory", "Reference the inventory of applicable documents and reconcile it against the archived file.");
  for (const [key, label] of Object.entries(texasRecordGroups) as [keyof typeof texasRecordGroups, string][]) {
    const record = facts.records[key];
    const required = key === "application" || (loan.closed && key === "settlement") ||
      (loan.closed && facts.role === "Made the loan" && key === "lender");
    if (!record || (required && record.status !== "On file")) add(key, "Review " + label.toLowerCase() + ".");
  }
  if (loan.closed && facts.role === "Brokered") {
    if (!facts.lenderCopies) add("lenderCopies", "Document retrieval of the lender's executed copies.", texasRecordkeepingSources.guide);
    else if (!loan.closingOn || facts.lenderCopies.on < loan.closingOn)
      add("lenderCopies", "Reconcile the lender copies with the recorded closing and retrieval dates.", texasRecordkeepingSources.guide);
    else if (facts.lenderCopies.on > loan.closingOn)
      add("lenderCopiesTiming", "Review whether executed lender copies were retrieved promptly after closing.", texasRecordkeepingSources.guide);
  }
  if (!facts.archive?.retrieval) add("archive", "Document the main office or MU1-designated custody location and a retrieval check.");
  if (facts.examination && !facts.examination.production) add("examination", "Record production for the outstanding SML request.");
  const start = facts.retentionBasis?.on;
  if (!start) add("retentionBasis", "Record the reviewed retention start and its basis.");
  else if ([facts.application?.on, loan.closingOn, loan.dispositionOn].some(on => on && start < on))
    add("retentionBasis", "Reconcile the retention start with the recorded application and loan outcome dates.");
  const anniversary = start ? date.safeParse((Number(start.slice(0, 4)) + 3) + start.slice(4)) : null;
  if (start && !anniversary?.success) add("retentionBasis", "Confirm the three-year anniversary of the documented retention start.");
  const stateReviewDate = anniversary?.success && !findings.some(item => item.key === "retentionBasis" || item.key === "ruleEdition")
    ? anniversary.data : null;
  return { findings, stateReviewDate };
}
