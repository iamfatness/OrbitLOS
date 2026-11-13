import { z } from "zod";
import { compareLocalEvidenceOrder } from "./local-evidence-order";
import { shiftReportDate } from "./report-date-range";

const reference = z.string().trim().min(1).max(180);
const date = z.iso.date().refine(on => on >= "2015-10-03" && on <= "2099-12-31");
const evidence = z.strictObject({ on: date, time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), reference });
export const californiaMldsSources = {
  statute: "https://www.dre.ca.gov/files/pdf/relaw/2026/relaw.pdf#page=78",
  forms: "https://www.dre.ca.gov/forms/MLB.html",
  evaluation: "https://www.dre.ca.gov/files/pdf/re7.pdf",
} as const;

export const californiaMldsFacts = z.strictObject({
  state: z.literal("CA"),
  scope: z.enum(["Unresolved", "DRE broker negotiation", "Outside DRE broker negotiation"]),
  scopeReference: reference,
  application: evidence.optional(),
  thirdBusinessDay: z.strictObject({ on: date, reference }).optional(),
  noteStatus: z.enum(["Unresolved", "Not obligated as reviewed", "Obligated"]),
  noteObligation: evidence.optional(),
  noteStatusReference: reference.optional(),
  borrowerScope: z.enum(["Unresolved", "One borrower", "Two borrowers"]),
  route: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("Unresolved") }),
    z.strictObject({ kind: z.literal("DRE statement"), form: z.enum(["RE 882", "RE 883", "RE 885", "DRE-approved alternate"]),
      formVersion: reference, productAndFormReference: reference.optional(), contentReviewReference: reference.optional(),
      brokerSignature: evidence.optional() }),
    z.strictObject({ kind: z.literal("Federal substitute"), form: z.enum(["Loan Estimate", "Good Faith Estimate"]),
      formVersion: reference, federallyRegulatedResidential: z.enum(["Unresolved", "Yes", "No"]),
      lien: z.enum(["Unresolved", "Senior", "Junior"]), principalCents: z.int().positive().max(100_000_000_000).optional(),
      eligibilityReference: reference.optional(), federalPackageReference: reference.optional(),
      californiaContentReference: reference.optional(), balloonReviewReference: reference.optional() }),
  ]),
  translationReviewReference: reference.optional(),
  retainedFileReference: reference.optional(),
  borrowers: z.array(z.strictObject({
    borrower: z.enum(["Primary borrower", "Additional borrower"]),
    delivery: evidence.optional(),
    signed: evidence.optional(),
    executedCopy: evidence.optional(),
    californiaSupplement: evidence.optional(),
  })).max(2),
}).superRefine((facts, ctx) => {
  const borrowers = new Set(facts.borrowers.map(item => item.borrower));
  if (borrowers.size !== facts.borrowers.length || (borrowers.size > 0 && !borrowers.has("Primary borrower")) ||
    (facts.borrowerScope === "One borrower" && borrowers.size > 1))
    ctx.addIssue({ code: "custom", path: ["borrowers"], message: "Record each borrower once and reconcile the borrower scope." });
  if (facts.thirdBusinessDay && (!facts.application || facts.thirdBusinessDay.on < shiftReportDate(facts.application.on, 3)))
    ctx.addIssue({ code: "custom", path: ["thirdBusinessDay"], message: "Record the completed application and a third business day at least three calendar days later." });
  if (facts.noteStatus !== "Obligated" && facts.noteObligation)
    ctx.addIssue({ code: "custom", path: ["noteObligation"], message: "Select the obligated status when recording an actual note obligation." });
});

const loanId = z.string().min(1).max(100);
export const californiaMldsRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), loanId, state: z.literal("CA") }),
  z.strictObject({ operation: z.literal("save"), loanId, requestId: z.uuid(), expectedRevision: z.int().nonnegative(),
    facts: californiaMldsFacts, correction: reference.optional() }),
]);
export type CaliforniaMldsRequest = z.infer<typeof californiaMldsRequest>;
export type CaliforniaMldsFacts = z.infer<typeof californiaMldsFacts>;
type Evidence = z.infer<typeof evidence>;

export function californiaMldsDates(facts: CaliforniaMldsFacts) {
  return [facts.application?.on, facts.noteObligation?.on, facts.route.kind === "DRE statement" ? facts.route.brokerSignature?.on : undefined,
    ...facts.borrowers.flatMap(item => [item.delivery?.on, item.signed?.on, item.executedCopy?.on, item.californiaSupplement?.on])];
}

function deliveryTiming(delivery: Evidence | undefined, facts: CaliforniaMldsFacts, today: string) {
  const dateLimit = facts.thirdBusinessDay?.on;
  const noteOrder = compareLocalEvidenceOrder(delivery, facts.noteObligation);
  const findings: string[] = [];
  if (!delivery) {
    findings.push((dateLimit && today > dateLimit) || facts.noteObligation
      ? "A documented cutoff has passed. Delivery evidence is missing." : "Record delivery evidence.");
  } else {
    if (dateLimit && delivery.on > dateLimit) findings.push("Delivery was after the documented third business day.");
    if (facts.application && compareLocalEvidenceOrder(delivery, facts.application) === "Before")
      findings.push("Verify that delivery before the completed application covers this transaction.");
    if (facts.noteObligation && noteOrder !== "Before")
      findings.push(noteOrder === "After" ? "Delivery was after the borrower became obligated on the note."
        : "Evidence does not establish delivery before the borrower became obligated on the note.");
  }
  return { noteOrder, findings };
}

function completedSignatures(facts: CaliforniaMldsFacts, expected: number, broker: Evidence | undefined) {
  if (!broker || facts.borrowerScope === "Unresolved" || facts.borrowers.length !== expected) return;
  let completed = broker;
  for (const { signed } of facts.borrowers) {
    const order = compareLocalEvidenceOrder(signed, completed);
    if (signed && order === "After") completed = signed;
    else if (order !== "Before" && order !== "Same recorded minute") return;
  }
  return completed;
}

export function reviewCaliforniaMlds(facts: CaliforniaMldsFacts, today: string) {
  const { scope, route, thirdBusinessDay, noteObligation } = facts;
  const findings: string[] = [];
  if (scope === "Unresolved") findings.push("Confirm whether this transaction is a DRE broker negotiation under the Real Estate Law.");
  if (scope !== "DRE broker negotiation") return { findings, documentedDay: null, noteCutoff: null, borrowers: [] };
  if (!facts.application) findings.push("Record receipt or preparation of the completed written application under 10 CCR §2842.5.");
  if (!thirdBusinessDay) findings.push("Document the third business day and the calendar used.");
  if (facts.noteStatus === "Unresolved" || (facts.noteStatus === "Obligated" ? !noteObligation : !facts.noteStatusReference))
    findings.push("Verify whether the borrower became obligated on the note and document the actual time if known.");
  if (facts.borrowerScope === "Unresolved") findings.push("Confirm the borrowers who must receive and sign or acknowledge the disclosures.");
  const expectedBorrowers = facts.borrowerScope === "Two borrowers" ? 2 : 1;
  if (facts.borrowers.length < expectedBorrowers) findings.push("Record disclosure evidence for each borrower in scope.");
  if (!facts.translationReviewReference) findings.push("Record the review of negotiated language and any required translated disclosures.");
  if (!facts.retainedFileReference) findings.push("Identify the retained signed statement or acknowledged substitute package.");
  if (route.kind === "Unresolved") findings.push("Confirm the disclosure route and form.");
  if (route.kind === "DRE statement") {
    if (!route.productAndFormReference) findings.push("Confirm that the form fits the product and document any required DRE approval.");
    if (!route.contentReviewReference) findings.push("Document the review of required terms, costs, compensation and license disclosures.");
    if (!route.brokerSignature) findings.push("Record the broker or authorized licensee signature.");
  }
  if (route.kind === "Federal substitute") {
    if (route.federallyRegulatedResidential !== "Yes") findings.push("Verify federally regulated residential loan scope for the substitute route.");
    const threshold = route.lien === "Senior" ? 3_000_000 : route.lien === "Junior" ? 2_000_000 : undefined;
    if (!threshold || !route.principalCents) findings.push("Record lien position and principal for the federal substitute review.");
    else if (route.principalCents < threshold) findings.push("The principal is below the DRE substitute threshold for this lien.");
    else if (route.principalCents === threshold) findings.push("Counsel must reconcile the statute and DRE guidance at the exact threshold.");
    if (!route.eligibilityReference) findings.push("Document counsel's basis for using the federal substitute for this file.");
    if (!route.federalPackageReference) findings.push("Identify the complete applicable federal disclosure package.");
    if (!route.californiaContentReference) findings.push("Document the California identifiers, licensing information and noncommitment language.");
    if (!route.balloonReviewReference) findings.push("Document whether a balloon payment disclosure is required and its evidence.");
  }
  const executed = route.kind === "DRE statement" ? completedSignatures(facts, expectedBorrowers, route.brokerSignature) : undefined;
  const borrowers = facts.borrowers.map(borrower => {
    const { delivery, signed, executedCopy, californiaSupplement } = borrower;
    const timing = deliveryTiming(delivery, facts, today);
    if (route.kind === "DRE statement") {
      if (!signed) timing.findings.push("Record the borrower signature.");
      if (!executedCopy) timing.findings.push("Record delivery of the exact executed copy at execution.");
      if (executedCopy && compareLocalEvidenceOrder(executedCopy, executed) !== "Same recorded minute")
        timing.findings.push("Verify that the exact copy was delivered when all required signatures were complete.");
    }
    if (route.kind === "Federal substitute") {
      if (!signed) timing.findings.push("Record the borrower's written acknowledgment of the applicable disclosures.");
      if (signed && delivery && compareLocalEvidenceOrder(signed, delivery) === "Before")
        timing.findings.push("Reconcile the acknowledgment that predates the recorded delivery.");
      if (signed && noteObligation && compareLocalEvidenceOrder(signed, noteObligation) !== "Before")
        timing.findings.push("Verify that written acknowledgment preceded the borrower becoming obligated.");
      if (route.form === "Loan Estimate" && compareLocalEvidenceOrder(californiaSupplement, delivery) !== "Same recorded minute")
        timing.findings.push("Verify that the separate California disclosure accompanied the Loan Estimate.");
    }
    return { borrower: borrower.borrower, ...timing };
  });
  return { findings, documentedDay: thirdBusinessDay?.on ?? null, noteCutoff: noteObligation?.on ?? null, borrowers };
}
