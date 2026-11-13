import { z } from "zod";

export const californiaDreRecordsSources = {
  statute: "https://www.dre.ca.gov/files/pdf/relaw/2026/relaw.pdf",
  regulations: "https://www.dre.ca.gov/files/pdf/relaw/2026/regs.pdf",
  manual: "https://www.dre.ca.gov/files/pdf/re7.pdf",
} as const;

const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const evidence = z.strictObject({ on: date, reference });
const attestation = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Unreviewed") }),
  z.strictObject({ status: z.enum(["On file", "Not applicable"]), reference }),
]);

export const californiaDreArchiveChecks = {
  immutability: "Nonerasable write-once storage and overwrite protection",
  regularCourse: "Records kept in the regular course of business",
  contemporaryRecord: "Original record provenance and timing",
  custodian: "Custodian identification of the record and preparation and storage methods",
  indexing: "Reliable indexing, date order and image quality checks",
} as const;
const archiveChecks = Object.keys(californiaDreArchiveChecks) as (keyof typeof californiaDreArchiveChecks)[];

export const californiaDreRecordkeepingFacts = z.strictObject({
  entityId: z.uuid(),
  authorityReference: reference,
  outcome: z.discriminatedUnion("status", [
    z.strictObject({ status: z.enum(["Pending", "Unresolved"]) }),
    z.strictObject({ status: z.literal("Closed"), on: date, reference }),
    z.strictObject({ status: z.literal("Unconsummated"), application: evidence, listing: evidence.optional() }),
  ]),
  fileInventory: reference.optional(),
  mortgageDisclosure: attestation,
  trustRecords: attestation,
  electronicSignatures: attestation,
  privateMoney: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Unreviewed") }),
    z.strictObject({ status: z.literal("Not applicable"), reference }),
    z.strictObject({ status: z.literal("Applicable"), selfDealing: attestation,
      investorQualifications: attestation, investorSuitability: attestation, retentionEvidence: reference.optional(), retainThrough: date.optional() }),
  ]),
  archive: z.discriminatedUnion("format", [
    z.strictObject({ format: z.literal("Unreviewed") }),
    z.strictObject({ format: z.literal("Paper"), location: reference, inspection: evidence.optional() }),
    z.strictObject({ format: z.enum(["Electronic", "Paper and electronic"]), location: reference, inspection: evidence.optional(),
      immutability: reference.optional(), regularCourse: reference.optional(), contemporaryRecord: reference.optional(),
      custodian: reference.optional(), indexing: reference.optional() }),
  ]),
});
export type CaliforniaDreRecordkeepingFacts = z.infer<typeof californiaDreRecordkeepingFacts>;

export const californiaDreRecordkeepingRequest = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("californiaDreRecordkeepingHistory"), loanId: z.string().min(1).max(200), before: z.int().positive().optional() }),
  z.strictObject({ type: z.literal("saveCaliforniaDreRecordkeeping"), loanId: z.string().min(1).max(200),
    expected: z.int().nonnegative(), requestId: z.uuid(), facts: californiaDreRecordkeepingFacts, correction: reference.optional() }),
]);
export type CaliforniaDreRecordkeepingRequest = z.infer<typeof californiaDreRecordkeepingRequest>;

type Loan = { stage: string; disposition: string; dispositionDate: string | null; fundingDate: string | null; closingDate: string | null };

export function californiaDreEvidenceDates({ outcome, archive }: CaliforniaDreRecordkeepingFacts) {
  return ["on" in outcome ? outcome.on : undefined,
    outcome.status === "Unconsummated" ? outcome.application.on : undefined,
    outcome.status === "Unconsummated" ? outcome.listing?.on : undefined,
    "inspection" in archive ? archive.inspection?.on : undefined];
}

export function reviewCaliforniaDreRecordkeeping(facts: CaliforniaDreRecordkeepingFacts, loan: Loan) {
  const findings: { key: string; message: string; source: string }[] = [];
  const add = (key: string, message: string, source: string = californiaDreRecordsSources.statute) => findings.push({ key, message, source });
  const { outcome, archive, privateMoney } = facts;
  const closed = Boolean(loan.closingDate || loan.fundingDate || ["Closed", "Funded"].includes(loan.stage));
  const ended = ["Withdrawn", "Lost"].includes(loan.disposition);
  let basis: { on: string; source: string; event: string } | null = null;
  if (outcome.status === "Closed") {
    if (!closed || ended || (loan.closingDate && outcome.on !== loan.closingDate) || (loan.fundingDate && outcome.on > loan.fundingDate))
      add("outcome", "Reconcile the recorded closing with the loan history.");
    else basis = { on: outcome.on, source: californiaDreRecordsSources.statute, event: "Closing" };
  } else if (outcome.status === "Unconsummated") {
    const dispositionDate = loan.dispositionDate;
    if (closed || !ended || (dispositionDate && [outcome.application.on, outcome.listing?.on].some(on => on && on > dispositionDate)))
      add("outcome", "Reconcile the application, listing and unconsummated outcome with the loan history.");
    else if (outcome.listing && outcome.listing.on !== outcome.application.on)
      add("start", "Resolve the different listing and mortgage application dates with counsel.", californiaDreRecordsSources.manual);
    else basis = { on: outcome.application.on, source: californiaDreRecordsSources.manual, event: "Loan application" };
  } else if (outcome.status === "Unresolved" || closed || ended) {
    add("outcome", "Confirm the loan outcome and retain dated evidence.");
  }

  if (!facts.fileInventory) add("inventory", "Reference the inventory of executed and obtained transaction records.");
  if (facts.mortgageDisclosure.status === "Unreviewed")
    add("disclosure", "Locate the signed mortgage disclosure or retained alternative and acknowledgment, or document applicability.");
  if (facts.trustRecords.status === "Unreviewed") add("trust", "Locate applicable trust records or document applicability.");
  if (facts.electronicSignatures.status === "Unreviewed")
    add("signatures", "Confirm the retained copies include applicable electronic signatures.", californiaDreRecordsSources.regulations);

  if (archive.format === "Unreviewed") add("archive", "Record where the file is retained.");
  else if (!archive.inspection) add("retrieval", "Document a file retrieval and paper-copy test for an examination.", californiaDreRecordsSources.regulations);
  if (archive.format === "Electronic" || archive.format === "Paper and electronic") {
    for (const key of archiveChecks) if (!archive[key])
      add(key, "Document " + californiaDreArchiveChecks[key].toLowerCase() + ".", californiaDreRecordsSources.regulations);
  }

  if (privateMoney.status === "Unreviewed")
    add("privateMoney", "Determine whether any self-dealing or private-money records have a longer retention requirement.", californiaDreRecordsSources.manual);
  if (privateMoney.status === "Applicable") {
    if (privateMoney.selfDealing.status === "Unreviewed") add("selfDealing", "Locate the self-dealing disclosure or document applicability.");
    if (privateMoney.investorQualifications.status === "Unreviewed") add("qualifications", "Locate investor qualification records or document applicability.");
    if (privateMoney.investorSuitability.status === "Unreviewed") add("suitability", "Locate investor suitability records or document applicability.");
    if (!privateMoney.retentionEvidence && [privateMoney.selfDealing, privateMoney.investorQualifications, privateMoney.investorSuitability].some(item => item.status !== "Not applicable"))
      add("privateRetention", "Document how applicable four-year private-money requirements are met.", californiaDreRecordsSources.manual);
  }

  const privateRetainThrough = privateMoney.status === "Applicable" ? privateMoney.retainThrough ?? null : null;
  const needsPrivateDate = privateMoney.status === "Applicable" &&
    [privateMoney.selfDealing, privateMoney.investorQualifications, privateMoney.investorSuitability].some(item => item.status !== "Not applicable");
  const anniversary = basis && (Number(basis.on.slice(0, 4)) + 3) + basis.on.slice(4);
  const stateReviewDate = date.safeParse(anniversary).success ? anniversary : null;
  if (basis && !stateReviewDate) add("anniversary", "Confirm the three-year anniversary for this date.");
  return { findings, basis, stateReviewDate, privateRetainThrough, needsPrivateDate };
}
