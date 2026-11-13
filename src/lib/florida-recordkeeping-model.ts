import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

export const floridaRecordkeepingSource = "https://www.flsenate.gov/Laws/Statutes/2026/0494.0016";
export const floridaBooksAndRecordsRule = "https://flrules.org/gateway/RuleNo.asp?ID=69V-40.170";
const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
const storageChange = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Original location"), reference }),
  z.strictObject({ status: z.literal("Location change"), effectiveOn: date, filing: event.optional() }),
]);
const productionClock = z.discriminatedUnion("request", [
  z.strictObject({ request: z.literal("Other request"), reference }),
  z.strictObject({ request: z.literal("Written OFR request"), deadline: event.optional() }),
]);
const recordGroup = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Unreviewed") }),
  z.strictObject({ status: z.literal("Not applicable"), reference }),
  z.strictObject({ status: z.literal("On file"), latestOriginalEntry: event }),
]);
export const floridaRecordGroups = {
  loanFile: "Loan file and disclosures",
  accounts: "Books and accounts",
  expenseReceipts: "Borrower expense receipts",
  closingStatements: "Signed closing statements",
  other: "Other Chapter 494 records",
} as const;

export const floridaRecordkeepingFacts = z.strictObject({
  entityId: z.uuid(), authority: z.enum(["Mortgage broker", "Mortgage lender", "Loan originator"]), authorityReference: reference,
  zone: z.enum(["America/New_York", "America/Chicago"]),
  inventory: reference.optional(),
  records: z.strictObject({
    loanFile: recordGroup, accounts: recordGroup, expenseReceipts: recordGroup, closingStatements: recordGroup, other: recordGroup,
  }),
  custody: z.discriminatedUnion("method", [
    z.strictObject({ method: z.literal("Unreviewed") }),
    z.strictObject({ method: z.literal("Licensed principal place"), location: reference, retrieval: event.optional() }),
    z.strictObject({ method: z.literal("OFR-authorized location"), location: reference, authorization: reference, retrieval: event.optional(), secureStorage: reference.optional(),
      locationChange: storageChange.optional() }),
  ]),
  examination: z.strictObject({
    notice: event, floridaLocation: reference, production: event.optional(), clock: productionClock.optional(),
  }).optional(),
}).superRefine(({ examination }, ctx) => {
  if (examination?.clock?.request === "Written OFR request" && examination.clock.deadline &&
      examination.clock.deadline.on < shiftReportDate(examination.notice.on, 3))
    ctx.addIssue({ code: "custom", path: ["examination", "clock"], message: "The third business day must be at least three calendar days after the written request." });
  if (examination?.production && examination.production.on < examination.notice.on)
    ctx.addIssue({ code: "custom", path: ["examination"], message: "Production cannot precede the examination request." });
});
export type FloridaRecordkeepingFacts = z.infer<typeof floridaRecordkeepingFacts>;

export const floridaRecordkeepingRequest = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("floridaRecordkeepingHistory"), loanId: z.string().min(1).max(200), before: z.int().positive().optional() }),
  z.strictObject({ type: z.literal("saveFloridaRecordkeeping"), loanId: z.string().min(1).max(200), expected: z.int().nonnegative(),
    requestId: z.uuid(), facts: floridaRecordkeepingFacts, correction: reference.optional() }),
]);
export type FloridaRecordkeepingRequest = z.infer<typeof floridaRecordkeepingRequest>;
const groups = Object.keys(floridaRecordGroups) as (keyof typeof floridaRecordGroups)[];

export function floridaRecordkeepingDates({ records, custody, examination }: FloridaRecordkeepingFacts) {
  return [...groups.map(key => {
    const record = records[key];
    return record.status === "On file" ? record.latestOriginalEntry.on : undefined;
  }), "retrieval" in custody ? custody.retrieval?.on : undefined, examination?.notice.on, examination?.production?.on,
    custody.method === "OFR-authorized location" && custody.locationChange?.status === "Location change"
      ? custody.locationChange.filing?.on : undefined];
}

export function reviewFloridaRecordkeeping(facts: FloridaRecordkeepingFacts, loan: { closed: boolean }, today: string) {
  const findings: { key: string; message: string; source: string }[] = [];
  const add = (key: string, message: string, source = floridaRecordkeepingSource) => findings.push({ key, message, source });
  if (!facts.inventory) add("inventory", "Reference the inventory and reconcile each record group's latest original entry.");
  if (facts.custody.method === "Unreviewed") add("custody", "Document the licensed principal location or OFR authorization for alternate custody.");
  else if (!facts.custody.retrieval) add("retrieval", "Document a retrieval check at the recorded location.");
  if (facts.examination && !facts.examination.production) add("examination", "Record production for the outstanding OFR request.");

  let amendmentDueOn: string | null = null;
  let productionDueOn: string | null = null;
  const { custody, examination } = facts;
  if (custody.method === "OFR-authorized location") {
    const addRule = (key: string, message: string) => add(key, message, floridaBooksAndRecordsRule);
    if (!custody.secureStorage) addRule("secureStorage", "Document secure storage and protection from damage at the alternate location.");
    if (facts.authority !== "Loan originator") {
      const change = custody.locationChange;
      if (!change) addRule("locationChange", "Confirm whether this is the original records location or a change.");
      if (change?.status === "Location change") {
        amendmentDueOn = shiftReportDate(change.effectiveOn, -30);
        if (!change.filing) addRule("amendment", today > amendmentDueOn
          ? "The MU1 advance filing date has passed. Record the NMLS filing evidence."
          : "Record the MU1 amendment filing with NMLS.");
        else if (change.filing.on > amendmentDueOn)
          addRule("lateAmendment", "The MU1 amendment was filed fewer than 30 days before the change.");
      }
    }
    if (examination) {
      if (!examination.clock) addRule("requestType", "Confirm whether the OFR request was in writing.");
      if (examination.clock?.request === "Written OFR request") {
        productionDueOn = examination.clock.deadline?.on ?? null;
        if (!productionDueOn) addRule("productionCalendar", "Record the third business day after the written OFR request and the calendar evidence.");
        else if (examination.production && examination.production.on > productionDueOn)
          addRule("lateProduction", "Records were produced after the documented third business day.");
        else if (!examination.production && today > productionDueOn)
          addRule("overdueProduction", "The documented OFR production deadline has passed.");
      }
    }
  }

  const recordDates = groups.map(key => {
    const record = facts.records[key];
    const label = floridaRecordGroups[key];
    if (record.status === "Unreviewed") add(key, "Review " + label + ".");
    if (key === "closingStatements" && loan.closed && record.status === "Not applicable")
      add(key, "Reconcile the signed closing statement with the recorded closed loan.");
    if (key === "loanFile" && record.status === "Not applicable") add(key, "Reconcile the loan file with the recorded transaction.");
    if (record.status !== "On file") return { key, originalEntryOn: null, reviewOn: null };
    const originalEntryOn = record.latestOriginalEntry.on;
    const anniversary = (Number(originalEntryOn.slice(0, 4)) + 3) + originalEntryOn.slice(4);
    const parsed = date.safeParse(anniversary);
    if (!parsed.success) add(key, "Confirm the three-year anniversary for " + label + ".");
    return { key, originalEntryOn, reviewOn: parsed.success ? parsed.data : null };
  });
  const hasUnresolvedDates = groups.some(key => facts.records[key].status === "Unreviewed") ||
    recordDates.some(record => record.originalEntryOn && !record.reviewOn) ||
    facts.records.loanFile.status !== "On file" || (loan.closed && facts.records.closingStatements.status !== "On file");
  const dates = recordDates.flatMap(record => record.reviewOn ? [record.reviewOn] : []);
  const stateReviewDate = hasUnresolvedDates ? null : dates.sort().at(-1) ?? null;
  return { findings, recordDates, stateReviewDate, amendmentDueOn, productionDueOn };
}
