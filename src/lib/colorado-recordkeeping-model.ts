import { z } from "zod";

export const coloradoRecordsSources = {
  rule: "https://www.sos.state.co.us/CCR/GenerateRulePdf.do?fileName=4+CCR+725-3&ruleVersionId=9222",
  manual: "https://dre.colorado.gov/sites/dre/files/documents/2025%20Colorado%20Real%20Estate%20Manual-Chapter%2009.pdf",
};
const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
const timestamp = z.string().trim().pipe(z.iso.datetime({ offset: true }));
const mountainDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
});
export const coloradoLocalDate = (at: string) => mountainDate.format(new Date(at));
const deadlineEvent = event.extend({ at: timestamp.optional() });
const document = z.strictObject({ status: z.enum(["On file", "Not applicable"]), reference });
export const coloradoDocuments = {
  application: "Residential loan application",
  disclosures: "State and federal disclosures",
  assets: "Asset statements",
  income: "Income documentation",
  employment: "Employment verification",
  deposits: "Deposit verification",
  lenderSubmission: "Lender submission",
  companyMarketing: "Company advertising and solicitation",
  originatorMarketing: "Originator advertising and solicitation",
  settlement: "Settlement statements",
  underwriting: "Underwriting summary",
  credit: "Credit report",
} as const;

export const coloradoRecordkeepingFacts = z.strictObject({
  entityId: z.uuid(), scopeReference: reference,
  inventory: reference.optional(),
  documents: z.strictObject({
    application: document.optional(), disclosures: document.optional(), assets: document.optional(), income: document.optional(),
    employment: document.optional(), deposits: document.optional(), lenderSubmission: document.optional(),
    companyMarketing: document.optional(), originatorMarketing: document.optional(), settlement: document.optional(),
    underwriting: document.optional(), credit: document.optional(),
  }),
  archive: z.strictObject({ medium: z.enum(["Paper", "Electronic", "Paper and electronic"]), location: reference,
    securityReference: reference.optional(), retrieval: event.optional() }).optional(),
  retentionBasis: event.optional(),
  investigation: z.strictObject({
    notice: event, dueOn: date, dueAt: timestamp.optional(),
    extension: z.strictObject({ requested: deadlineEvent, approval: event.extend({ dueOn: date, dueAt: timestamp.optional() }).optional() }).optional(),
    response: deadlineEvent.extend({ allegations: reference.optional(), questions: reference.optional(), documents: reference.optional() }).optional(),
  }).optional(),
}).superRefine(({ investigation }, ctx) => {
  if (!investigation) return;
  const { notice, dueOn, dueAt, extension, response } = investigation;
  const approval = extension?.approval;
  const timestamps = [
    [dueOn, dueAt], [approval?.dueOn, approval?.dueAt],
    [extension?.requested.on, extension?.requested.at], [response?.on, response?.at],
  ];
  if (timestamps.some(([on, at]) => at && (!Number.isFinite(Date.parse(at)) || coloradoLocalDate(at) !== on)))
    ctx.addIssue({ code: "custom", path: ["investigation"], message: "Each timestamp must match the recorded Mountain Time date." });
  if (approval?.dueOn === dueOn && dueAt && approval.dueAt && Date.parse(approval.dueAt) < Date.parse(dueAt))
    ctx.addIssue({ code: "custom", path: ["investigation"], message: "The approved extension cannot shorten the original cutoff." });
  if (dueOn < notice.on || (response && response.on < notice.on) || (extension && extension.requested.on < notice.on) ||
    (extension?.approval && (extension.approval.on < extension.requested.on || extension.approval.dueOn < dueOn ||
      extension.approval.dueOn < extension.approval.on)))
    ctx.addIssue({ code: "custom", path: ["investigation"], message: "Reconcile the notice, extension and response dates." });
});

export type ColoradoRecordkeepingFacts = z.infer<typeof coloradoRecordkeepingFacts>;

export const coloradoRecordkeepingRequest = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("coloradoRecordkeepingHistory"), loanId: z.string().min(1).max(200), before: z.int().positive().optional() }),
  z.strictObject({ type: z.literal("saveColoradoRecordkeeping"), loanId: z.string().min(1).max(200), expected: z.int().nonnegative(),
    requestId: z.uuid(), facts: coloradoRecordkeepingFacts, correction: reference.optional() }),
]);
export type ColoradoRecordkeepingRequest = z.infer<typeof coloradoRecordkeepingRequest>;

export function coloradoRecordkeepingDates(facts: ColoradoRecordkeepingFacts) {
  const request = facts.investigation;
  return [facts.archive?.retrieval?.on, facts.retentionBasis?.on, request?.notice.on, request?.extension?.requested.on,
    request?.extension?.approval?.on, request?.response?.on];
}

export function coloradoInvestigationEventTimes(facts: ColoradoRecordkeepingFacts) {
  return [facts.investigation?.extension?.requested.at, facts.investigation?.response?.at];
}

export function reviewColoradoRecordkeeping(facts: ColoradoRecordkeepingFacts, now: string) {
  const today = coloradoLocalDate(now);
  const findings: { key: string; message: string; source: string }[] = [];
  const add = (key: string, message: string) => findings.push({ key, message, source: coloradoRecordsSources.rule });
  if (!facts.inventory) add("inventory", "Reference the inventory of collected, supplied and marketing records.");
  for (const key of Object.keys(coloradoDocuments) as (keyof typeof coloradoDocuments)[]) {
    if (!facts.documents[key]) add(key, "Review " + coloradoDocuments[key] + ".");
  }
  if (!facts.archive) add("archive", "Record the archive location and medium.");
  else {
    if (!facts.archive.securityReference) add("security", "Document secure custody of the file.");
    if (!facts.archive.retrieval) add("retrieval", "Document a file retrieval check.");
  }
  const basis = facts.retentionBasis;
  const anniversary = date.safeParse(basis && (Number(basis.on.slice(0, 4)) + 4) + basis.on.slice(4));
  if (!basis) add("basis", "Confirm the retention start and supporting evidence.");
  else if (!anniversary.success) add("anniversary", "Confirm the four-year anniversary for the recorded date.");
  const request = facts.investigation;
  const extension = request?.extension;
  const dueOn = extension?.approval?.dueOn ?? request?.dueOn ?? null;
  const dueAt = (extension?.approval ? extension.approval.dueAt : request?.dueAt) ?? null;
  let responseStatus: "Awaiting response" | "Overdue" | "Responded on time" | "Responded late" | "Verify cutoff" | null = null;
  if (request && dueOn) {
    const receipt = extension?.requested;
    if (receipt && (receipt.on > request.dueOn || (receipt.at && request.dueAt && Date.parse(receipt.at) >= Date.parse(request.dueAt))))
      add("extension", "Review the extension request received at or after the original deadline.");
    else if (receipt?.on === request.dueOn && (!receipt.at || !request.dueAt))
      add("extensionTime", "Confirm receipt of the extension request before the notice deadline.");
    const response = request.response;
    if (response?.on === dueOn && (!response.at || !dueAt)) {
      responseStatus = "Verify cutoff";
      add("responseCutoff", "Confirm the Board cutoff and submission time for the same-day response.");
    } else if (response) {
      const late = dueAt && response.at ? Date.parse(response.at) > Date.parse(dueAt) : response.on > dueOn;
      responseStatus = late ? "Responded late" : "Responded on time";
    } else {
      const late = dueAt ? Date.parse(now) > Date.parse(dueAt) : today > dueOn;
      responseStatus = late ? "Overdue" : "Awaiting response";
    }
    if (responseStatus === "Overdue" || responseStatus === "Responded late") add("responseTiming", "Review the missed Board response deadline.");
    if (response && (!response.allegations || !response.questions || !response.documents))
      add("responseContents", "Reconcile the answers to the allegations and notice with the requested documents.");
  }
  return { findings, stateReviewDate: anniversary.success ? anniversary.data : null, dueOn, dueAt, responseStatus };
}
