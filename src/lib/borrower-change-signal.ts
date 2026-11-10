import type { StaffApplication } from "./application-model";
import { coBorrowerDocumentRecipient, documentRecipient, primaryDocumentRecipient, type LoanDocumentRequest } from "./document-model";

const checklistWrites = new Set([
  "requestDocument", "requestSuggestedUwmDocuments", "applyDocumentPreset", "applyDocumentTemplate", "setDocumentDeadline",
  "reviewDocument", "reopenMockUwmCondition",
]);
const disclosureWrites = new Set(["prepareDisclosurePackage", "issueDisclosurePackage", "respondToDisclosurePackage",
  "saveFeeWorksheet", "selectOffer", "requestApplicationCorrection"]);

export function borrowerDisclosureTokens(input: unknown, applications: readonly StaffApplication[]) {
  if (!input || typeof input !== "object" || !("type" in input) || typeof input.type !== "string" ||
    !disclosureWrites.has(input.type) || !("loanId" in input) || typeof input.loanId !== "string") return [];
  const app = applications.find((item) => item.loanId === input.loanId);
  return [...(app && !app.revokedAt ? [app.token] : []),
    ...(app?.joint?.token && !app.joint.revokedAt ? [app.joint.token] : [])];
}

export function borrowerChecklistTokens(input: unknown, applications: readonly StaffApplication[], requests: readonly LoanDocumentRequest[] = []) {
  if (!input || typeof input !== "object" || !("type" in input) || typeof input.type !== "string" ||
    !checklistWrites.has(input.type) || !("loanId" in input) || typeof input.loanId !== "string") return [];
  const app = applications.find((application) => application.loanId === input.loanId && application.submittedAt);
  const joint = app?.joint;
  const request = "requestId" in input ? requests.find((item) => item.id === input.requestId && item.loanId === app?.loanId)
    : "conditionId" in input && "submissionId" in input ? requests.find((item) =>
      item.conditionId === input.conditionId && item.submissionId === input.submissionId && item.loanId === app?.loanId) : undefined;
  const recipient = request ? documentRecipient(request) : "recipient" in input && input.recipient === coBorrowerDocumentRecipient ?
    coBorrowerDocumentRecipient : ["requestDocument", "requestSuggestedUwmDocuments", "applyDocumentPreset", "applyDocumentTemplate"].includes(input.type) ?
      primaryDocumentRecipient : undefined;
  return [...(app && !app.revokedAt && recipient !== coBorrowerDocumentRecipient ? [app.token] : []),
    ...(joint?.token && joint.submittedAt && !joint.revokedAt && recipient !== primaryDocumentRecipient ? [joint.token] : [])];
}

export async function borrowerChangeChannel(token: string) {
  if (typeof BroadcastChannel === "undefined" || !globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    // Keep the borrower link and application details out of the signal.
    return new BroadcastChannel(`orbit-borrower-change:${key}`);
  } catch {
    return null;
  }
}

type BorrowerChange = "changed" | "checklist-changed" | "disclosure-changed";

export async function announceBorrowerChange(token: string, change: BorrowerChange = "changed") {
  const channel = await borrowerChangeChannel(token);
  if (!channel) return;
  try {
    channel.postMessage(change);
  } catch {
    // The other tab can still refresh when it becomes visible.
  } finally {
    channel.close();
  }
}

export function observeBorrowerChange(token: string, change: BorrowerChange, onChange: () => void) {
  let active = true;
  let channel: BroadcastChannel | null = null;
  void borrowerChangeChannel(token).then((connection) => {
    if (!active) { connection?.close(); return; }
    channel = connection;
    channel?.addEventListener("message", (event) => {
      if (active && event.data === change) onChange();
    });
  });
  return () => {
    active = false;
    channel?.close();
  };
}
