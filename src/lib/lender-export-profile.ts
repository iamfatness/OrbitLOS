import { applicationIssues, requestedLoanAmount, type ApplicationDraft } from "./application-model";
import { defaultLenderExportProfile, exportName, type ExportName, type LenderExportProfile } from "./lender-export-model";
import { blankLenderDetails, lenderQuestions, lenderSupplement, type LenderDetails } from "./urla";

export type LenderExportIssue = {
  label: string;
  section: "borrower" | "names" | "originator" | "supplement";
  field?: string;
};

export const exportCorrectionsTarget = "manual-export-borrower-corrections";
export const exportNamesTarget = "manual-export-borrower-names";
export const lenderFieldPrefix = (section: "originator" | "supplement") => `manual-export-${section}-`;

const nmls = (value: string | undefined) => /^[1-9]\d{0,9}$/.test(value ?? "");
const positiveMoney = (value: string | undefined) => requestedLoanAmount(value) !== null;
const rate = (value: string | undefined) => /^\d{1,2}(\.\d{1,3})?$/.test(value ?? "") && Number(value) > 0;
const term = (value: string | undefined) => /^[1-9]\d{0,2}$/.test(value ?? "") && Number(value) <= 480;

export function lenderExportIssues(draft: ApplicationDraft, storedDetails: LenderDetails | undefined,
  names: ExportName[], profile: LenderExportProfile = defaultLenderExportProfile): LenderExportIssue[] {
  const issues: LenderExportIssue[] = applicationIssues(draft).map((label) => ({ label, section: "borrower" }));
  if (names.length !== 1 + draft.urla.additional.length) {
    issues.push({ label: "Confirm one export name for each borrower on the current application.", section: "names" });
  } else names.forEach((name, index) => {
    if (!exportName.safeParse(name).success) {
      issues.push({ label: `Confirm a first and last name for borrower ${index + 1}.`, section: "names", field: String(index) });
    }
  });
  if (profile === "basic") return issues;

  const { originator, supplement } = storedDetails ?? blankLenderDetails();
  const terms = supplement.fields;
  const org = originator.fields;
  function requireField(section: "originator" | "supplement", key: string, valid: boolean, hint?: string) {
    if (valid) return;
    const definitions = section === "originator" ? lenderQuestions : lenderSupplement;
    const field = definitions.fields.find((item) => item.key === key);
    issues.push({ section, field: key, label: hint ? `${field?.label ?? key} · ${hint}` : field?.label ?? key });
  }
  if (draft.urla.property.fields.propertyPending === "Yes") {
    issues.push({ label: "Replace the pending property with its street address, city, state, and ZIP.", section: "borrower" });
  }
  if (draft.purpose !== "Purchase" && draft.purpose !== "Refinance") {
    issues.push({ label: "Choose Purchase or Refinance for this sample registration profile.", section: "borrower" });
  }
  requireField("originator", "originator", !!org.originator?.trim());
  requireField("originator", "originatorNmls", nmls(org.originatorNmls), "enter a positive numeric ID");
  requireField("originator", "organization", !!org.organization?.trim());
  requireField("originator", "organizationNmls", nmls(org.organizationNmls), "enter a positive numeric ID");
  requireField("supplement", "mortgage", ["Conventional", "FHA", "VA", "USDA-RD"].includes(terms.mortgage), "choose a supported program");
  requireField("supplement", "rate", rate(terms.rate), "enter a positive rate");
  requireField("supplement", "term", term(terms.term), "enter 1 to 480 months");
  requireField("supplement", "mortgageLien", terms.mortgageLien === "First lien", "choose First lien");
  requireField("supplement", "amortization", ["Fixed rate", "Adjustable rate"].includes(terms.amortization), "choose Fixed rate or Adjustable rate");
  requireField("supplement", "loanAmount", !terms.loanAmount || (positiveMoney(terms.loanAmount) &&
    requestedLoanAmount(terms.loanAmount) === requestedLoanAmount(draft.loanAmount)), "match the reviewed 1003 amount or leave the override blank");
  if (draft.purpose === "Purchase") requireField("supplement", "purchasePrice", positiveMoney(terms.purchasePrice), "enter a positive contract price");
  if (draft.purpose === "Refinance") {
    requireField("supplement", "refinance", ["No cash out", "Limited cash out", "Cash out"].includes(terms.refinance), "choose the refinance type");
  }
  return issues;
}
