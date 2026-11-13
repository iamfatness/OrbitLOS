import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

export const californiaDfpiSources = {
  cfl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=FIN&sectionNum=22157.",
  cflRecords: "https://dfpi.ca.gov/wp-content/uploads/sites/337/2021/08/PRO-02-17-Final-Text-of-Rules.pdf",
  crmla: "https://govt.westlaw.com/calregs/Document/IB7AE89595C2F11EC9C68000D3A7C4BC3",
} as const;

const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
const checked = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Unreviewed") }),
  z.strictObject({ status: z.enum(["On file", "Not applicable"]), reference }),
]);

const common = {
  entityId: z.uuid(), authorityReference: reference,
  finalEntry: event.optional(), inventory: reference.optional(),
};

export const californiaDfpiFacts = z.discriminatedUnion("authority", [
  z.strictObject({ ...common, authority: z.literal("CFL"), role: z.enum(["Broker", "Lender"]),
    custody: z.discriminatedUnion("method", [
      z.strictObject({ method: z.literal("Unreviewed") }),
      z.strictObject({ method: z.enum(["Physical at licensed office", "Digital access from licensed office"]),
        office: reference, retrieval: event.optional() }),
      z.strictObject({ method: z.literal("Other authorized custody"), approval: reference, retrieval: event.optional() }),
    ]),
    disclosure: checked, securityInstrument: checked, note: checked, application: checked,
    paymentRecord: checked, escrow: checked, insurance: checked,
  }),
  z.strictObject({ ...common, authority: z.literal("CRMLA"), role: z.enum(["Lender", "Lender and servicer", "Servicer"]),
    loanLog: reference.optional(), application: checked, commitment: checked, truthInLending: checked,
    closingStatement: checked, noteAndDeed: checked, adverseAction: checked, appraisal: checked, creditReport: checked,
    balance: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("Unreviewed") }),
      z.strictObject({ status: z.enum(["Balance remains", "No balance", "Not applicable"]), reference }),
    ]),
    production: z.strictObject({ notice: event, produced: event.optional() }).optional(),
  }),
]);
export type CaliforniaDfpiFacts = z.infer<typeof californiaDfpiFacts>;

export const californiaDfpiRequest = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("californiaDfpiHistory"), authority: z.enum(["CFL", "CRMLA"]), loanId: z.string().min(1).max(200), before: z.int().positive().optional() }),
  z.strictObject({ type: z.literal("saveCaliforniaDfpi"), loanId: z.string().min(1).max(200), expected: z.int().nonnegative(),
    requestId: z.uuid(), facts: californiaDfpiFacts, correction: reference.optional() }),
]);
export type CaliforniaDfpiRequest = z.infer<typeof californiaDfpiRequest>;

export function californiaDfpiDates(facts: CaliforniaDfpiFacts) {
  return [facts.finalEntry?.on, ...(facts.authority === "CFL" ? ["retrieval" in facts.custody ? facts.custody.retrieval?.on : undefined] :
    [facts.production?.notice.on, facts.production?.produced?.on])];
}

export const cflDocuments = {
  disclosure: "Loan disclosure", securityInstrument: "Security instrument", note: "Promissory note", application: "Application",
  paymentRecord: "Payment record", escrow: "Escrow closing evidence", insurance: "Applicable insurance records",
} as const;
export const crmlaDocuments = {
  application: "Application", commitment: "Commitment", truthInLending: "Truth-in-Lending disclosure", closingStatement: "Closing statement",
  noteAndDeed: "Note and deed of trust", adverseAction: "Adverse-action or rejection evidence", appraisal: "Appraisal", creditReport: "Credit report",
} as const;

export function reviewCaliforniaDfpi(facts: CaliforniaDfpiFacts, today: string) {
  const findings: { key: string; message: string; source: string }[] = [];
  const source = facts.authority === "CFL" ? californiaDfpiSources.cfl : californiaDfpiSources.crmla;
  const add = (key: string, message: string, authority: string = source) => findings.push({ key, message, source: authority });
  if (!facts.finalEntry) add("finalEntry", "Document the final entry date and its source.");
  if (!facts.inventory) add("inventory", "Reference the retained file inventory.");
  const anniversary = facts.finalEntry && (Number(facts.finalEntry.on.slice(0, 4)) + 3) + facts.finalEntry.on.slice(4);
  const parsed = date.safeParse(anniversary);
  if (facts.finalEntry && !parsed.success) add("anniversary", "Confirm the retention anniversary for this final entry.");

  let productionDue: string | null = null;
  let productionStatus: "Awaiting production" | "Overdue" | "Produced on time" | "Produced late" | null = null;
  if (facts.authority === "CFL") {
    if (facts.custody.method === "Unreviewed") add("custody", "Identify the licensed office access or documented alternative.", californiaDfpiSources.cflRecords);
    else if (!facts.custody.retrieval) add("retrieval", "Document a retrieval check for the recorded location.", californiaDfpiSources.cflRecords);
    for (const key of Object.keys(cflDocuments) as (keyof typeof cflDocuments)[]) {
      if (facts[key].status === "Unreviewed") add(key, "Review " + cflDocuments[key] + ".", californiaDfpiSources.cflRecords);
    }
  } else {
    if (!facts.loanLog) add("loanLog", "Reference the current 36-month loan log or equivalent examination report.");
    if (facts.balance.status === "Unreviewed") add("balance", "Reconcile whether a loan balance remains.");
    if (facts.balance.status === "Balance remains") add("activeBalance", "Continue retaining the outstanding-balance ledger and file.");
    for (const key of Object.keys(crmlaDocuments) as (keyof typeof crmlaDocuments)[]) {
      if (facts[key].status === "Unreviewed") add(key, "Review " + crmlaDocuments[key] + ".");
    }
    if (facts.production) {
      productionDue = shiftReportDate(facts.production.notice.on, 10);
      productionStatus = facts.production.produced ? facts.production.produced.on > productionDue ? "Produced late" : "Produced on time" :
        today > productionDue ? "Overdue" : "Awaiting production";
      if (productionStatus === "Produced late" || productionStatus === "Overdue")
        add("production", "Review the missed ten-calendar-day examination access deadline.");
    }
  }
  return { findings, stateReviewDate: parsed.success ? parsed.data : null, productionDue, productionStatus };
}
