import { illinoisLoanLogLaw, illinoisLogExceptions, illinoisLogGaps, type IllinoisLogFacts, type IllinoisLogProduct } from "./illinois-loan-log-model";
import { loanRegisterWorkbook, type RegisterCell } from "./ohio-loan-register-spreadsheet";

export type IllinoisLogSheetRow = { facts: IllinoisLogFacts; evidence: string; reviewIssue: string | null };
type Column = readonly [label: string, value: (row: IllinoisLogSheetRow) => RegisterCell, width?: number];
const usd = (cents: number | undefined) => cents === undefined ? "" : cents / 100;
const core: Column[] = [
  ["Application date", ({ facts }) => facts.applicationDate ?? ""],
  ["Borrower names", ({ facts }) => facts.borrowers.map(person => person.name).join("\n"), 32],
];
const property: Column = ["Property address", ({ facts }) => facts.propertyAddress ?? "", 42];
const seller: Column = ["Property sellers", ({ facts }) => facts.purpose === "Refinance" ? "NA" : facts.sellers.join("\n"), 29];
const amount: Column = ["Loan amount (USD)", ({ facts }) => usd(facts.amountCents)];
const terms: Column[] = [
  ["APR (%)", ({ facts }) => facts.aprPercent ?? ""],
  ["Loan program", ({ facts }) => facts.loanProgram ?? "", 29],
];
const staff: Column[] = [
  ["Mortgage loan originators", ({ facts }) => facts.originators.map(person => person.name).join("\n"), 29],
  ["Originator NMLS IDs", ({ facts }) => facts.originators.map(person => person.nmls ?? "").join("\n")],
  ["Processors", ({ facts }) => facts.processors.join("\n"), 29],
  ["Appraisers", ({ facts }) => facts.appraisers.map(person => person.name).join("\n"), 29],
];
const appraiserLicense: Column = ["Appraiser license numbers", ({ facts }) => facts.appraisers.map(person => person.license ?? "").join("\n"), 27];
const outcomes: Column[] = [
  ["Application status", ({ facts }) => facts.outcome],
  ["Closing date", ({ facts }) => facts.closing?.on ?? ""],
  ["Loan owner", ({ facts }) => facts.closing?.owner ?? "", 29],
  ["Loan servicer", ({ facts }) => facts.closing?.servicer ?? "", 29],
  ["Loan closer", ({ facts }) => facts.closing?.closer ?? "", 29],
  ["Closer employer", ({ facts }) => facts.closing?.closerEmployer ?? "", 29],
  ["Closing location", ({ facts }) => facts.closing?.location ?? "", 36],
];
const references: Column[] = [
  ["File number", ({ facts }) => facts.fileNumber ?? ""],
  ["Evidence references", ({ facts, evidence }) => [evidence, facts.classificationReference, facts.shared?.transitionReference]
    .filter(Boolean).join("\n"), 36],
  ["Documented exceptions", ({ facts }) => Object.entries(facts.exceptions).map(([key, value]) =>
    `${illinoisLogExceptions[key as keyof typeof illinoisLogExceptions]}: ${value}`).join("\n"), 50],
];
const standard: Column[] = [...core,
  ["Borrower employers", ({ facts }) => facts.borrowers.map(person => person.employer ?? "").join("\n"), 29],
  ["Employer addresses", ({ facts }) => facts.borrowers.map(person => person.employerAddress ?? "").join("\n"), 36],
  seller, property, amount, ...terms, ...staff, appraiserLicense, ...outcomes,
  ["High-risk classification", ({ facts }) => facts.highRisk ?? ""],
  ...references,
];
const reverse: Column[] = [...core,
  ["Borrower ages", ({ facts }) => facts.borrowers.map(person => person.age ?? "").join("\n")], property,
  ...terms,
  ["Lump sum (USD)", ({ facts }) => usd(facts.reverse?.lumpSumCents)],
  ["Monthly payment (USD)", ({ facts }) => usd(facts.reverse?.monthlyPaymentCents)],
  ["Line of credit (USD)", ({ facts }) => usd(facts.reverse?.lineOfCreditCents)],
  ...staff,
  ["Appraised value (USD)", ({ facts }) => usd(facts.reverse?.appraisedCents)],
  ["Loan-to-value (%)", ({ facts }) => facts.reverse?.loanToValue ?? ""],
  ["Counseling", ({ facts }) => facts.reverse?.counseling ?? ""],
  ["Counseling agency", ({ facts }) => facts.reverse?.counselingAgency ?? "", 29],
  ["HUD-approved agency", ({ facts }) => facts.reverse?.hudApproved ?? ""],
  ...references,
];
const shared: Column[] = [...core, seller, property, amount, ...staff, appraiserLicense, ...outcomes,
  ["Starting value (USD)", ({ facts }) => usd(facts.shared?.startingValueCents)],
  ["Starting value method", ({ facts }) => facts.shared?.startingValueMethod ?? "", 36],
  ["Share percentage", ({ facts }) => facts.shared?.sharePercent ?? ""],
  ["Counseling date", ({ facts }) => facts.shared?.counselingOn ?? ""],
  ["Counseling provider", ({ facts }) => facts.shared?.counselingProvider ?? "", 30],
  ...references,
];
const draft: Column[] = [...core, property,
  ["Log product", ({ facts }) => facts.product, 30],
  ["File number", ({ facts }) => facts.fileNumber ?? ""],
  ["Evidence reference", row => row.evidence, 36],
  ["Open evidence", ({ facts, reviewIssue }) => [...illinoisLogGaps(facts), reviewIssue].filter(Boolean).join("; ") || "Awaiting review", 65],
];

function sheet(name: string, columns: Column[], records: IllinoisLogSheetRow[]) {
  return { name, rows: [columns.map(column => column[0]), ...records.map(row => columns.map(column => column[1](row)))],
    widths: columns.map(column => column[2] ?? 24), filter: true };
}

export function illinoisLoanLogWorkbook(input: {
  reviewed: IllinoisLogSheetRow[]; highRisk: IllinoisLogSheetRow[]; incomplete: IllinoisLogSheetRow[];
  entity: { name: string; nmls: string }; from: string; through: string; highRiskFrom: string; at: string; unmatchedCandidates: number;
}) {
  const { reviewed, highRisk, incomplete, entity, from, through, highRiskFrom, at, unmatchedCandidates } = input;
  const product = (name: IllinoisLogProduct) => reviewed.filter(row => row.facts.product === name);
  const scope: RegisterCell[][] = [
    ["Legal entity", entity.name], ["Company NMLS", entity.nmls], ["Application dates from", from], ["Application dates through", through],
    ["High-risk lookback from", highRiskFrom], ["High-risk lookback through", through], ["Prepared at", at],
    ["Reviewed applications in selected period", reviewed.length], ["Reviewed high-risk applications in 60-month window", highRisk.length],
    ["Incomplete records", incomplete.length], ["Potential Illinois loans without a reviewed entry (workspace)", unmatchedCandidates],
    ["Reconciliation", "Confirm scope, outside applications, incomplete records and high-risk lookback coverage against the examination request."],
    ["Entity activity", "This workbook covers brokerage and origination. Confirm separate servicing or secondary-market responsibilities for this entity."],
    ["Source", illinoisLoanLogLaw],
  ];
  return loanRegisterWorkbook([
    sheet("Brokerage and origination", standard, product("Brokerage or origination")),
    sheet("Reverse mortgages", reverse, product("Reverse mortgage")),
    sheet("Shared appreciation", shared, product("Shared appreciation agreement")),
    sheet("High-risk home loans", standard, highRisk),
    sheet("Incomplete records", draft, incomplete),
    { name: "Export scope", rows: scope, widths: [54, 110], filter: false },
  ]);
}
