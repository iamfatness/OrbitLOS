import { createHash } from "node:crypto";
import { pastClientLoan } from "./client-retention";
import { pdfColumns } from "./document-files-model";
import { fundingCheckInTarget, isStalledLoan, loanNextAction } from "./loan-workflow";
import type { Contact, Loan } from "./model";
import { brokerageStalledUnavailable, stalledLoanUnavailable } from "./officer-dashboard-model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { readPlaybook } from "./playbooks";
import { returningClientOption } from "./past-client-queue";
import type { ReturningClientOption } from "./past-client-queue-model";
import type { WorkspaceStaff } from "./staff-store";
import { readyRealtorFinancingId } from "./realtor-financing";
import { currentPreapprovalWork } from "./preapproval-work";
import { loanWorkRecords, readBrokerageTemplates, type Store } from "./store";
import { loanAccess, scopeJointLinks } from "./workspace-access";
import { searchTaskTarget } from "./workspace-search-model";
import { readManualReturnWork } from "./manual-lender-work";
import { processingActivityPrefix } from "./processing-model";
import { canUseSampleDisclosures, readDisclosureWork } from "./disclosures";
import { readClosingPackets } from "./closing-packets";
import { closingPacketChecklistLimit } from "./closing-packet-model";
import { staffBorrowerQuestions } from "./borrower-questions";
import { canUseServiceOrders, loanServiceOrders } from "./service-orders";
import { closingServiceEvidence } from "./closing-service-evidence";
import { storedQuoteConsent } from "./quote-intake-model";
import { quoteOverrideEvidence } from "./quote-intake-questions";
import { submittedApplicationAnswers } from "./application-questionnaires";
import { loanWorkUnavailable } from "./loan-work-model";

function loanHandoffVersion(db: Store, loanId: string) {
  const application = db.prepare(`SELECT revision, updatedAt, submittedAt, reviewedAt, revokedAt, expiresAt, uwmReference,
    (SELECT amount FROM loans WHERE id = app.loanId) AS recordedAmount,
    (SELECT json_array(id, selectedId) FROM pricing_runs WHERE loanId = app.loanId AND selectedId IS NOT NULL
      ORDER BY selectedAt DESC, rowid DESC LIMIT 1) AS selectedQuote,
    (SELECT revision FROM application_lender_details WHERE loanId = app.loanId) AS lenderRevision,
    (SELECT event.activityId FROM application_handoff_events event JOIN activity ON activity.id = event.activityId
      WHERE event.loanId = app.loanId AND event.applicationRevision = app.revision
      ORDER BY event.lenderRevision DESC, activity.rowid DESC LIMIT 1) AS linkedHandoff
    FROM applications app WHERE loanId = ?`).get(loanId);
  const documents = db.prepare(`SELECT requests.id, requests.status, requests.revision, requests.deadlineRevision, requests.recipient, ${pdfColumns()}
    FROM document_requests requests LEFT JOIN document_files files ON files.requestId = requests.id
    WHERE requests.loanId = ? ORDER BY requests.requestedAt, requests.id`).all(loanId);
  const joint = db.prepare("SELECT submittedAt, primarySubmittedAt, revokedAt, expiresAt FROM joint_applications WHERE loanId = ?").get(loanId);
  const processing = db.prepare("SELECT revision FROM loan_processing WHERE loanId = ?").get(loanId);
  const phase = db.prepare(`SELECT loan.stage, loan.stageSince, loan.dispositionRevision, loan.officer, loan.officerEmail,
    plan.targetDate, profile.closingDate, progress.revision AS closingRevision
    FROM loans loan LEFT JOIN closing_plans plan ON plan.loanId = loan.id
    LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
    LEFT JOIN closing_progress progress ON progress.loanId = loan.id WHERE loan.id = ?`).get(loanId);
  const conditions = db.prepare(`SELECT file.id, file.status, file.syncedAt, item.conditionId, item.title, item.reopenedAt, item.manualOwner
    FROM submissions file LEFT JOIN processing_open_conditions item ON item.submissionId = file.id
    WHERE file.loanId = ? ORDER BY file.id, item.conditionId`).all(loanId);
  const disclosure = db.prepare("SELECT version, revision FROM disclosure_packages WHERE loanId = ? ORDER BY version DESC LIMIT 1").get(loanId);
  const closingDisclosure = disclosure && db.prepare(`SELECT version, revision, reviewedAt FROM closing_disclosure_reviews
    WHERE loanId = ? ORDER BY version DESC, revision DESC LIMIT 1`).get(loanId);
  const packet = closingDisclosure && db.prepare("SELECT version FROM closing_packets WHERE loanId = ? ORDER BY version DESC LIMIT 1").get(loanId);
  const packetIdentity = packet && db.prepare(`SELECT loan.address, contact.name
    FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
    WHERE loan.id = ?`).get(loanId);
  const checklist = (phase?.targetDate || phase?.closingDate || phase?.stage === "Clear to Close" || packet) &&
    db.prepare("SELECT id, revision FROM closing_items WHERE loanId = ? ORDER BY dueDate, id LIMIT ?")
    .all(loanId, closingPacketChecklistLimit + 1);
  const uwmAcceptance = db.prepare("SELECT revision, reconciledAt FROM mock_uwm_acceptances WHERE loanId = ? ORDER BY revision DESC LIMIT 1").get(loanId);
  const questions = db.prepare("SELECT id, revision FROM borrower_questions WHERE loanId = ? ORDER BY id").all(loanId);
  const orders = db.prepare("SELECT id, revision FROM service_orders WHERE loanId = ? ORDER BY id").all(loanId);
  return createHash("sha256").update(JSON.stringify([
    application, documents, joint, processing, phase, conditions, disclosure, closingDisclosure, packet, packetIdentity, checklist, uwmAcceptance, questions, orders,
  ])).digest("hex");
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
  const work = editableLoanRecords(db, loanId, staff, loanHandoffVersion(db, loanId), Boolean(stalled));
  const realtorFinancingReadyId = staff.brokerage.pilot && staff.brokerage.role !== "Processor"
    ? readyRealtorFinancingId(db, loanId, new Date(now).toISOString()) : null;
  const preapprovalWork = currentPreapprovalWork(db, staff, loanId, new Date(now));
  return { ...work, ...(realtorFinancingReadyId ? { realtorFinancingReadyId } : {}), ...(preapprovalWork ? { preapprovalWork } : {}) };
}

function editableLoanRecords(db: Store, loanId: string, staff: WorkspaceStaff, handoffVersion: string, stalled = false) {
  const records = loanWorkRecords(db, staff.brokerage.role === "Admin", loanId);
  const loan = records.loans[0];
  const processingActivity = records.loanProcessing.length ? db.prepare(`SELECT id, text, createdAt FROM activity
    WHERE loanId = ? AND text GLOB '${processingActivityPrefix}*' ORDER BY rowid DESC LIMIT 4`).all(loanId)
    .map(({ id, text, createdAt }) => ({ id: String(id), text: String(text), createdAt: String(createdAt) })) : [];
  const contacts = db.prepare(`SELECT contact.*, coalesce(channels.blocked, 0) AS outreachChannelBlocks
    FROM contacts contact LEFT JOIN borrower_contact_channels channels ON channels.contactId = contact.id
    WHERE contact.id IN (?, ?) ORDER BY contact.name COLLATE NOCASE`)
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
  const repeatOption: ReturningClientOption = pastClientLoan(loan) || records.closingProgress[0]?.fundingDate ?
    returningClientOption(db, loanId, staff) : { kind: "unavailable" };
  const application = records.applications[0];
  const applicationQuestionReceipts = application ? submittedApplicationAnswers(db, loanId) : [];
  const manualReturn = staff.brokerage.role !== "Processor" &&
    (application?.lastManualSubmissionId || application?.manualLenderRejected) && !application.manualHandoff?.submissionId ?
    readManualReturnWork(db, loanId, settings.requireSecondReview) : undefined;
  const websiteReceipt = staff.brokerage.role !== "Processor" && db.prepare(`SELECT receipt.consentReceipt, json_valid(receipt.conversionOverrides) AS hasOverrides,
    receipt.conversionOverrides
    FROM referral_leads lead JOIN quote_intake_receipts receipt ON receipt.leadId = lead.id
    WHERE lead.loanId = ? AND lead.realtorId IS NULL
    ORDER BY lead.createdAt, lead.id LIMIT 1`).get(loanId);
  const overrides = websiteReceipt && websiteReceipt.hasOverrides && typeof websiteReceipt.conversionOverrides === "string"
    ? quoteOverrideEvidence.safeParse(JSON.parse(websiteReceipt.conversionOverrides)) : undefined;
  const disclosureWork = canUseSampleDisclosures(staff) ? readDisclosureWork(db, loanId) : undefined;
  return {
    ...records, loanId, handoffVersion, processingActivity, contacts: visibleContacts, playbook, returningClientLoans, brokerageTemplates: readBrokerageTemplates(db),
    ...(websiteReceipt ? { quoteConsent: storedQuoteConsent(websiteReceipt.consentReceipt) } : {}),
    ...(overrides?.success ? { quoteOverrides: overrides.data } : {}),
    ...(applicationQuestionReceipts.length ? { applicationQuestionReceipts } : {}),
    ...(disclosureWork ? { disclosureWork } : {}),
    borrowerQuestions: disclosureWork ? staffBorrowerQuestions(db, loanId) : [],
    ...(canUseServiceOrders(staff) ? { serviceOrders: loanServiceOrders(db, loanId), closingServiceEvidence: closingServiceEvidence(db, loanId) } : {}),
    ...(disclosureWork?.packages.length ? { closingPacketWork: readClosingPackets(db, loanId, disclosureWork) } : {}),
    applications: scopeJointLinks(records.applications, staff),
    repeatOption,
    ...(manualReturn ? { manualReturn } : {}),
    ...(action ? { workTarget: action.taskId && action.target !== fundingCheckInTarget ? searchTaskTarget(action.taskId) : action.target } : {}),
    ...(staff.brokerage.role === "Processor" ? { tasks: [], mismoLoans: [], mockUwmRates: [], uwmAlerts: [] } : {}),
  };
}
