import { createHash } from "node:crypto";
import { pdfColumns } from "./document-files-model";
import { fundingCheckInTarget, isStalledLoan, loanNextAction } from "./loan-workflow";
import type { Contact, Loan } from "./model";
import { brokerageStalledUnavailable, stalledLoanUnavailable } from "./officer-dashboard-model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { readPlaybook } from "./playbooks";
import { returningClientOption } from "./past-client-queue";
import type { ReturningClientOption } from "./past-client-queue-model";
import type { WorkspaceStaff } from "./staff-store";
import { loanWorkRecords, readBrokerageTemplates, type Store } from "./store";
import { loanAccess } from "./workspace-access";
import { searchTaskTarget } from "./workspace-search-model";

export const loanWorkUnavailable = "This loan is unavailable in your workspace.";

function loanHandoffVersion(db: Store, loanId: string) {
  const application = db.prepare(`SELECT revision, updatedAt, submittedAt, reviewedAt, revokedAt, expiresAt, uwmReference
    FROM applications WHERE loanId = ?`).get(loanId);
  const documents = db.prepare(`SELECT requests.id, requests.status, requests.revision, requests.deadlineRevision, ${pdfColumns()}
    FROM document_requests requests LEFT JOIN document_files files ON files.requestId = requests.id
    WHERE requests.loanId = ? ORDER BY requests.requestedAt, requests.id`).all(loanId);
  return createHash("sha256").update(JSON.stringify([application, documents])).digest("hex");
}

export function readLoanHandoff(db: Store, loanId: unknown, knownVersion: unknown, staff: WorkspaceStaff | null, brokerageId: string) {
  if (!staff || staff.brokerage.id !== brokerageId || typeof loanId !== "string" || !loanId || loanId.length > 100 ||
      typeof knownVersion !== "string" || !/^[a-f0-9]{64}$/.test(knownVersion) || !loanAccess(db, staff, loanId)) {
    return { error: loanWorkUnavailable };
  }
  const version = loanHandoffVersion(db, loanId);
  return version === knownVersion ? { unchanged: true as const } : editableLoanRecords(db, loanId, staff, version);
}

export function readEditableLoan(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, localName?: string, now = Date.now()) {
  const stalled = input && typeof input === "object" && "stalledLoanId" in input;
  const brokerageStalled = stalled && "scope" in input && input.scope === "brokerage";
  const loanId = stalled ? input.stalledLoanId : input;
  if (!staff || staff.brokerage.id !== brokerageId || typeof loanId !== "string" || !loanId || loanId.length > 100) {
    return { error: loanWorkUnavailable };
  }
  if (stalled) {
    if (brokerageStalled && staff.brokerage.role !== "Admin") return { error: brokerageStalledUnavailable };
    if (staff.brokerage.role === "Processor") return { error: stalledLoanUnavailable };
    const owner = brokerageStalled ? "" : localName ? "AND (officerEmail = ? OR (officerEmail IS NULL AND officer = ?))" : "AND officerEmail = ?";
    const current = db.prepare(`SELECT stage, stageSince, disposition FROM loans WHERE id = ? ${owner}`)
      .get(loanId, ...(owner ? [staff.email, ...(localName ? [localName] : [])] : [])) as Pick<Loan, "stage" | "stageSince" | "disposition"> | undefined;
    if (!current || !isStalledLoan(current, now)) return { error: stalledLoanUnavailable };
  } else if (!loanAccess(db, staff, loanId)) return { error: loanWorkUnavailable };
  return editableLoanRecords(db, loanId, staff, loanHandoffVersion(db, loanId), Boolean(stalled));
}

function editableLoanRecords(db: Store, loanId: string, staff: WorkspaceStaff, handoffVersion: string, stalled = false) {
  const records = loanWorkRecords(db, staff.brokerage.role === "Admin", loanId);
  const loan = records.loans[0];
  const contacts = db.prepare("SELECT * FROM contacts WHERE id IN (?, ?) ORDER BY name COLLATE NOCASE")
    .all(loan.contactId, loan.partnerId).map((row) => ({ ...row }) as unknown as Contact);
  const suppression = blockedOutreachKeys(db, contacts.filter((item) => item.role !== "Realtor").map((item) => ({ ...item, contactId: item.id })));
  const visibleContacts = contacts.map((contact) => ({ ...contact,
    outreachSuppressed: contact.role !== "Realtor" && outreachSuppressed(suppression, { ...contact, contactId: contact.id }) }));
  const settings = readPlaybook(db);
  const playbook = staff.brokerage.role === "Admin" ? settings : { ...settings, backupEmail: null, secondReview: null };
  const action = stalled ? loanNextAction(loan, { ...records, contacts: visibleContacts, playbook }, staff.brokerage.role) : undefined;
  const returningClientLoans = staff.brokerage.role === "Processor" ? [] : db.prepare(`
    SELECT repeat.fundedLoanId, repeat.loanId FROM returning_client_loans repeat JOIN loans next ON next.id = repeat.loanId
    WHERE repeat.fundedLoanId = ? ${staff.brokerage.role === "LO" ? "AND next.officerEmail = ?" : ""}
  `).all(loanId, ...(staff.brokerage.role === "LO" ? [staff.email] : []))
    .map(({ fundedLoanId, loanId }) => ({ fundedLoanId: String(fundedLoanId), loanId: String(loanId) }));
  const repeatOption: ReturningClientOption = records.closingProgress[0]?.fundingDate ?
    returningClientOption(db, loanId, staff) : { kind: "unavailable" };
  return {
    ...records, loanId, handoffVersion, contacts: visibleContacts, playbook, returningClientLoans, brokerageTemplates: readBrokerageTemplates(db),
    repeatOption,
    ...(action ? { workTarget: action.taskId && action.target !== fundingCheckInTarget ? searchTaskTarget(action.taskId) : action.target } : {}),
    ...(staff.brokerage.role === "Processor" ? { tasks: [], mismoLoans: [], mockUwmRates: [], uwmAlerts: [] } : {}),
  };
}
