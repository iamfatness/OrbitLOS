import type { Condition, Stage } from "./model";
import type { BorrowerQuote } from "./pricing-model";
import type { SharedPreapprovalLetter } from "./preapproval-model";

export const documentKinds = ["Pay stub", "Bank statement", "Tax form", "Photo ID", "Homeowners insurance"] as const;
export type DocumentKind = (typeof documentKinds)[number];
export const conditionDocumentBatchLimit = 50;
const suggestedDocumentKinds = new Map<string, DocumentKind>([
  ["Income", "Pay stub"], ["Assets", "Bank statement"], ["Identity", "Photo ID"], ["Insurance", "Homeowners insurance"],
]);

export function suggestedConditionDocument(condition: Pick<Condition, "category" | "description">) {
  const kind = suggestedDocumentKinds.get(condition.category);
  const instructions = condition.description.slice(0, 500).trim();
  return kind && instructions ? { kind, instructions } : null;
}
export const checklistPresets = {
  "Wage income": ["Photo ID", "Pay stub", "Bank statement"],
  "Self-employed": ["Photo ID", "Tax form", "Bank statement"],
  "Investment property": ["Photo ID", "Bank statement", "Homeowners insurance"],
} as const satisfies Record<string, readonly DocumentKind[]>;
export const checklistPresetNames = ["Wage income", "Self-employed", "Investment property"] as const;
export const checklistInstructions: Record<DocumentKind, string> = {
  "Pay stub": "Provide a sample pay statement showing pay period and earnings.",
  "Bank statement": "Provide a sample statement showing the statement period and deposits.",
  "Tax form": "Provide a sample tax form showing the reporting year.",
  "Photo ID": "Provide the fictional sample identification.",
  "Homeowners insurance": "Provide a sample declarations page for the subject property.",
};
export type DocumentStatus = "Requested" | "Received" | "Accepted" | "Needs replacement";

export interface DocumentRequest {
  id: string;
  kind: DocumentKind;
  instructions: string;
  status: DocumentStatus;
  replacementNote: string;
  submittedAt: string | null;
  dueOn: string | null;
  revision: number;
  pdfStatus: "Processing" | "Ready" | "Retry" | null;
  pdfUploadedAt: string | null;
}

export interface LoanDocumentRequest extends DocumentRequest {
  loanId: string;
  requestedAt: string;
  deadlineRevision: number;
  submissionId: string | null;
  conditionId: string | null;
  uwmReceipt: string | null;
  uwmSentAt: string | null;
  uwmDeliveryFailedAt: string | null;
  previousUwmDeliveries: { receipt: string; sentAt: string; documentRevision: number | null }[];
}

export interface BorrowerLoanStatus {
  stage: Stage;
  stageSince: string;
  reviewed: boolean;
  documents: DocumentRequest[];
  quote: BorrowerQuote | null;
  preapproval?: SharedPreapprovalLetter;
}

export function needsBorrowerDocument(status: DocumentStatus) {
  return status === "Requested" || status === "Needs replacement";
}

export const sampleDocuments: Record<DocumentKind, { name: string; content: string }> = {
  "Pay stub": {
    name: "sample-pay-stub.txt",
    content: "Pay statement\nEmployer: Example Orchard Co.\nEmployee: Demo Borrower\nPay period: June 1–15, 2026\nGross pay: $3,250.00\nDeductions: $680.00\nNet pay: $2,570.00",
  },
  "Bank statement": {
    name: "sample-bank-statement.txt",
    content: "Checking statement\nBank: Example Grove Bank\nAccount holder: Demo Borrower\nStatement period: June 2026\nOpening balance: $11,680.00\nDeposits: $5,140.00\nWithdrawals: $2,590.00\nClosing balance: $14,230.00",
  },
  "Tax form": {
    name: "sample-wage-statement.txt",
    content: "Wage and tax statement\nTax year: 2025\nEmployer: Example Orchard Co.\nEmployee: Demo Borrower\nWages: $78,000.00\nFederal income tax withheld: $9,360.00",
  },
  "Photo ID": {
    name: "sample-id-record.txt",
    content: "Sample identification record\nName: Demo Borrower\nIssuing authority: Example State\nDocument number: SAMPLE-ID\nExpiry: December 31, 2028",
  },
  "Homeowners insurance": {
    name: "sample-insurance-declarations.txt",
    content: "Homeowners insurance declarations\nCarrier: Example Grove Insurance\nNamed insured: Demo Borrower\nProperty: 100 Example Lane\nCoverage period: July 2026–July 2027\nDwelling coverage: $350,000.00\nDeductible: $1,000.00",
  },
};
