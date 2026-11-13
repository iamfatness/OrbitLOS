import { z } from "zod";

export const illinoisRecordsSources = {
  retention: "https://my.ilga.gov/commission/jcar/admincode/038/038010500J11760R.html",
  file: "https://ilga.gov/commission/jcar/admincode/038/038010500J11770R.html",
  highRisk: "https://ilga.gov/commission/jcar/admincode/038/038010500J11750R.html",
} as const;

export const illinoisFileDocuments = {
  agreement: "Loan brokerage agreement",
  brokerageDisclosure: "Loan brokerage disclosure statement",
  borrowerInformation: "Borrower Information Document",
  signedDocuments: "Documents signed by the borrowers",
  appraisal: "Appraisal",
  creditReport: "Credit report",
  otherThirdParty: "Other third-party loan documents",
  otherFileDocuments: "Other documents related to the loan",
} as const;
type FileDocument = keyof typeof illinoisFileDocuments;
const fileDocuments = Object.keys(illinoisFileDocuments) as FileDocument[];
const reference = z.string().trim().min(4).max(240);
const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2099-12-31", "Enter a date from 1900 through 2099.");
const documentEvidence = z.strictObject({ status: z.enum(["On file", "No document generated"]), reference });
const inspection = z.strictObject({ on: date, reference });

export const illinoisRecordkeepingFacts = z.strictObject({
  activity: z.enum(["Unresolved", "Brokerage services used", "Origination only"]),
  activityReference: reference.optional(),
  risk: z.enum(["Unresolved", "Standard", "High-risk home loan"]),
  riskReference: reference.optional(),
  outcome: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Pending") }),
    z.strictObject({ status: z.literal("Unresolved") }),
    z.strictObject({ status: z.literal("Closed"), on: date, reference }),
    z.strictObject({ status: z.literal("Terminated"), on: date, reference }),
  ]),
  documents: z.strictObject({
    agreement: documentEvidence.optional(), brokerageDisclosure: documentEvidence.optional(),
    borrowerInformation: documentEvidence.optional(), signedDocuments: documentEvidence.optional(),
    appraisal: documentEvidence.optional(), creditReport: documentEvidence.optional(),
    otherThirdParty: documentEvidence.optional(), otherFileDocuments: documentEvidence.optional(),
  }),
  archive: z.discriminatedUnion("format", [
    z.strictObject({ format: z.literal("Unresolved") }),
    z.strictObject({ format: z.literal("Paper"), location: reference }),
    z.strictObject({ format: z.enum(["Digital", "Paper and digital"]), location: reference,
      reproduction: inspection.optional(), changesPreserved: inspection.optional(),
      conversion: z.discriminatedUnion("status", [
        z.strictObject({ status: z.literal("Unresolved") }),
        z.strictObject({ status: z.literal("No paper conversion"), reference }),
        z.strictObject({ status: z.literal("Paper converted"), batches: z.array(z.strictObject({
          on: date, method: reference, originals: reference, reference,
        })).min(1).max(20) }),
      ]),
    }),
  ]),
});

const loanId = z.string().min(1).max(200);
export const illinoisRecordkeepingRequest = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("illinoisRecordkeepingHistory"), loanId, before: z.int().positive().optional() }),
  z.strictObject({ type: z.literal("saveIllinoisRecordkeeping"), loanId, expected: z.int().nonnegative(), requestId: z.uuid(),
    facts: illinoisRecordkeepingFacts, correction: reference.optional() }),
]);
export type IllinoisRecordkeepingRequest = z.infer<typeof illinoisRecordkeepingRequest>;
export type IllinoisRecordkeepingFacts = z.infer<typeof illinoisRecordkeepingFacts>;

export function illinoisEvidenceDates({ outcome, archive }: IllinoisRecordkeepingFacts) {
  const dates = ["on" in outcome ? outcome.on : undefined];
  if ("conversion" in archive) {
    dates.push(archive.reproduction?.on, archive.changesPreserved?.on);
    if (archive.conversion.status === "Paper converted") dates.push(...archive.conversion.batches.map(batch => batch.on));
  }
  return dates;
}

type LoanOutcome = { stage: string; disposition: string; dispositionDate: string | null;
  fundingDate: string | null; closingDate: string | null };

function reconcileOutcome(outcome: IllinoisRecordkeepingFacts["outcome"], loan: LoanOutcome) {
  if (outcome.status === "Unresolved") return "Confirm the closing, termination or pending status.";
  const closed = Boolean(loan.closingDate || loan.fundingDate || ["Closed", "Funded"].includes(loan.stage));
  const ended = ["Lost", "Withdrawn"].includes(loan.disposition);
  if (outcome.status === "Pending") return closed || ended ? "Reconcile the pending outcome with the loan history." : null;
  if (outcome.status === "Closed") {
    if (!closed || ended || (loan.closingDate && outcome.on !== loan.closingDate) ||
      (loan.fundingDate && outcome.on > loan.fundingDate))
      return "Reconcile the Illinois closing date with the recorded closing and funding.";
    return null;
  }
  if (closed || !ended || (loan.dispositionDate && outcome.on > loan.dispositionDate))
    return "Reconcile the Illinois termination date with the recorded loan outcome.";
  return null;
}

export function reviewIllinoisRecordkeeping(facts: IllinoisRecordkeepingFacts, loan: LoanOutcome) {
  const findings: { key: string; message: string; source: string }[] = [];
  const add = (key: string, message: string, source: string) => findings.push({ key, message, source });
  const { activity, activityReference, risk, riskReference, outcome, documents, archive } = facts;
  const activityMissing = activity === "Unresolved" || !activityReference;
  const riskMissing = risk === "Unresolved" || !riskReference;
  if (activityMissing) add("activity", "Record the applicable Illinois brokerage or origination activity and its source.", illinoisRecordsSources.file);
  if (riskMissing) add("risk", "Document the high-risk home loan classification.", illinoisRecordsSources.highRisk);
  const outcomeGap = reconcileOutcome(outcome, loan);
  if (outcomeGap) add("outcome", outcomeGap, illinoisRecordsSources.retention);
  const historical = "on" in outcome && outcome.on < "2017-10-06";
  if (historical) add("historical", "Confirm the historical Illinois retention rule for this outcome.", illinoisRecordsSources.retention);

  for (const key of fileDocuments) {
    const brokerDocument = key === "agreement" || key === "brokerageDisclosure";
    if (brokerDocument && activity !== "Brokerage services used") continue;
    const entry = documents[key];
    const required = brokerDocument || key === "borrowerInformation" || (key === "signedDocuments" && outcome.status === "Closed");
    if (!entry || (entry.status !== "On file" && required))
      add(key, `Review the file evidence for ${illinoisFileDocuments[key]}.`, illinoisRecordsSources.file);
  }
  if (archive.format === "Unresolved") add("format", "Identify the retention medium and records location.", illinoisRecordsSources.retention);
  if ("conversion" in archive) {
    if (!archive.reproduction) add("reproduction", "Record a legible hard-copy reproduction check.", illinoisRecordsSources.retention);
    if (!archive.changesPreserved) add("changes", "Verify preservation of alterations, erasures and other changes.", illinoisRecordsSources.retention);
    if (archive.conversion.status === "Unresolved")
      add("conversion", "Determine whether the digital file includes converted paper records.", illinoisRecordsSources.retention);
    if (archive.conversion.status === "Paper converted") {
      const latestConversion = archive.conversion.batches.map(batch => batch.on).sort().at(-1);
      if (latestConversion && archive.reproduction && archive.reproduction.on < latestConversion)
        add("reproduction-date", "Record a reproduction check covering the latest paper conversion.", illinoisRecordsSources.retention);
      if (latestConversion && archive.changesPreserved && archive.changesPreserved.on < latestConversion)
        add("changes-date", "Verify preservation of changes through the latest paper conversion.", illinoisRecordsSources.retention);
    }
  }

  const stateMonths = riskMissing ? null : risk === "High-risk home loan" ? 60 : 36;
  const stateSource = risk === "High-risk home loan" ? illinoisRecordsSources.highRisk : illinoisRecordsSources.retention;
  let stateReviewDate: string | null = null;
  if (!activityMissing && !outcomeGap && !historical && stateMonths && "on" in outcome) {
    const [year, month, day] = outcome.on.split("-").map(Number);
    const targetYear = year + stateMonths / 12;
    const targetDay = Math.min(day, new Date(Date.UTC(targetYear, month, 0)).getUTCDate());
    stateReviewDate = `${targetYear}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
  }
  return { findings, stateMonths, stateSource, stateReviewDate };
}
