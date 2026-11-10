import type { BrokerageTemplate, ClosingItem, ClosingPlan, ClosingProgress, CommunicationDraft, Contact, ContactActivity, Loan, LoanTask, PastClientProfile, ReferralLead, RealtorPortal, Submission, UnlinkedReferral, Workspace } from "./model";
import { carriedCallbacks } from "./carried-campaign-callback";
import { contactCompletionSql } from "./record-history";
import { demoRecords } from "./seed";
import { staffApplications } from "./applications";
import { initializeSettlementSummaries } from "./settlement-reconciliation";
import { disclosureDeclinePrefix, disclosureDeclineTaskTitle } from "./disclosure-model";
import { closeReviewedApplicationFollowUps, createApplicationFollowUps } from "./tasks";
import type { MockUwmRate, PricingRun, PublishedQuote, SharedQuoteEvent } from "./pricing-model";
import { approvedIncomeSql } from "./income-review-freshness";
import type { LoanDocumentRequest } from "./document-model";
import { pdfColumns } from "./document-files-model";
import { synchronizeRetentionTasks } from "./client-retention";
import { referralMatches, referralPhone } from "./referral-matches";
import { mockCreditAusRuns } from "./mock-credit-aus";
import type { UwmAlert } from "./uwm-alert-model";
import type { InboxLead } from "./model";
import { callReportFiles } from "./call-report";
import { demoGuideState } from "./pilot";
import { linkLegacyCampaignAcknowledgments, readCampaignRehearsal } from "./campaign-rehearsal";
import { managerReportRecords, managerReports } from "./manager-reports";
import type { CampaignNavigation, CampaignQueueSnapshot, CampaignWorkPatch } from "./lead-work-model";
import type { WorkspaceStaff } from "./staff-store";
import { leadFollowUp, leadRouting } from "./lead-inbox";
import { quoteIntakeEvidence, storedQuoteRouting } from "./quote-intake-model";
import { readRealtorClaimPolicy } from "./realtor-claim-queue";
import { processingActivityPrefix, type LoanProcessing } from "./processing-model";
import type { FeeWorksheet, QuotePresentation } from "./quote-worksheet";
import { readPlaybook } from "./playbooks";
import { assignableCampaignLead, defaultCampaignRules, type CallCampaign, type CallCampaignMember, type CampaignLeadOption, type CampaignQueueFile } from "./call-campaign-model";
import { campaignSequenceConfig } from "./campaign-sequences";
import { initializeBorrowerChannels, leadBorrowerHoursSql, leadChannelBlocksSql, storedBorrowerHours } from "./borrower-channels";
import { blockedOutreachKeys, indexPendingContactOutreach, initializeContactOutreachIndex, initializeLeadReplyIndex, initializeRealtorReplyIndex,
  migrateCampaignOptOuts, openCallbackPromise, outreachIdentityKeys, outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import { initializeContactDuplicateQueue } from "./contact-duplicate-queue";
import type { CrmSegment } from "./crm-segment-model";
import { crmFieldFilter } from "./crm-field-model";
import { readCampaignRouting } from "./campaign-routing";
import { campaignResponses } from "./campaign-response";
import { initializeProcessingConditions, reopenedMockUwmAtSql } from "./processing-conditions";
import { initializeCallReportReadiness } from "./call-report-readiness";
import { serviceOrderKinds } from "./service-order-model";

export type SqlValue = string | number | null;

export interface Store {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...args: SqlValue[]): Record<string, SqlValue> | undefined;
    all(...args: SqlValue[]): Record<string, SqlValue>[];
    run(...args: SqlValue[]): void;
  };
  transaction<T>(run: () => T): T;
}

const communicationDraftColumns = `
  id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  audience TEXT NOT NULL, milestone TEXT NOT NULL, createdAt TEXT NOT NULL,
  emailCopiedAt TEXT, textCopiedAt TEXT, supersededAt TEXT, eventKey TEXT NOT NULL DEFAULT '',
  UNIQUE (loanId, contactId, audience, milestone, eventKey)
`;

const documentRequestColumns = `
  id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, instructions TEXT NOT NULL, requestedAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Received', 'Accepted', 'Needs replacement')),
  replacementNote TEXT NOT NULL DEFAULT '', submittedAt TEXT, revision INTEGER NOT NULL DEFAULT 0,
  dueOn TEXT, deadlineRevision INTEGER NOT NULL DEFAULT 0,
  recipient TEXT NOT NULL DEFAULT 'Primary borrower' CHECK (recipient IN ('Primary borrower', 'Co-borrower')),
  submissionId TEXT REFERENCES submissions(id) ON DELETE CASCADE, conditionId TEXT,
  CHECK ((submissionId IS NULL) = (conditionId IS NULL)),
  UNIQUE (submissionId, conditionId)
`;

const borrowerUploadAccessColumns = `
  loanId TEXT NOT NULL REFERENCES applications(loanId) ON DELETE CASCADE,
  recipient TEXT NOT NULL DEFAULT 'Primary borrower' CHECK (recipient IN ('Primary borrower', 'Co-borrower')),
  tokenHash TEXT NOT NULL, email TEXT NOT NULL, codeHash TEXT, codeUntil INTEGER NOT NULL,
  sendWindow INTEGER NOT NULL, sendCount INTEGER NOT NULL, sentAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  sessionHash TEXT, sessionUntil INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (loanId, recipient)
`;

const serviceOrderColumns = `
  id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN (${serviceOrderKinds.map((kind) => `'${kind}'`).join(", ")})),
  status TEXT NOT NULL DEFAULT 'Ordered' CHECK(status IN ('Ordered', 'Received', 'Completed', 'Cancelled')),
  dueOn TEXT NOT NULL, originalDueOn TEXT NOT NULL, createdAt TEXT NOT NULL, createdBy TEXT NOT NULL, note TEXT NOT NULL,
  returns TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0, cancellation TEXT, lastCommand TEXT
`;

const salesTargetColumns = `
  channel TEXT NOT NULL CHECK (channel IN ('Campaigns', 'Realtors', 'Lead sources')), windowDays INTEGER NOT NULL CHECK (windowDays IN (0, 7, 30, 90)),
  submitted INTEGER NOT NULL CHECK (submitted BETWEEN 1 AND 100), funded INTEGER NOT NULL CHECK (funded BETWEEN 1 AND 100),
  revision INTEGER NOT NULL CHECK (revision > 0), PRIMARY KEY(channel, windowDays)
`;

export function initializeStore(db: Store, seedDemo = true) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, role TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contact_merges (
      sourceId TEXT PRIMARY KEY, targetId TEXT NOT NULL, canonicalId TEXT NOT NULL,
      operationId TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, snapshot TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS contact_merges_by_canonical ON contact_merges(canonicalId);
    CREATE INDEX IF NOT EXISTS contact_merges_by_time ON contact_merges(at DESC, operationId DESC);
    CREATE TABLE IF NOT EXISTS contact_merge_undos (
      mergeId TEXT PRIMARY KEY, operationId TEXT NOT NULL UNIQUE, sourceId TEXT NOT NULL,
      actor TEXT NOT NULL, at TEXT NOT NULL, fingerprint TEXT NOT NULL, undoneBy TEXT NOT NULL, undoneAt TEXT NOT NULL,
      snapshot TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS contact_merge_undos_by_time ON contact_merge_undos(at DESC, mergeId DESC);
    CREATE TABLE IF NOT EXISTS contact_activity (
      id TEXT PRIMARY KEY, contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      officer TEXT NOT NULL, officerEmail TEXT, kind TEXT NOT NULL, outcome TEXT, text TEXT NOT NULL,
      createdAt TEXT NOT NULL, dueAt TEXT, completedAt TEXT, revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS contact_activity_by_contact ON contact_activity(contactId, createdAt);
    CREATE TABLE IF NOT EXISTS contact_follow_up_completions (
      activityId TEXT NOT NULL REFERENCES contact_activity(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, completedAt TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT,
      outcome TEXT, note TEXT NOT NULL, PRIMARY KEY (activityId, revision)
    );
    CREATE TABLE IF NOT EXISTS contact_callback_reschedules (
      activityId TEXT NOT NULL REFERENCES contact_activity(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, changedAt TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT,
      previousDueAt TEXT NOT NULL, dueAt TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (activityId, revision)
    );
    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY, contactId TEXT NOT NULL REFERENCES contacts(id),
      partnerId TEXT REFERENCES contacts(id), officer TEXT NOT NULL, address TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount >= 0), purpose TEXT NOT NULL,
      stage TEXT NOT NULL, stageSince TEXT NOT NULL, officerEmail TEXT
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      lender TEXT COLLATE NOCASE NOT NULL, externalId TEXT NOT NULL, status TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '[]', syncedAt TEXT,
      UNIQUE(lender, externalId)
    );
    CREATE TABLE IF NOT EXISTS mock_uwm_condition_events (
      submissionId TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      id TEXT NOT NULL, conditionId TEXT NOT NULL, category TEXT NOT NULL, version INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('Open', 'Cleared')), occurredAt TEXT NOT NULL, receivedAt TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('Applied', 'Ignored stale')), duplicates INTEGER NOT NULL DEFAULT 0, lastDuplicateAt TEXT,
      PRIMARY KEY (submissionId, id)
    );
    CREATE INDEX IF NOT EXISTS mock_uwm_applied_condition_version
      ON mock_uwm_condition_events(submissionId, conditionId, version DESC) WHERE outcome = 'Applied';
    CREATE INDEX IF NOT EXISTS mock_uwm_condition_event_order ON mock_uwm_condition_events(submissionId, receivedAt DESC, id DESC);
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      text TEXT NOT NULL, createdAt TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'Note'
    );
    CREATE TABLE IF NOT EXISTS application_handoff_events (
      activityId TEXT PRIMARY KEY REFERENCES activity(id) ON DELETE CASCADE,
      loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      applicationRevision INTEGER NOT NULL, lenderRevision INTEGER NOT NULL, outcome TEXT NOT NULL,
      submissionId TEXT REFERENCES submissions(id) ON DELETE SET NULL, followUpDueAt TEXT,
      exportProfile TEXT, exportDigest TEXT, quoteBasis TEXT
    );
    CREATE INDEX IF NOT EXISTS application_handoff_by_revision
      ON application_handoff_events(loanId, applicationRevision, lenderRevision);
    CREATE TABLE IF NOT EXISTS sample_preapproval_letters (
      loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE, version INTEGER NOT NULL,
      requestId TEXT NOT NULL UNIQUE, applicationRevision INTEGER NOT NULL, issuedAt TEXT NOT NULL,
      expiresOn TEXT NOT NULL, issuer TEXT NOT NULL, issuerEmail TEXT NOT NULL, amountCents INTEGER NOT NULL,
      scope TEXT NOT NULL, pdf TEXT NOT NULL, PRIMARY KEY (loanId, version)
    );
    CREATE TABLE IF NOT EXISTS sample_preapproval_shares (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL, version INTEGER NOT NULL,
      audience TEXT NOT NULL CHECK(audience IN ('Borrower', 'Realtor')), recipientId TEXT NOT NULL, recipientStamp TEXT NOT NULL,
      portalHash TEXT NOT NULL, publishedAt TEXT NOT NULL, publishedBy TEXT NOT NULL, revokedAt TEXT, firstDownloadedAt TEXT,
      FOREIGN KEY (loanId, version) REFERENCES sample_preapproval_letters(loanId, version) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sample_preapproval_active_shares ON sample_preapproval_shares(loanId, version, audience) WHERE revokedAt IS NULL;
    CREATE INDEX IF NOT EXISTS sample_preapproval_share_history ON sample_preapproval_shares(loanId, version);
    CREATE TRIGGER IF NOT EXISTS revoke_preapproval_after_recipient_change
      AFTER UPDATE OF contactId, partnerId ON loans
      WHEN OLD.contactId IS NOT NEW.contactId OR OLD.partnerId IS NOT NEW.partnerId
      BEGIN
        UPDATE sample_preapproval_shares SET revokedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE loanId = NEW.id AND revokedAt IS NULL AND (
          (audience = 'Borrower' AND OLD.contactId IS NOT NEW.contactId) OR
          (audience = 'Realtor' AND OLD.partnerId IS NOT NEW.partnerId));
      END;
    CREATE TABLE IF NOT EXISTS manual_return_follow_ups (
      activityId TEXT PRIMARY KEY REFERENCES activity(id) ON DELETE CASCADE,
      returnEventId TEXT NOT NULL REFERENCES application_handoff_events(activityId) ON DELETE CASCADE,
      actor TEXT NOT NULL, actorEmail TEXT NOT NULL, party TEXT NOT NULL, channel TEXT NOT NULL, note TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS manual_return_follow_ups_by_return ON manual_return_follow_ups(returnEventId);
    CREATE TABLE IF NOT EXISTS uwm_alerts (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      submissionId TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('Status changed', 'New condition', 'Reopened condition')),
      conditionId TEXT, message TEXT NOT NULL, detectedAt TEXT NOT NULL, reviewedAt TEXT,
      CHECK ((kind = 'Status changed') = (conditionId IS NULL))
    );
    CREATE INDEX IF NOT EXISTS uwm_alerts_by_loan ON uwm_alerts(loanId);
    CREATE INDEX IF NOT EXISTS uwm_alerts_by_submission ON uwm_alerts(submissionId);
    CREATE TABLE IF NOT EXISTS workspace_access_history (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_access_by_subject ON workspace_access_history(subject, createdAt);
    CREATE TABLE IF NOT EXISTS loan_audit (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      actor TEXT NOT NULL, action TEXT NOT NULL, occurredAt TEXT NOT NULL, changes TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS loan_audit_by_loan ON loan_audit(loanId, occurredAt);
    CREATE TABLE IF NOT EXISTS call_report_facts (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, facts TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS loan_scenario_plans (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, plan TEXT NOT NULL,
      revision INTEGER NOT NULL, updatedAt TEXT NOT NULL, updatedBy TEXT NOT NULL, applicationRevision INTEGER
    );
    CREATE TABLE IF NOT EXISTS applications (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, draft TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL, submittedAt TEXT, reviewedAt TEXT, uwmReference TEXT
    );
    CREATE TABLE IF NOT EXISTS application_address_quota (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      window INTEGER NOT NULL, requests INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS joint_applications (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, revokedAt TEXT,
      draft TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL, submittedAt TEXT, primarySubmittedAt TEXT, correctionNote TEXT NOT NULL DEFAULT '',
      confirmedDemo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS application_lender_details (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      details TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_requests (${documentRequestColumns});
    CREATE TABLE IF NOT EXISTS borrower_question_sets (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL, config TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_borrower_question_set_titles ON borrower_question_sets(title COLLATE NOCASE) WHERE archived = 0;
    CREATE TABLE IF NOT EXISTS borrower_question_set_batches (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      setId TEXT NOT NULL REFERENCES borrower_question_sets(id), setRevision INTEGER NOT NULL, title TEXT NOT NULL,
      applicationRevision INTEGER NOT NULL, selection TEXT NOT NULL, appliedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS borrower_questions (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      recipient TEXT NOT NULL CHECK(recipient IN ('Primary borrower', 'Co-borrower')),
      prompt TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('Short answer', 'Yes or no')), dueOn TEXT,
      status TEXT NOT NULL DEFAULT 'Requested' CHECK(status IN ('Requested', 'Answered', 'Needs clarification', 'Reviewed', 'Cancelled')),
      revision INTEGER NOT NULL DEFAULT 0, requestedAt TEXT NOT NULL, askedBy TEXT NOT NULL,
      answer TEXT, answeredAt TEXT, clarification TEXT NOT NULL DEFAULT '', reviewedAt TEXT, reviewedBy TEXT,
      setBatchId TEXT REFERENCES borrower_question_set_batches(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS borrower_questions_by_loan ON borrower_questions(loanId, recipient);
    CREATE INDEX IF NOT EXISTS answered_borrower_questions ON borrower_questions(answeredAt DESC, id DESC, loanId) WHERE status = 'Answered';
    CREATE TABLE IF NOT EXISTS borrower_question_answers (
      questionId TEXT NOT NULL REFERENCES borrower_questions(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, answer TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (questionId, revision)
    );
    CREATE TABLE IF NOT EXISTS service_orders (${serviceOrderColumns});
    CREATE TABLE IF NOT EXISTS document_checklist_templates (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, purpose TEXT NOT NULL, revision INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_document_checklist_title
      ON document_checklist_templates(title COLLATE NOCASE) WHERE archived = 0;
    CREATE TABLE IF NOT EXISTS document_checklist_versions (
      templateId TEXT NOT NULL REFERENCES document_checklist_templates(id), revision INTEGER NOT NULL,
      config TEXT NOT NULL, publishedAt TEXT NOT NULL, publishedBy TEXT NOT NULL,
      PRIMARY KEY(templateId, revision)
    );
    CREATE TABLE IF NOT EXISTS document_checklist_origins (
      requestId TEXT PRIMARY KEY REFERENCES document_requests(id) ON DELETE CASCADE,
      templateId TEXT NOT NULL, revision INTEGER NOT NULL, applicationRevision INTEGER,
      FOREIGN KEY(templateId, revision) REFERENCES document_checklist_versions(templateId, revision)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      title TEXT NOT NULL, dueAt TEXT NOT NULL, completedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS disclosure_packages (
      loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      runId TEXT NOT NULL, offerId TEXT NOT NULL, applicationRevision INTEGER NOT NULL, feeRevision INTEGER NOT NULL,
      quote TEXT NOT NULL, documents TEXT NOT NULL, signers TEXT NOT NULL, preparedAt TEXT NOT NULL, signBy TEXT NOT NULL,
      issuedAt TEXT, supersededAt TEXT, reviewReason TEXT, declineFollowUp TEXT, changeReview TEXT, deadlineBasis TEXT, templateBasis TEXT,
      PRIMARY KEY (loanId, version)
    );
    CREATE TABLE IF NOT EXISTS disclosure_calendar_versions (
      version INTEGER PRIMARY KEY, rules TEXT NOT NULL, publishedAt TEXT NOT NULL, publishedBy TEXT NOT NULL, note TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brokerage_disclosure_templates (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL, purpose TEXT NOT NULL, propertyState TEXT NOT NULL,
      config TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_disclosure_template_titles
      ON brokerage_disclosure_templates(title COLLATE NOCASE) WHERE archived = 0;
    CREATE TABLE IF NOT EXISTS loan_stage_edit_versions (
      revision INTEGER PRIMARY KEY, rules TEXT NOT NULL, reason TEXT NOT NULL, publishedAt TEXT NOT NULL, publishedBy TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closing_gate_versions (
      revision INTEGER PRIMARY KEY, rules TEXT NOT NULL, reason TEXT NOT NULL, publishedAt TEXT NOT NULL, publishedBy TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mock_uwm_acceptances (
      loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, attemptedAt TEXT NOT NULL, reference TEXT NOT NULL, receipt TEXT NOT NULL,
      reconciledAt TEXT, PRIMARY KEY (loanId, revision)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS mock_uwm_one_pending_acceptance ON mock_uwm_acceptances(loanId) WHERE reconciledAt IS NULL;
    CREATE TABLE IF NOT EXISTS closing_disclosure_reviews (
      loanId TEXT NOT NULL, version INTEGER NOT NULL, revision INTEGER NOT NULL,
      reviewedAt TEXT NOT NULL, actor TEXT NOT NULL,
      PRIMARY KEY (loanId, version, revision),
      FOREIGN KEY (loanId, version) REFERENCES disclosure_packages(loanId, version) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS closing_packets (
      loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, preparedAt TEXT NOT NULL, preparedBy TEXT NOT NULL, snapshot TEXT NOT NULL, pdf TEXT,
      PRIMARY KEY (loanId, version)
    );
    CREATE TABLE IF NOT EXISTS communication_drafts (${communicationDraftColumns});
    CREATE TABLE IF NOT EXISTS past_client_profiles (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      closingDate TEXT, currentRate REAL, targetRate REAL, observedRate REAL, checkedAt TEXT,
      watchEnabled INTEGER NOT NULL DEFAULT 0, rateTriggered INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS brokerage_templates (
      audience TEXT NOT NULL, milestone TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL,
      PRIMARY KEY (audience, milestone)
    );
    CREATE TABLE IF NOT EXISTS closing_plans (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, targetDate TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closing_items (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      title TEXT NOT NULL, owner TEXT NOT NULL, dueDate TEXT NOT NULL, completedAt TEXT, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS closing_items_by_loan ON closing_items(loanId, completedAt, dueDate, id);
    CREATE TABLE IF NOT EXISTS closing_progress (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      fundingDate TEXT, disclosureStatus TEXT NOT NULL DEFAULT 'Not started', disclosureDate TEXT,
      preFundingStage TEXT, preFundingStageSince TEXT,
      revision INTEGER NOT NULL DEFAULT 0, fundingCycle INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS closing_plans_by_target ON closing_plans(targetDate, loanId);
    CREATE TABLE IF NOT EXISTS loan_financials (
      loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE, cycle INTEGER NOT NULL, fundingDate TEXT NOT NULL, reversedAt TEXT,
      expectedCents INTEGER, commissionCents INTEGER, expenseReviewed INTEGER NOT NULL DEFAULT 0,
      receiptsCents INTEGER NOT NULL DEFAULT 0, expensesCents INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (loanId, cycle)
    );
    CREATE INDEX IF NOT EXISTS reversed_financials_by_date ON loan_financials(fundingDate, loanId, cycle) WHERE reversedAt IS NOT NULL;
    CREATE TABLE IF NOT EXISTS settlement_events (
      loanId TEXT NOT NULL, cycle INTEGER NOT NULL, revision INTEGER NOT NULL,
      id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, receiptReference TEXT, amountCents INTEGER,
      reversesId TEXT UNIQUE, at TEXT NOT NULL, actorName TEXT NOT NULL, actorEmail TEXT NOT NULL, request TEXT NOT NULL,
      PRIMARY KEY (loanId, cycle, revision),
      FOREIGN KEY (loanId, cycle) REFERENCES loan_financials(loanId, cycle) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS settlement_unique_receipt ON settlement_events(loanId, cycle, receiptReference COLLATE NOCASE)
      WHERE receiptReference IS NOT NULL;
    CREATE INDEX IF NOT EXISTS settlement_evidence_by_kind ON settlement_events(loanId, cycle, kind, revision);
    CREATE TABLE IF NOT EXISTS settlement_fee_events (
      loanId TEXT NOT NULL, cycle INTEGER NOT NULL, revision INTEGER NOT NULL, id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('Statement', 'Review')), fundingDate TEXT NOT NULL,
      at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL, note TEXT NOT NULL,
      baseline TEXT NOT NULL, statement TEXT NOT NULL, request TEXT NOT NULL,
      differenceCount INTEGER NOT NULL, missingCount INTEGER NOT NULL, supersededAt TEXT,
      PRIMARY KEY(loanId, cycle, revision),
      FOREIGN KEY(loanId, cycle) REFERENCES loan_financials(loanId, cycle) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS current_settlement_fee_event ON settlement_fee_events(loanId, cycle) WHERE supersededAt IS NULL;
    CREATE INDEX IF NOT EXISTS settlement_fee_differences_by_date ON settlement_fee_events(at DESC, loanId DESC, cycle DESC)
      WHERE supersededAt IS NULL AND differenceCount > 0;
    CREATE TABLE IF NOT EXISTS loan_financial_entries (
      sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, loanId TEXT NOT NULL, cycle INTEGER NOT NULL,
      kind TEXT NOT NULL, amountCents INTEGER, occurredOn TEXT NOT NULL, reference TEXT NOT NULL, note TEXT NOT NULL,
      reversesId TEXT UNIQUE, at TEXT NOT NULL, actorName TEXT NOT NULL, actorEmail TEXT NOT NULL, request TEXT NOT NULL,
      FOREIGN KEY (loanId, cycle) REFERENCES loan_financials(loanId, cycle) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS loan_financial_entries_by_cycle ON loan_financial_entries(loanId, cycle, sequence DESC);
    CREATE TABLE IF NOT EXISTS playbook_runs (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE, fundingDate TEXT NOT NULL,
      fundingRevision INTEGER NOT NULL, ruleRevision INTEGER NOT NULL, delayDays INTEGER NOT NULL, dueAt TEXT NOT NULL,
      rescheduleOpen INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('Failed', 'Completed', 'Superseded')),
      reason TEXT NOT NULL, attemptCount INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL, UNIQUE (loanId, fundingRevision)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_playbook_run_by_loan ON playbook_runs(loanId) WHERE status <> 'Superseded';
    CREATE INDEX IF NOT EXISTS playbook_runs_by_time ON playbook_runs(at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS playbook_runs_by_status ON playbook_runs(status, at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS playbook_run_attempts (
      runId TEXT NOT NULL REFERENCES playbook_runs(id) ON DELETE CASCADE, attempt INTEGER NOT NULL, operationId TEXT NOT NULL,
      mode TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, taskChanges INTEGER NOT NULL,
      PRIMARY KEY (runId, attempt), UNIQUE (runId, operationId)
    );
    CREATE TABLE IF NOT EXISTS loan_appointments (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      title TEXT NOT NULL, startsAt TEXT NOT NULL, durationMinutes INTEGER NOT NULL CHECK (durationMinutes BETWEEN 5 AND 480),
      ownerRole TEXT NOT NULL CHECK (ownerRole IN ('Loan officer', 'Processor')),
      cancelledAt TEXT, revision INTEGER NOT NULL CHECK (revision > 0)
    );
    CREATE INDEX IF NOT EXISTS loan_appointments_by_loan ON loan_appointments(loanId, startsAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS active_appointments_by_start ON loan_appointments(startsAt, id) WHERE cancelledAt IS NULL;
    CREATE TABLE IF NOT EXISTS staff_coverage (
      id TEXT PRIMARY KEY, absentEmail TEXT NOT NULL, absentName TEXT NOT NULL, absentRole TEXT NOT NULL,
      backupEmail TEXT NOT NULL, backupName TEXT NOT NULL, backupRole TEXT NOT NULL,
      startsOn TEXT NOT NULL, endsOn TEXT NOT NULL, endedAt TEXT,
      absentAccessRevision INTEGER NOT NULL DEFAULT 0, backupAccessRevision INTEGER NOT NULL DEFAULT 0,
      CHECK (startsOn <= endsOn), CHECK (absentEmail <> backupEmail)
    );
    CREATE INDEX IF NOT EXISTS staff_coverage_by_backup ON staff_coverage(backupEmail, startsOn, id);
    CREATE INDEX IF NOT EXISTS staff_coverage_by_absent ON staff_coverage(absentEmail, startsOn, id);
    CREATE INDEX IF NOT EXISTS staff_coverage_by_start ON staff_coverage(startsOn, id);
    CREATE TABLE IF NOT EXISTS coverage_operations (
      id TEXT PRIMARY KEY, coverageId TEXT NOT NULL REFERENCES staff_coverage(id) ON DELETE CASCADE,
      actor TEXT NOT NULL, request TEXT NOT NULL, message TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loan_reviews (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT NOT NULL,
      requesterEmail TEXT NOT NULL, requesterName TEXT NOT NULL, reviewerEmail TEXT NOT NULL, reviewerName TEXT NOT NULL,
      reviewerRole TEXT NOT NULL, reviewerAccessRevision INTEGER NOT NULL, dueOn TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Requested', 'Changes requested', 'Approved', 'Canceled')),
      applicationRevision INTEGER, escalatedAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0), CHECK (requesterEmail <> reviewerEmail)
    );
    CREATE INDEX IF NOT EXISTS loan_reviews_by_loan ON loan_reviews(loanId, status, dueOn, id);
    CREATE INDEX IF NOT EXISTS loan_reviews_by_reviewer ON loan_reviews(reviewerEmail, dueOn, id);
    CREATE INDEX IF NOT EXISTS loan_reviews_by_requester ON loan_reviews(requesterEmail, dueOn, id);
    CREATE INDEX IF NOT EXISTS approved_second_reviews_by_revision ON loan_reviews(loanId, applicationRevision)
      WHERE category = '1003 second review' AND status = 'Approved';
    CREATE TABLE IF NOT EXISTS application_review_routing_blocks (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, applicationRevision INTEGER NOT NULL,
      dueOn TEXT NOT NULL, policyRevision INTEGER NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS application_review_routing_blocks_by_due ON application_review_routing_blocks(dueOn, loanId);
    CREATE INDEX IF NOT EXISTS open_loan_reviews_by_due ON loan_reviews(dueOn, id) WHERE status IN ('Requested', 'Changes requested');
    CREATE INDEX IF NOT EXISTS open_loan_reviews_by_current_owner ON loan_reviews(
      (CASE status WHEN 'Changes requested' THEN requesterEmail ELSE reviewerEmail END), dueOn, id)
      WHERE status IN ('Requested', 'Changes requested');
    CREATE TABLE IF NOT EXISTS loan_review_events (
      sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, reviewId TEXT NOT NULL REFERENCES loan_reviews(id) ON DELETE CASCADE,
      actorEmail TEXT NOT NULL, actorName TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL, at TEXT NOT NULL, request TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS loan_review_events_by_review ON loan_review_events(reviewId, sequence DESC);
    CREATE INDEX IF NOT EXISTS loan_review_schedule_events ON loan_review_events(reviewId, sequence DESC)
      WHERE action IN ('Requested', 'Changes requested', 'Resubmitted', 'Reassigned');
    CREATE TABLE IF NOT EXISTS loan_review_preflight (
      eventId TEXT PRIMARY KEY REFERENCES loan_review_events(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_preflight_by_loan ON loan_reviews(loanId)
      WHERE category = 'File preflight' AND status IN ('Requested', 'Changes requested');
    CREATE TABLE IF NOT EXISTS loan_review_notices (
      eventId TEXT NOT NULL REFERENCES loan_review_events(id) ON DELETE CASCADE,
      recipientEmail TEXT NOT NULL, recipientRole TEXT NOT NULL, recipientRevision INTEGER NOT NULL,
      label TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (eventId, recipientEmail)
    );
    CREATE INDEX IF NOT EXISTS loan_review_notices_by_recipient ON loan_review_notices(recipientEmail, recipientRevision, recipientRole, at DESC, eventId DESC);
    CREATE TABLE IF NOT EXISTS loan_review_notice_reads (
      reviewId TEXT NOT NULL REFERENCES loan_reviews(id) ON DELETE CASCADE, noticeId TEXT NOT NULL,
      recipientEmail TEXT NOT NULL, recipientRevision INTEGER NOT NULL, recipientRole TEXT NOT NULL,
      PRIMARY KEY (reviewId, noticeId, recipientEmail, recipientRevision, recipientRole)
    );
    CREATE INDEX IF NOT EXISTS closing_progress_by_funding ON closing_progress(fundingDate, loanId) WHERE fundingDate IS NOT NULL;
    CREATE TABLE IF NOT EXISTS funding_dashboard_views (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, filters TEXT NOT NULL, deletedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS funding_dashboard_view_names ON funding_dashboard_views(name COLLATE NOCASE) WHERE deletedAt IS NULL;
    CREATE TABLE IF NOT EXISTS funding_monthly_targets (
      month TEXT PRIMARY KEY, loanCount INTEGER NOT NULL CHECK (loanCount > 0), volume INTEGER NOT NULL CHECK (volume > 0),
      revision INTEGER NOT NULL CHECK (revision > 0)
    );
    CREATE TABLE IF NOT EXISTS officer_monthly_targets (
      officerEmail TEXT NOT NULL, month TEXT NOT NULL, loanCount INTEGER NOT NULL CHECK (loanCount > 0),
      volume INTEGER NOT NULL CHECK (volume > 0), revision INTEGER NOT NULL CHECK (revision > 0), PRIMARY KEY (officerEmail, month)
    );
    CREATE TABLE IF NOT EXISTS sales_dashboard_views (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, filters TEXT NOT NULL, deletedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sales_dashboard_view_names ON sales_dashboard_views(name COLLATE NOCASE) WHERE deletedAt IS NULL;
    CREATE TABLE IF NOT EXISTS owner_scorecard_views (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, filters TEXT NOT NULL, deletedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS owner_scorecard_view_names ON owner_scorecard_views(name COLLATE NOCASE) WHERE deletedAt IS NULL;
    CREATE TABLE IF NOT EXISTS custom_reports (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, archivedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS custom_report_names ON custom_reports(name COLLATE NOCASE) WHERE archivedAt IS NULL;
    CREATE TABLE IF NOT EXISTS processing_dashboard_views (
      scope TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, filters TEXT NOT NULL, deletedAt TEXT,
      PRIMARY KEY (scope, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS processing_dashboard_view_names ON processing_dashboard_views(scope, name COLLATE NOCASE) WHERE deletedAt IS NULL;
    CREATE TABLE IF NOT EXISTS sales_conversion_targets (${salesTargetColumns});
    CREATE TABLE IF NOT EXISTS funding_check_ins (
      activityId TEXT PRIMARY KEY REFERENCES contact_activity(id) ON DELETE CASCADE,
      loanId TEXT REFERENCES loans(id) ON DELETE SET NULL,
      fundingRevision INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS funding_check_ins_by_loan ON funding_check_ins(loanId);
    CREATE TABLE IF NOT EXISTS returning_client_loans (
      fundedLoanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      loanId TEXT NOT NULL UNIQUE REFERENCES loans(id) ON DELETE CASCADE,
      CHECK (fundedLoanId <> loanId)
    );
    CREATE TABLE IF NOT EXISTS loan_processing (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      processorEmail TEXT, processorName TEXT NOT NULL, status TEXT NOT NULL,
      note TEXT NOT NULL, updatedAt TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS processing_by_assignee ON loan_processing(processorEmail, loanId);
    CREATE INDEX IF NOT EXISTS processing_by_updated ON loan_processing(updatedAt, loanId);
    CREATE INDEX IF NOT EXISTS processing_by_assignee_updated ON loan_processing(processorEmail, updatedAt, loanId);
    CREATE TABLE IF NOT EXISTS loan_conversations (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      audience TEXT NOT NULL CHECK (audience IN ('Borrower','Realtor')),
      ownerRole TEXT NOT NULL CHECK (ownerRole IN ('Loan officer','Processor')),
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Needs reply','Waiting on contact','Closed')),
      unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0,1)), dueOn TEXT,
      updatedAt TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      UNIQUE(loanId, audience, contactId)
    );
    CREATE INDEX IF NOT EXISTS conversations_by_update ON loan_conversations(updatedAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS conversations_by_status ON loan_conversations(status, updatedAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS conversations_by_unread ON loan_conversations(updatedAt DESC, id DESC) WHERE unread = 1;
    CREATE INDEX IF NOT EXISTS conversations_by_due ON loan_conversations(dueOn, id) WHERE dueOn IS NOT NULL AND status <> 'Closed';
    CREATE INDEX IF NOT EXISTS loan_conversations_by_contact ON loan_conversations(contactId, id);
    CREATE TABLE IF NOT EXISTS conversation_events (
      id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES loan_conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('Inbound','Outbound','Note','State')),
      channel TEXT CHECK (channel IN ('Call','Email','Text')), origin TEXT NOT NULL CHECK (origin IN ('Manual log','Simulated','Internal')),
      text TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL, at TEXT NOT NULL, request TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_events_by_thread ON conversation_events(conversationId, at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS lead_conversations (
      id TEXT PRIMARY KEY, leadId TEXT NOT NULL UNIQUE REFERENCES referral_leads(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Needs reply','Waiting on contact','Closed')),
      unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0,1)), dueOn TEXT,
      updatedAt TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS lead_conversations_by_update ON lead_conversations(updatedAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS lead_conversations_by_due ON lead_conversations(dueOn, id) WHERE dueOn IS NOT NULL AND status <> 'Closed';
    CREATE INDEX IF NOT EXISTS lead_conversations_by_reply ON lead_conversations(updatedAt DESC, id DESC) WHERE status = 'Needs reply';
    CREATE TABLE IF NOT EXISTS lead_conversation_events (
      id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES lead_conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('Inbound','Outbound','Note','State')),
      channel TEXT CHECK (channel IN ('Call','Email','Text')), origin TEXT NOT NULL CHECK (origin IN ('Manual log','Simulated','Internal')),
      text TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL, at TEXT NOT NULL, request TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lead_conversation_events_by_thread ON lead_conversation_events(conversationId, at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS contact_conversations (
      id TEXT PRIMARY KEY, contactId TEXT NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
      ownerEmail TEXT NOT NULL, ownerName TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Needs reply','Waiting on contact','Closed')),
      unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0,1)), dueOn TEXT,
      updatedAt TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS contact_conversations_by_update ON contact_conversations(updatedAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS contact_conversations_by_owner ON contact_conversations(ownerEmail, updatedAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS contact_conversations_open_by_owner ON contact_conversations(ownerEmail, id) WHERE status <> 'Closed';
    CREATE INDEX IF NOT EXISTS contact_conversations_by_due ON contact_conversations(dueOn, id) WHERE dueOn IS NOT NULL AND status <> 'Closed';
    CREATE INDEX IF NOT EXISTS contact_conversations_by_reply ON contact_conversations(ownerEmail, updatedAt DESC, id DESC) WHERE status = 'Needs reply';
    CREATE TABLE IF NOT EXISTS contact_conversation_events (
      id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES contact_conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('Inbound','Outbound','Note','State')),
      channel TEXT CHECK (channel IN ('Call','Email','Text')), origin TEXT NOT NULL CHECK (origin IN ('Manual log','Simulated','Internal')),
      text TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL, at TEXT NOT NULL, request TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS contact_conversation_events_by_thread ON contact_conversation_events(conversationId, at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS inbound_replies (
      id TEXT PRIMARY KEY, channel TEXT NOT NULL CHECK (channel IN ('Email','Text')), sourceId TEXT NOT NULL,
      senderKey TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Linked','Dismissed')),
      replayCount INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
      conversationId TEXT REFERENCES loan_conversations(id) ON DELETE SET NULL,
      resolvedAt TEXT, resolvedBy TEXT, UNIQUE(channel, sourceId)
    );
    CREATE INDEX IF NOT EXISTS inbound_replies_by_status ON inbound_replies(status, at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS submissions_by_loan ON submissions(loanId);
    CREATE INDEX IF NOT EXISTS contacts_by_name ON contacts(name COLLATE NOCASE, id);
    CREATE INDEX IF NOT EXISTS contacts_realtors_by_name ON contacts(name COLLATE NOCASE, id) WHERE role = 'Realtor';
    CREATE INDEX IF NOT EXISTS closing_items_by_loan ON closing_items(loanId, dueDate);
    CREATE TABLE IF NOT EXISTS realtor_portals (
      realtorId TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, officerEmail TEXT, officer TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS referral_leads (
      id TEXT PRIMARY KEY, requestId TEXT NOT NULL, realtorId TEXT REFERENCES contacts(id) ON DELETE CASCADE,
      name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, purpose TEXT NOT NULL,
      officer TEXT NOT NULL, officerEmail TEXT, createdAt TEXT NOT NULL, dueAt TEXT NOT NULL,
      resolvedAt TEXT, loanId TEXT UNIQUE REFERENCES loans(id) ON DELETE SET NULL, zip TEXT NOT NULL DEFAULT '',
      realtorSharedSince TEXT, UNIQUE (realtorId, requestId)
    );
    CREATE INDEX IF NOT EXISTS referral_leads_by_realtor ON referral_leads(realtorId, createdAt);
    CREATE TABLE IF NOT EXISTS pilot_scenario (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), id TEXT NOT NULL, realtorId TEXT NOT NULL,
      loanId TEXT NOT NULL, loadedAt TEXT NOT NULL, officerEmail TEXT NOT NULL, presenter INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pilot_sample_contacts (
      contactId TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pilot_feedback (
      id TEXT PRIMARY KEY, author TEXT NOT NULL, step TEXT NOT NULL, message TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pilot_measurements (
      id TEXT PRIMARY KEY, walkthrough TEXT NOT NULL, workflow TEXT NOT NULL, seconds INTEGER NOT NULL,
      repeatEntries INTEGER NOT NULL, systemSwitches INTEGER NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pilot_benchmarks (
      id TEXT PRIMARY KEY, walkthrough TEXT NOT NULL, caseLabel TEXT NOT NULL,
      orbit TEXT NOT NULL, baseline TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mock_credit_aus_runs (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      service TEXT NOT NULL CHECK (service IN ('Credit', 'DU', 'LPA')), reference TEXT NOT NULL,
      creditId TEXT REFERENCES mock_credit_aus_runs(id), retryOf TEXT REFERENCES mock_credit_aus_runs(id),
      requestedBy TEXT NOT NULL, requestedAt TEXT NOT NULL, result TEXT NOT NULL,
      applicationRevision INTEGER, authorization TEXT, batchId TEXT, requestKey TEXT,
      CHECK ((service = 'Credit') = (creditId IS NULL))
    );
    CREATE INDEX IF NOT EXISTS mock_credit_aus_by_loan ON mock_credit_aus_runs(loanId, service);
    CREATE TABLE IF NOT EXISTS pricing_runs (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, mode TEXT NOT NULL, reference TEXT, scenario TEXT NOT NULL,
      offers TEXT NOT NULL, notices TEXT NOT NULL, quotedAt TEXT NOT NULL, selectedId TEXT, selectedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS pricing_by_loan ON pricing_runs(loanId, quotedAt);
    CREATE TABLE IF NOT EXISTS loan_income_worksheets (
      loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
      applicationRevision INTEGER NOT NULL, stage TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL,
      sources TEXT NOT NULL, evidence TEXT NOT NULL, note TEXT NOT NULL, updatedBy TEXT NOT NULL, updatedAt TEXT NOT NULL,
      requestId TEXT NOT NULL UNIQUE, requestHash TEXT NOT NULL, PRIMARY KEY (loanId, revision)
    );
    CREATE TABLE IF NOT EXISTS brokerage_fee_templates (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      effectiveOn TEXT NOT NULL, purpose TEXT NOT NULL, zip TEXT NOT NULL, config TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_fee_template_title ON brokerage_fee_templates(title COLLATE NOCASE) WHERE archived = 0;
    CREATE TABLE IF NOT EXISTS fee_worksheets (
      runId TEXT NOT NULL REFERENCES pricing_runs(id) ON DELETE CASCADE, offerId TEXT NOT NULL,
      inputs TEXT NOT NULL, revision INTEGER NOT NULL, origin TEXT, PRIMARY KEY (runId, offerId)
    );
    CREATE TABLE IF NOT EXISTS published_quotes (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      runId TEXT NOT NULL, offerId TEXT NOT NULL, product TEXT NOT NULL,
      rate REAL NOT NULL, principalAndInterest REAL NOT NULL, quotedAt TEXT NOT NULL, publishedAt TEXT NOT NULL, presentation TEXT,
      expiresOn TEXT, reviewReason TEXT, reviewRevision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS shared_quote_history (
      loanId TEXT NOT NULL REFERENCES applications(loanId) ON DELETE CASCADE,
      runId TEXT NOT NULL, offerId TEXT NOT NULL, product TEXT NOT NULL,
      rate REAL NOT NULL, principalAndInterest REAL NOT NULL, quotedAt TEXT NOT NULL, publishedAt TEXT NOT NULL,
      endedAt TEXT NOT NULL, outcome TEXT NOT NULL, presentation TEXT, expiresOn TEXT
    );
    CREATE TABLE IF NOT EXISTS mock_uwm_rates (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      submissionId TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      loanNumber TEXT NOT NULL, runId TEXT NOT NULL, offerId TEXT NOT NULL,
      product TEXT NOT NULL, rate REAL NOT NULL, quotedAt TEXT NOT NULL,
      floatReference TEXT NOT NULL UNIQUE, floatedAt TEXT NOT NULL,
      lockReference TEXT UNIQUE, lockedAt TEXT, lockDays INTEGER, lockExpiresAt TEXT
    );
    CREATE TABLE IF NOT EXISTS staff_google_attempts (
      state TEXT PRIMARY KEY, browserHash TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL,
      expiresAt INTEGER NOT NULL, brokerageId TEXT, guide TEXT
    );
    CREATE TABLE IF NOT EXISTS staff_sessions (
      tokenHash TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
  `);
  db.transaction(() => {
    initializeSettlementSummaries(db);
    const serviceSchema = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'service_orders'").get()?.sql ?? "");
    if (serviceOrderKinds.some((kind) => !serviceSchema.includes(`'${kind}'`))) {
      const columns = "id, loanId, kind, status, dueOn, originalDueOn, createdAt, createdBy, note, returns, revision, cancellation, lastCommand";
      db.exec(`CREATE TABLE service_orders_next (${serviceOrderColumns});
        INSERT INTO service_orders_next (${columns}) SELECT ${columns} FROM service_orders;
        DROP TABLE service_orders;
        ALTER TABLE service_orders_next RENAME TO service_orders;`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS service_orders_by_loan ON service_orders(loanId);
      CREATE UNIQUE INDEX IF NOT EXISTS open_service_orders_by_kind ON service_orders(loanId, kind) WHERE status IN ('Ordered', 'Received');
      CREATE INDEX IF NOT EXISTS open_service_orders_by_due ON service_orders(dueOn, id) WHERE status IN ('Ordered', 'Received');
      CREATE TABLE IF NOT EXISTS closing_service_evidence (
        itemId TEXT NOT NULL REFERENCES closing_items(id) ON DELETE CASCADE,
        orderId TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
        reference TEXT NOT NULL, linkedAt TEXT NOT NULL, linkedBy TEXT NOT NULL,
        PRIMARY KEY (itemId, orderId, reference)
      );
      CREATE INDEX IF NOT EXISTS closing_service_evidence_by_order ON closing_service_evidence(orderId);`);
    if (!db.prepare("PRAGMA table_info(document_checklist_origins)").all().some(({ name }) => name === "applicationRevision")) {
      db.exec("ALTER TABLE document_checklist_origins ADD COLUMN applicationRevision INTEGER");
    }
    if (!db.prepare("PRAGMA table_info(pilot_scenario)").all().some((column) => column.name === "presenter")) {
      db.exec("ALTER TABLE pilot_scenario ADD COLUMN presenter INTEGER NOT NULL DEFAULT 0");
    }
    if (!db.prepare("PRAGMA table_info(closing_progress)").all().some((column) => column.name === "preFundingStage")) {
      db.exec(`ALTER TABLE closing_progress ADD COLUMN preFundingStage TEXT;
        ALTER TABLE closing_progress ADD COLUMN preFundingStageSince TEXT;`);
    }
    if (!db.prepare("PRAGMA table_info(closing_progress)").all().some((column) => column.name === "fundingCycle")) {
      db.exec("ALTER TABLE closing_progress ADD COLUMN fundingCycle INTEGER NOT NULL DEFAULT 1");
    }
    const handoffColumns = new Set(db.prepare("PRAGMA table_info(application_handoff_events)").all().map(({ name }) => name));
    if (!handoffColumns.has("submissionId")) {
      db.exec("ALTER TABLE application_handoff_events ADD COLUMN submissionId TEXT REFERENCES submissions(id) ON DELETE SET NULL");
    }
    if (!handoffColumns.has("followUpDueAt")) db.exec("ALTER TABLE application_handoff_events ADD COLUMN followUpDueAt TEXT");
    if (!handoffColumns.has("exportProfile")) db.exec("ALTER TABLE application_handoff_events ADD COLUMN exportProfile TEXT");
    if (!handoffColumns.has("exportDigest")) db.exec("ALTER TABLE application_handoff_events ADD COLUMN exportDigest TEXT");
    if (!handoffColumns.has("quoteBasis")) db.exec("ALTER TABLE application_handoff_events ADD COLUMN quoteBasis TEXT");
    linkLegacyCampaignAcknowledgments(db);
    if (!db.prepare("PRAGMA table_info(communication_drafts)").all().some((column) => column.name === "eventKey")) {
      const columns = "id, loanId, contactId, audience, milestone, createdAt, emailCopiedAt, textCopiedAt";
      db.exec(`CREATE TABLE communication_drafts_next (${communicationDraftColumns});
        INSERT INTO communication_drafts_next (${columns}) SELECT ${columns} FROM communication_drafts ORDER BY rowid;
        DROP TABLE communication_drafts;
        ALTER TABLE communication_drafts_next RENAME TO communication_drafts;
        UPDATE communication_drafts AS earlier SET supersededAt = (
          SELECT later.createdAt FROM communication_drafts later WHERE later.loanId = earlier.loanId
            AND later.contactId = earlier.contactId AND later.audience = 'Realtor'
            AND later.milestone IN ('Lender review started', 'Lender review complete')
            AND (later.createdAt, later.rowid) > (earlier.createdAt, earlier.rowid)
          ORDER BY later.createdAt, later.rowid LIMIT 1
        ) WHERE earlier.audience = 'Realtor' AND earlier.milestone IN ('Lender review started', 'Lender review complete');`);
    }
    if (!db.prepare("PRAGMA table_info(referral_leads)").all().some((column) => column.name === "zip")) {
      db.exec(`CREATE TABLE referral_leads_next (
        id TEXT PRIMARY KEY, requestId TEXT NOT NULL, realtorId TEXT REFERENCES contacts(id) ON DELETE CASCADE,
        name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, purpose TEXT NOT NULL,
        officer TEXT NOT NULL, officerEmail TEXT, createdAt TEXT NOT NULL, dueAt TEXT NOT NULL,
        resolvedAt TEXT, loanId TEXT UNIQUE REFERENCES loans(id) ON DELETE SET NULL, zip TEXT NOT NULL DEFAULT '',
        UNIQUE (realtorId, requestId)
      );
      INSERT INTO referral_leads_next (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, resolvedAt, loanId)
        SELECT id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, resolvedAt, loanId FROM referral_leads;
      DROP TABLE referral_leads;
      ALTER TABLE referral_leads_next RENAME TO referral_leads;
      CREATE INDEX referral_leads_by_realtor ON referral_leads(realtorId, createdAt);`);
    }
    if (!db.prepare("PRAGMA table_info(referral_leads)").all().some((column) => column.name === "importSource")) {
      db.exec(`ALTER TABLE referral_leads ADD COLUMN importSource TEXT;
        ALTER TABLE referral_leads ADD COLUMN importedContactId TEXT REFERENCES contacts(id) ON DELETE SET NULL;`);
    }
    if (!db.prepare("PRAGMA table_info(referral_leads)").all().some((column) => column.name === "heldAt")) {
      db.exec(`ALTER TABLE referral_leads ADD COLUMN heldAt TEXT;
        ALTER TABLE referral_leads ADD COLUMN holdReason TEXT;
        ALTER TABLE referral_leads ADD COLUMN revisitDate TEXT;`);
    }
    if (!db.prepare("PRAGMA table_info(referral_leads)").all().some((column) => column.name === "archiveToken")) {
      db.exec(`ALTER TABLE referral_leads ADD COLUMN archiveToken TEXT;
        UPDATE referral_leads SET archiveToken = audit.id
        FROM workspace_access_history audit
        WHERE audit.subject = referral_leads.id AND audit.createdAt = referral_leads.resolvedAt
          AND referral_leads.loanId IS NULL AND audit.action IN ('Dismissed imported lead', 'Dismissed referral', 'Dismissed quote request');
        CREATE INDEX leads_by_archive_time ON referral_leads(resolvedAt DESC, id DESC) WHERE archiveToken IS NOT NULL;`);
    }
    if (!db.prepare("PRAGMA table_info(referral_leads)").all().some((column) => column.name === "realtorSharedSince")) {
      db.exec("ALTER TABLE referral_leads ADD COLUMN realtorSharedSince TEXT");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS realtor_referral_claims (
        id TEXT PRIMARY KEY, leadId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE,
        officerEmail TEXT NOT NULL, officerName TEXT NOT NULL, sharedSince TEXT NOT NULL, claimedAt TEXT NOT NULL,
        estimated INTEGER NOT NULL CHECK (estimated IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS realtor_claims_by_date ON realtor_referral_claims(claimedAt, id);
      CREATE INDEX IF NOT EXISTS realtor_claims_by_lead ON realtor_referral_claims(leadId);`);
    db.exec(`CREATE TABLE IF NOT EXISTS migration_records (
        origin TEXT NOT NULL, recordKey TEXT NOT NULL, targetId TEXT NOT NULL, PRIMARY KEY (origin, recordKey)
      );
      CREATE INDEX IF NOT EXISTS migration_records_by_target ON migration_records(targetId);
      CREATE TABLE IF NOT EXISTS migration_batches (
        origin TEXT NOT NULL, snapshot TEXT NOT NULL, part INTEGER NOT NULL, partCount INTEGER NOT NULL,
        contentHash TEXT NOT NULL, excluded TEXT NOT NULL, PRIMARY KEY (origin, snapshot, part)
      );
      CREATE TABLE IF NOT EXISTS migration_owner_mappings (
        origin TEXT NOT NULL, snapshot TEXT NOT NULL, sourceEmail TEXT NOT NULL, target TEXT NOT NULL,
        PRIMARY KEY (origin, snapshot, sourceEmail)
      );
      CREATE TABLE IF NOT EXISTS migration_imports (
        id TEXT PRIMARY KEY, origin TEXT NOT NULL, importedAt TEXT NOT NULL, importedBy TEXT NOT NULL,
        part INTEGER, partCount INTEGER, recordCount INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS migration_imports_recent ON migration_imports(importedAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS migration_imports_by_origin ON migration_imports(origin, importedAt DESC, id DESC);
      CREATE TABLE IF NOT EXISTS migration_cutover_reviews (
        origin TEXT NOT NULL, basis TEXT NOT NULL, item TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL,
        updatedBy TEXT NOT NULL, updatedAt TEXT NOT NULL, revision INTEGER NOT NULL, callbackFingerprint TEXT,
        PRIMARY KEY (origin, basis, item)
      );
      CREATE TABLE IF NOT EXISTS migration_import_rows (
        importId TEXT NOT NULL REFERENCES migration_imports(id) ON DELETE CASCADE, recordKey TEXT NOT NULL,
        label TEXT NOT NULL, outcome TEXT NOT NULL, targetId TEXT, storage TEXT, baseline TEXT,
        PRIMARY KEY (importId, recordKey)
      );
      CREATE INDEX IF NOT EXISTS migration_import_rows_by_target ON migration_import_rows(targetId);
      CREATE TABLE IF NOT EXISTS migration_import_undos (
        id TEXT PRIMARY KEY, importId TEXT NOT NULL REFERENCES migration_imports(id), fingerprint TEXT NOT NULL,
        undoneAt TEXT NOT NULL, undoneBy TEXT NOT NULL, rowCount INTEGER NOT NULL, UNIQUE (importId, fingerprint)
      );
      CREATE TABLE IF NOT EXISTS migration_undone_records (
        origin TEXT NOT NULL, recordKey TEXT NOT NULL, undoId TEXT NOT NULL REFERENCES migration_import_undos(id),
        PRIMARY KEY (undoId, recordKey)
      );
      CREATE TABLE IF NOT EXISTS lead_import_tasks (
        id TEXT PRIMARY KEY, leadId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE,
        title TEXT NOT NULL, dueAt TEXT NOT NULL, completedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS lead_import_tasks_by_lead ON lead_import_tasks(leadId);
      CREATE TABLE IF NOT EXISTS call_campaigns (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crm_segments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, kind TEXT NOT NULL,
        quietDays INTEGER NOT NULL, revision INTEGER NOT NULL, customFilter TEXT
      );
      CREATE TABLE IF NOT EXISTS crm_fields (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, archivedAt TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS active_crm_field_labels ON crm_fields(label COLLATE NOCASE) WHERE archivedAt IS NULL;
      CREATE TABLE IF NOT EXISTS crm_loan_fields (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, archivedAt TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS active_crm_loan_field_labels ON crm_loan_fields(label COLLATE NOCASE) WHERE archivedAt IS NULL;
      CREATE TABLE IF NOT EXISTS crm_lead_field_values (
        recordId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE,
        fieldId TEXT NOT NULL REFERENCES crm_fields(id), value TEXT, revision INTEGER NOT NULL,
        PRIMARY KEY (recordId, fieldId)
      );
      CREATE TABLE IF NOT EXISTS crm_contact_field_values (
        recordId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        fieldId TEXT NOT NULL REFERENCES crm_fields(id), value TEXT, revision INTEGER NOT NULL,
        PRIMARY KEY (recordId, fieldId)
      );
      CREATE TABLE IF NOT EXISTS crm_loan_field_values (
        recordId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
        fieldId TEXT NOT NULL REFERENCES crm_loan_fields(id), value TEXT, revision INTEGER NOT NULL,
        PRIMARY KEY (recordId, fieldId)
      );
      CREATE INDEX IF NOT EXISTS crm_lead_value_lookup ON crm_lead_field_values(fieldId, value, recordId);
      CREATE INDEX IF NOT EXISTS crm_contact_value_lookup ON crm_contact_field_values(fieldId, value, recordId);
      CREATE INDEX IF NOT EXISTS crm_loan_value_lookup ON crm_loan_field_values(fieldId, value, recordId);
      CREATE TABLE IF NOT EXISTS call_campaign_rules (
        campaignId TEXT PRIMARY KEY REFERENCES call_campaigns(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, voicemailDays INTEGER NOT NULL, noResponseDays INTEGER NOT NULL, maxAttempts INTEGER NOT NULL,
        automaticPaused INTEGER NOT NULL DEFAULT 0, retryTime TEXT NOT NULL DEFAULT '10:00'
      );
      CREATE TABLE IF NOT EXISTS campaign_routing (
        campaignId TEXT PRIMARY KEY REFERENCES call_campaigns(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL, officers TEXT NOT NULL, revision INTEGER NOT NULL, cursor TEXT
      );
      CREATE TABLE IF NOT EXISTS call_campaign_members (
        leadId TEXT PRIMARY KEY REFERENCES referral_leads(id) ON DELETE CASCADE,
        campaignId TEXT NOT NULL REFERENCES call_campaigns(id) ON DELETE CASCADE,
        joinedAt TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lastOutcome TEXT, reachedAt TEXT,
        callbackTaskId TEXT REFERENCES lead_import_tasks(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS campaign_members_by_campaign ON call_campaign_members(campaignId, joinedAt);
      CREATE TABLE IF NOT EXISTS campaign_sequence_versions (
        version INTEGER PRIMARY KEY, steps TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'New Lead'
      );
      CREATE TABLE IF NOT EXISTS campaign_sequence_attachments (
        campaignId TEXT PRIMARY KEY REFERENCES call_campaigns(id) ON DELETE CASCADE,
        version INTEGER NOT NULL REFERENCES campaign_sequence_versions(version)
      );
      CREATE TABLE IF NOT EXISTS campaign_sequence_enrollments (
        leadId TEXT PRIMARY KEY REFERENCES call_campaign_members(leadId) ON DELETE CASCADE,
        version INTEGER NOT NULL REFERENCES campaign_sequence_versions(version),
        position INTEGER NOT NULL DEFAULT 0, dueAt TEXT, outcome TEXT
      );
      CREATE INDEX IF NOT EXISTS campaign_sequence_due ON campaign_sequence_enrollments(dueAt, leadId) WHERE dueAt IS NOT NULL;
      CREATE TABLE IF NOT EXISTS campaign_sequence_touches (
        leadId TEXT NOT NULL REFERENCES campaign_sequence_enrollments(leadId) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 5), at TEXT NOT NULL,
        PRIMARY KEY (leadId, position)
      );
      CREATE TABLE IF NOT EXISTS campaign_follow_up_runs (
        id TEXT PRIMARY KEY, leadId TEXT NOT NULL REFERENCES call_campaign_members(leadId) ON DELETE CASCADE,
        campaignId TEXT NOT NULL REFERENCES call_campaigns(id) ON DELETE CASCADE, callNumber INTEGER NOT NULL,
        outcome TEXT NOT NULL, ruleRevision INTEGER NOT NULL, delayDays INTEGER, taskId TEXT NOT NULL, taskTitle TEXT NOT NULL,
        dueAt TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('Failed', 'Paused', 'Completed', 'Superseded')),
        reason TEXT NOT NULL, attemptCount INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL,
        promiseRequestEventId TEXT, promiseDueAt TEXT, promiseAttemptEventId TEXT, promiseClosedAt TEXT, promiseCloseReason TEXT,
        UNIQUE (leadId, callNumber)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS pending_campaign_follow_up_by_lead ON campaign_follow_up_runs(leadId) WHERE status IN ('Failed', 'Paused');
      CREATE INDEX IF NOT EXISTS campaign_follow_up_runs_by_time ON campaign_follow_up_runs(at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS campaign_follow_up_runs_by_status ON campaign_follow_up_runs(status, at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS pending_campaign_follow_up_by_deadline ON campaign_follow_up_runs(dueAt, at, id) WHERE status IN ('Failed', 'Paused');
      CREATE TABLE IF NOT EXISTS campaign_follow_up_attempts (
        runId TEXT NOT NULL REFERENCES campaign_follow_up_runs(id) ON DELETE CASCADE, attempt INTEGER NOT NULL, operationId TEXT NOT NULL,
        mode TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, taskChanges INTEGER NOT NULL,
        PRIMARY KEY (runId, attempt), UNIQUE (runId, operationId)
      );
      CREATE TABLE IF NOT EXISTS campaign_follow_up_recoveries (
        operationId TEXT PRIMARY KEY, actorEmail TEXT NOT NULL, selection TEXT NOT NULL, result TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaign_assignment_history (
        id INTEGER PRIMARY KEY, leadId TEXT NOT NULL REFERENCES call_campaign_members(leadId) ON DELETE CASCADE,
        officerEmail TEXT, officer TEXT NOT NULL, assignedAt TEXT NOT NULL, endedAt TEXT, firstOutreachAt TEXT
      );
      CREATE INDEX IF NOT EXISTS campaign_assignments_by_lead ON campaign_assignment_history(leadId, id);
      CREATE UNIQUE INDEX IF NOT EXISTS active_campaign_assignment ON campaign_assignment_history(leadId) WHERE endedAt IS NULL;
      CREATE TABLE IF NOT EXISTS outreach_opt_outs (
        source TEXT NOT NULL, identityKey TEXT NOT NULL, scenarioId TEXT, recordedAt TEXT NOT NULL,
        PRIMARY KEY(source, identityKey)
      );
      CREATE INDEX IF NOT EXISTS outreach_opt_out_by_identity ON outreach_opt_outs(identityKey);
      CREATE TABLE IF NOT EXISTS manager_report_views (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, filters TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mismo_rehearsals (
        loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, requestId TEXT NOT NULL UNIQUE, fields TEXT NOT NULL,
        existingContactId TEXT, sourceExtraBorrowers INTEGER
      );
      CREATE TABLE IF NOT EXISTS migration_cutover_loan_reviews (
        loanId TEXT NOT NULL REFERENCES mismo_rehearsals(loanId) ON DELETE CASCADE,
        origin TEXT NOT NULL, basis TEXT NOT NULL, item TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL,
        updatedBy TEXT NOT NULL, updatedAt TEXT NOT NULL, revision INTEGER NOT NULL, applicationFingerprint TEXT, applicationRevision INTEGER,
        fileFingerprint TEXT,
        PRIMARY KEY (loanId, origin, basis, item)
      );
      CREATE TABLE IF NOT EXISTS migration_cutover_file_sources (
        loanId TEXT NOT NULL REFERENCES mismo_rehearsals(loanId) ON DELETE CASCADE,
        origin TEXT NOT NULL, basis TEXT NOT NULL, source TEXT NOT NULL, revision INTEGER NOT NULL,
        PRIMARY KEY (loanId, origin, basis)
      );`);
    if (!db.prepare("PRAGMA table_info(campaign_sequence_versions)").all().some(({ name }) => name === "kind")) {
      db.exec("ALTER TABLE campaign_sequence_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'New Lead'");
    }
    if (!db.prepare("PRAGMA table_info(migration_cutover_reviews)").all().some(({ name }) => name === "callbackFingerprint")) {
      db.exec("ALTER TABLE migration_cutover_reviews ADD COLUMN callbackFingerprint TEXT");
    }
    if (!db.prepare("PRAGMA table_info(loan_conversations)").all().some((column) => column.name === "sourceLeadId")) {
      db.exec("ALTER TABLE loan_conversations ADD COLUMN sourceLeadId TEXT REFERENCES referral_leads(id) ON DELETE SET NULL");
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS conversations_by_source_lead ON loan_conversations(sourceLeadId) WHERE sourceLeadId IS NOT NULL");
    if (!db.prepare("PRAGMA table_info(inbound_replies)").all().some((column) => column.name === "leadConversationId")) {
      db.exec("ALTER TABLE inbound_replies ADD COLUMN leadConversationId TEXT REFERENCES lead_conversations(id) ON DELETE SET NULL");
    }
    db.exec("CREATE INDEX IF NOT EXISTS inbound_replies_by_lead_conversation ON inbound_replies(leadConversationId) WHERE leadConversationId IS NOT NULL");
    if (!db.prepare("PRAGMA table_info(inbound_replies)").all().some((column) => column.name === "contactConversationId")) {
      db.exec("ALTER TABLE inbound_replies ADD COLUMN contactConversationId TEXT REFERENCES contact_conversations(id) ON DELETE SET NULL");
    }
    db.exec("CREATE INDEX IF NOT EXISTS inbound_replies_by_contact_conversation ON inbound_replies(contactConversationId) WHERE contactConversationId IS NOT NULL");
    const mismoColumns = new Set(db.prepare("PRAGMA table_info(mismo_rehearsals)").all().map(({ name }) => name));
    if (!mismoColumns.has("existingContactId")) {
      db.exec("ALTER TABLE mismo_rehearsals ADD COLUMN existingContactId TEXT");
    }
    if (!mismoColumns.has("sourceExtraBorrowers")) db.exec("ALTER TABLE mismo_rehearsals ADD COLUMN sourceExtraBorrowers INTEGER");
    const cutoverLoanReviewColumns = new Set(db.prepare("PRAGMA table_info(migration_cutover_loan_reviews)").all().map(({ name }) => name));
    if (!cutoverLoanReviewColumns.has("applicationFingerprint")) db.exec("ALTER TABLE migration_cutover_loan_reviews ADD COLUMN applicationFingerprint TEXT");
    if (!cutoverLoanReviewColumns.has("applicationRevision")) db.exec("ALTER TABLE migration_cutover_loan_reviews ADD COLUMN applicationRevision INTEGER");
    if (!cutoverLoanReviewColumns.has("fileFingerprint")) db.exec("ALTER TABLE migration_cutover_loan_reviews ADD COLUMN fileFingerprint TEXT");
    if (db.prepare("PRAGMA table_info(migration_undone_records)").all().some((column) => column.name === "origin" && column.pk)) {
      db.exec(`CREATE TABLE migration_undone_records_next (
          origin TEXT NOT NULL, recordKey TEXT NOT NULL, undoId TEXT NOT NULL REFERENCES migration_import_undos(id),
          PRIMARY KEY (undoId, recordKey)
        );
        INSERT INTO migration_undone_records_next (origin, recordKey, undoId)
          SELECT origin, recordKey, undoId FROM migration_undone_records ORDER BY rowid;
        DROP TABLE migration_undone_records;
        ALTER TABLE migration_undone_records_next RENAME TO migration_undone_records;`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS migration_undo_by_source ON migration_undone_records(origin, recordKey);
      CREATE UNIQUE INDEX IF NOT EXISTS website_request_id ON referral_leads(requestId) WHERE realtorId IS NULL;
    CREATE TABLE IF NOT EXISTS quote_intake_versions (
      revision INTEGER PRIMARY KEY, config TEXT NOT NULL, publishedAt TEXT NOT NULL, publishedBy TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'General', active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS quote_intake_receipts (
      leadId TEXT PRIMARY KEY REFERENCES referral_leads(id) ON DELETE CASCADE, formRevision INTEGER NOT NULL,
      timing TEXT NOT NULL, answer TEXT NOT NULL, campaignId TEXT, profile TEXT NOT NULL DEFAULT 'General',
      structuredAnswers TEXT NOT NULL DEFAULT '[]', routingReceipt TEXT
    );
    CREATE TABLE IF NOT EXISTS lead_follow_up (
        leadId TEXT PRIMARY KEY REFERENCES referral_leads(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'Not started', revision INTEGER NOT NULL DEFAULT 0,
        nextStep INTEGER NOT NULL DEFAULT 0, nextAt TEXT, pausedAt TEXT, firstContactAt TEXT
      );
      CREATE TABLE IF NOT EXISTS lead_events (
        id TEXT PRIMARY KEY, leadId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE,
        at TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, outcome TEXT, text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lead_events_by_lead ON lead_events(leadId, at);`);
    const quoteVersionColumns = new Set(db.prepare("PRAGMA table_info(quote_intake_versions)").all().map(({ name }) => name));
    if (!quoteVersionColumns.has("profile")) db.exec("ALTER TABLE quote_intake_versions ADD COLUMN profile TEXT NOT NULL DEFAULT 'General'");
    if (!quoteVersionColumns.has("active")) db.exec("ALTER TABLE quote_intake_versions ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
    const receiptColumns = new Set(db.prepare("PRAGMA table_info(quote_intake_receipts)").all().map(({ name }) => name));
    if (!receiptColumns.has("profile")) {
      db.exec("ALTER TABLE quote_intake_receipts ADD COLUMN profile TEXT NOT NULL DEFAULT 'General'");
    }
    if (!receiptColumns.has("structuredAnswers")) {
      db.exec("ALTER TABLE quote_intake_receipts ADD COLUMN structuredAnswers TEXT NOT NULL DEFAULT '[]'");
    }
    if (!receiptColumns.has("routingReceipt")) db.exec("ALTER TABLE quote_intake_receipts ADD COLUMN routingReceipt TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS quote_intake_versions_by_profile ON quote_intake_versions(profile, revision DESC)");
    if (!db.prepare("PRAGMA table_info(lead_follow_up)").all().some((column) => column.name === "replyReceivedAt")) {
      db.exec(`ALTER TABLE lead_follow_up ADD COLUMN replyReceivedAt TEXT;
        INSERT INTO lead_follow_up (leadId, status, revision, replyReceivedAt)
        SELECT thread.leadId, 'Stopped', 1, min(event.at) FROM lead_conversations thread
        JOIN lead_conversation_events event ON event.conversationId = thread.id
        WHERE event.kind = 'Inbound' AND event.origin = 'Manual log' GROUP BY thread.leadId
        ON CONFLICT(leadId) DO UPDATE SET replyReceivedAt = excluded.replyReceivedAt,
        status = CASE WHEN status = 'Completed' THEN status ELSE 'Stopped' END, nextAt = NULL, pausedAt = NULL, revision = revision + 1;
        UPDATE lead_import_tasks SET completedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE completedAt IS NULL AND id IN (
          SELECT member.callbackTaskId FROM call_campaign_members member JOIN lead_follow_up follow ON follow.leadId = member.leadId
          WHERE follow.replyReceivedAt IS NOT NULL AND member.lastOutcome IN ('Left message', 'No response'));
        UPDATE campaign_follow_up_runs SET status = 'Superseded', reason = 'Borrower reply logged.'
        WHERE delayDays IS NOT NULL AND status IN ('Failed', 'Paused') AND leadId IN (
          SELECT leadId FROM lead_follow_up WHERE replyReceivedAt IS NOT NULL);`);
    }
    if (!db.prepare("PRAGMA table_info(crm_segments)").all().some((column) => column.name === "customFilter")) {
      db.exec("ALTER TABLE crm_segments ADD COLUMN customFilter TEXT");
    }
    if (!db.prepare("PRAGMA table_info(call_campaign_members)").all().some((column) => column.name === "segmentId")) {
      db.exec("ALTER TABLE call_campaign_members ADD COLUMN segmentId TEXT REFERENCES crm_segments(id) ON DELETE SET NULL");
      // Older enrollments recorded a lead event and an audit entry together. Match them only when the segment is unambiguous.
      db.exec(`WITH attribution AS (
        SELECT member.leadId, min(segment.id) AS segmentId
        FROM call_campaign_members member JOIN lead_events event ON event.leadId = member.leadId
        JOIN workspace_access_history audit ON audit.createdAt = event.at AND audit.action = 'Enrolled CRM segment in call campaign'
          AND substr(audit.subject, 40, 36) = member.campaignId
        JOIN crm_segments segment ON segment.id = substr(audit.subject, 1, 36)
        WHERE event.kind = 'Campaign' AND event.text LIKE 'Enrolled from %'
        GROUP BY member.leadId HAVING count(DISTINCT segment.id) = 1
      )
      UPDATE call_campaign_members SET segmentId = attribution.segmentId FROM attribution
      WHERE call_campaign_members.leadId = attribution.leadId;`);
    }
    const campaignRuleColumns = new Set(db.prepare("PRAGMA table_info(call_campaign_rules)").all().map(({ name }) => name));
    if (!campaignRuleColumns.has("automaticPaused")) {
      db.exec("ALTER TABLE call_campaign_rules ADD COLUMN automaticPaused INTEGER NOT NULL DEFAULT 0");
    }
    if (!campaignRuleColumns.has("retryTime")) db.exec("ALTER TABLE call_campaign_rules ADD COLUMN retryTime TEXT NOT NULL DEFAULT '10:00'");
    const campaignRunColumns = new Set(db.prepare("PRAGMA table_info(campaign_follow_up_runs)").all().map(({ name }) => name));
    for (const column of ["promiseRequestEventId", "promiseDueAt", "promiseAttemptEventId", "promiseClosedAt", "promiseCloseReason"]) {
      if (!campaignRunColumns.has(column)) db.exec(`ALTER TABLE campaign_follow_up_runs ADD COLUMN ${column} TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS campaign_callback_promises_by_campaign ON campaign_follow_up_runs(campaignId, at DESC, id DESC)
      WHERE promiseRequestEventId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS open_campaign_callback_promises_by_due ON campaign_follow_up_runs(promiseDueAt, id)
      WHERE promiseRequestEventId IS NOT NULL AND promiseAttemptEventId IS NULL AND promiseClosedAt IS NULL;
      CREATE INDEX IF NOT EXISTS carried_campaign_callback_promises_by_due ON campaign_follow_up_runs(promiseDueAt, id)
      WHERE promiseRequestEventId IS NOT NULL AND promiseAttemptEventId IS NULL AND promiseCloseReason = '1003 started'`);
    if (!db.prepare("PRAGMA table_info(call_campaign_members)").all().some((column) => column.name === "firstCallAt")) {
      db.exec(`ALTER TABLE call_campaign_members ADD COLUMN firstCallAt TEXT;
        UPDATE call_campaign_members AS member SET firstCallAt = (SELECT min(at) FROM (
          SELECT event.at FROM lead_events event WHERE event.leadId = member.leadId AND event.at >= member.joinedAt
            AND event.kind = 'Call' AND event.outcome IS NOT NULL AND instr(event.text, event.outcome || ' · Call campaign · ') = 1
          UNION ALL SELECT history.firstOutreachAt FROM campaign_assignment_history history
            WHERE history.leadId = member.leadId AND history.firstOutreachAt >= member.joinedAt))
        WHERE attempts > 0;`);
    }
    if (!db.prepare("PRAGMA table_info(call_campaign_members)").all().some((column) => column.name === "retryExhaustedAt")) {
      db.exec(`ALTER TABLE call_campaign_members ADD COLUMN retryExhaustedAt TEXT;
        UPDATE call_campaign_members AS member SET retryExhaustedAt = (
          SELECT event.at FROM lead_events event WHERE event.leadId = member.leadId
            AND event.kind = 'Campaign' AND event.text = 'Automatic retries ended · attempt limit reached.'
            AND event.rowid > (SELECT call.rowid FROM lead_events call WHERE call.leadId = member.leadId
              AND call.kind = 'Call' AND instr(call.text, call.outcome || ' · Call campaign · ') = 1
              ORDER BY call.at DESC, call.rowid DESC LIMIT 1)
        ) WHERE member.reachedAt IS NULL AND member.lastOutcome IN ('Left message', 'No response')
          AND NOT EXISTS (SELECT 1 FROM lead_follow_up WHERE leadId = member.leadId AND replyReceivedAt IS NOT NULL);`);
    }
    const googleAttemptColumns = db.prepare("PRAGMA table_info(staff_google_attempts)").all();
    if (!googleAttemptColumns.some((column) => column.name === "brokerageId")) {
      db.exec("ALTER TABLE staff_google_attempts ADD COLUMN brokerageId TEXT");
    }
    if (!googleAttemptColumns.some((column) => column.name === "guide")) {
      db.exec("ALTER TABLE staff_google_attempts ADD COLUMN guide TEXT");
    }
    if (!db.prepare("PRAGMA table_info(activity)").all().some((column) => column.name === "kind")) {
      db.exec("ALTER TABLE activity ADD COLUMN kind TEXT NOT NULL DEFAULT 'Note'");
    }
    if (!db.prepare("PRAGMA table_info(activity)").all().some((column) => column.name === "outcome")) {
      db.exec("ALTER TABLE activity ADD COLUMN outcome TEXT");
    }
    db.exec("CREATE INDEX IF NOT EXISTS activity_first_outreach_by_loan ON activity(loanId, createdAt) WHERE outcome IS NOT NULL");
    db.exec("CREATE INDEX IF NOT EXISTS communication_drafts_by_contact ON communication_drafts(contactId, id)");
    db.exec(`CREATE INDEX IF NOT EXISTS activity_by_loan_and_time ON activity(loanId, createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS processing_activity_by_loan ON activity(loanId) WHERE text GLOB '${processingActivityPrefix}*';
      CREATE INDEX IF NOT EXISTS loans_by_contact ON loans(contactId);
      CREATE INDEX IF NOT EXISTS loans_by_partner ON loans(partnerId) WHERE partnerId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS realtor_portal_loans_by_update ON loans(partnerId, stageSince DESC, id DESC) WHERE partnerId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS realtor_portal_referrals_by_update ON referral_leads(realtorId, createdAt DESC, id DESC) WHERE resolvedAt IS NULL;
      CREATE INDEX IF NOT EXISTS leads_by_imported_contact ON referral_leads(importedContactId) WHERE importedContactId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS contact_follow_ups_by_time ON contact_activity(createdAt DESC, id) WHERE dueAt IS NOT NULL;`);
    if (!db.prepare("PRAGMA table_info(tasks)").all().some((column) => column.name === "purpose")) {
      db.exec(`ALTER TABLE tasks ADD COLUMN purpose TEXT NOT NULL DEFAULT 'Loan service' CHECK (purpose IN ('Loan service', 'Prospecting'));
        UPDATE tasks SET purpose = 'Prospecting' WHERE id LIKE 'first-contact:%' OR id LIKE 'rate-watch:%' OR id LIKE 'closing-anniversary:%';`);
    }
    if (!db.prepare("PRAGMA table_info(contact_activity)").all().some((column) => column.name === "purpose")) {
      db.exec("ALTER TABLE contact_activity ADD COLUMN purpose TEXT NOT NULL DEFAULT 'Prospecting' CHECK (purpose IN ('Loan service', 'Prospecting'))");
    }
    if (!db.prepare("PRAGMA table_info(contact_activity)").all().some((column) => column.name === "followUpOwnerEmail")) {
      db.exec(`ALTER TABLE contact_activity ADD COLUMN followUpOwner TEXT;
        ALTER TABLE contact_activity ADD COLUMN followUpOwnerEmail TEXT;
        UPDATE contact_activity SET followUpOwner = officer, followUpOwnerEmail = officerEmail WHERE dueAt IS NOT NULL;`);
    }
    if (!db.prepare("PRAGMA table_info(lead_import_tasks)").all().some((column) => column.name === "purpose")) {
      db.exec(`ALTER TABLE lead_import_tasks ADD COLUMN purpose TEXT NOT NULL DEFAULT 'Loan service' CHECK (purpose IN ('Loan service', 'Prospecting'));
        UPDATE lead_import_tasks SET purpose = 'Prospecting' WHERE id IN (SELECT callbackTaskId FROM call_campaign_members);`);
    }
    if (!db.prepare("PRAGMA table_info(loans)").all().some((column) => column.name === "officerEmail")) {
      db.exec("ALTER TABLE loans ADD COLUMN officerEmail TEXT");
    }
    if (!db.prepare("PRAGMA table_info(loans)").all().some((column) => column.name === "disposition")) {
      db.exec(`ALTER TABLE loans ADD COLUMN disposition TEXT NOT NULL DEFAULT 'Active';
        ALTER TABLE loans ADD COLUMN dispositionReason TEXT NOT NULL DEFAULT '';
        ALTER TABLE loans ADD COLUMN revisitDate TEXT;
        ALTER TABLE loans ADD COLUMN dispositionRevision INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!db.prepare("PRAGMA table_info(contacts)").all().some((column) => column.name === "addedBy")) {
      db.exec("ALTER TABLE contacts ADD COLUMN addedBy TEXT");
    }
    if (!db.prepare("PRAGMA table_info(loans)").all().some((column) => column.name === "leadSource")) {
      db.exec(`ALTER TABLE loans ADD COLUMN leadSource TEXT;
        ALTER TABLE loans ADD COLUMN createdAt TEXT;
        UPDATE loans SET leadSource = CASE WHEN partnerId IS NOT NULL THEN 'Realtor referral' ELSE 'Direct' END, createdAt = stageSince;`);
    }
    if (!db.prepare("PRAGMA table_info(pilot_feedback)").all().some((column) => column.name === "priority")) {
      db.exec(`ALTER TABLE pilot_feedback ADD COLUMN owner TEXT;
        ALTER TABLE pilot_feedback ADD COLUMN priority TEXT NOT NULL DEFAULT 'Normal';
        ALTER TABLE pilot_feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'Open';
        ALTER TABLE pilot_feedback ADD COLUMN retest TEXT NOT NULL DEFAULT '';
        ALTER TABLE pilot_feedback ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;`);
    }
    const portalColumns = db.prepare("PRAGMA table_info(realtor_portals)").all();
    if (!portalColumns.some((column) => column.name === "officerEmail")) {
      db.exec("ALTER TABLE realtor_portals ADD COLUMN officerEmail TEXT; ALTER TABLE realtor_portals ADD COLUMN officer TEXT NOT NULL DEFAULT '';");
    }
    if (!portalColumns.some((column) => column.name === "revision")) {
      db.exec("ALTER TABLE realtor_portals ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
    }
    db.exec("CREATE INDEX IF NOT EXISTS realtor_portals_by_officer ON realtor_portals(officerEmail, realtorId)");
    if (!db.prepare("PRAGMA table_info(applications)").all().some((column) => column.name === "revokedAt")) {
      db.exec("ALTER TABLE applications ADD COLUMN revokedAt TEXT");
    }
    if (!db.prepare("PRAGMA table_info(applications)").all().some((column) => column.name === "correctionNote")) {
      db.exec("ALTER TABLE applications ADD COLUMN correctionNote TEXT NOT NULL DEFAULT ''");
    }
    if (!db.prepare("PRAGMA table_info(disclosure_packages)").all().some(({ name }) => name === "declineFollowUp")) {
      db.exec("ALTER TABLE disclosure_packages ADD COLUMN declineFollowUp TEXT");
      db.prepare(`INSERT OR IGNORE INTO tasks (id, loanId, title, dueAt)
        SELECT ? || package.loanId || ':' || package.version, package.loanId, ?, json_extract(signer.value, '$.actedAt')
        FROM disclosure_packages package
        JOIN loans loan ON loan.id = package.loanId
        JOIN json_each(package.signers) signer
        WHERE package.issuedAt IS NOT NULL AND package.supersededAt IS NULL
          AND loan.stage NOT IN ('Funded', 'Closed')
          AND json_extract(signer.value, '$.status') = 'Declined' AND json_extract(signer.value, '$.actedAt') IS NOT NULL`)
        .run(disclosureDeclinePrefix, disclosureDeclineTaskTitle);
    }
    if (!db.prepare("PRAGMA table_info(disclosure_packages)").all().some(({ name }) => name === "changeReview")) {
      db.exec("ALTER TABLE disclosure_packages ADD COLUMN changeReview TEXT");
    }
    if (!db.prepare("PRAGMA table_info(disclosure_packages)").all().some(({ name }) => name === "deadlineBasis")) {
      db.exec("ALTER TABLE disclosure_packages ADD COLUMN deadlineBasis TEXT");
    }
    if (!db.prepare("PRAGMA table_info(disclosure_packages)").all().some(({ name }) => name === "templateBasis")) {
      db.exec("ALTER TABLE disclosure_packages ADD COLUMN templateBasis TEXT");
    }
    if (!db.prepare("PRAGMA table_info(borrower_questions)").all().some(({ name }) => name === "setBatchId")) {
      db.exec("ALTER TABLE borrower_questions ADD COLUMN setBatchId TEXT REFERENCES borrower_question_set_batches(id) ON DELETE SET NULL");
    }
    db.exec(`CREATE INDEX IF NOT EXISTS disclosure_targets_for_calendar ON disclosure_packages(signBy, loanId)
      WHERE supersededAt IS NULL AND reviewReason IS NULL AND deadlineBasis IS NOT NULL`);
    if (!db.prepare("PRAGMA table_info(closing_packets)").all().some(({ name }) => name === "pdf")) {
      db.exec("ALTER TABLE closing_packets ADD COLUMN pdf TEXT");
    }
    const pricingColumns = new Set(db.prepare("PRAGMA table_info(pricing_runs)").all().map(({ name }) => name));
    for (const column of ["applicationRevision", "incomeReviewRevision"]) {
      if (!pricingColumns.has(column)) db.exec(`ALTER TABLE pricing_runs ADD COLUMN ${column} INTEGER`);
    }
    for (const table of ["published_quotes", "shared_quote_history"]) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name));
      if (!columns.has("presentation")) db.exec(`ALTER TABLE ${table} ADD COLUMN presentation TEXT`);
      if (!columns.has("expiresOn")) db.exec(`ALTER TABLE ${table} ADD COLUMN expiresOn TEXT`);
      if (table === "published_quotes" && !columns.has("reviewReason")) {
        db.exec("ALTER TABLE published_quotes ADD COLUMN reviewReason TEXT; ALTER TABLE published_quotes ADD COLUMN reviewRevision INTEGER NOT NULL DEFAULT 0");
      }
    }
    db.exec(`CREATE TABLE IF NOT EXISTS application_versions (
      loanId TEXT NOT NULL REFERENCES applications(loanId) ON DELETE CASCADE,
      revision INTEGER NOT NULL, draft TEXT NOT NULL, submittedAt TEXT NOT NULL, reviewedAt TEXT,
      uwmReceipt TEXT, uwmSentAt TEXT,
      PRIMARY KEY (loanId, revision)
    )`);
    if (!db.prepare("PRAGMA table_info(application_versions)").all().some((column) => column.name === "uwmReceipt")) {
      db.exec(`ALTER TABLE application_versions ADD COLUMN uwmReceipt TEXT;
        ALTER TABLE application_versions ADD COLUMN uwmSentAt TEXT;`);
    }
    if (!db.prepare("PRAGMA table_info(document_requests)").all().some((column) => column.name === "conditionId")) {
      // Preserve the original checklist while allowing each condition its own request.
      const columns = "id, loanId, kind, instructions, requestedAt, status, replacementNote, submittedAt, revision";
      db.exec(`
        CREATE TABLE document_requests_next (${documentRequestColumns});
        INSERT INTO document_requests_next (${columns}) SELECT ${columns} FROM document_requests;
        DROP TABLE document_requests;
        ALTER TABLE document_requests_next RENAME TO document_requests;
      `);
    }
    const requestColumns = new Set(db.prepare("PRAGMA table_info(document_requests)").all().map((column) => column.name));
    if (!requestColumns.has("dueOn")) db.exec("ALTER TABLE document_requests ADD COLUMN dueOn TEXT");
    if (!requestColumns.has("deadlineRevision")) db.exec("ALTER TABLE document_requests ADD COLUMN deadlineRevision INTEGER NOT NULL DEFAULT 0");
    if (!requestColumns.has("recipient")) db.exec(`ALTER TABLE document_requests ADD COLUMN recipient TEXT NOT NULL
      DEFAULT 'Primary borrower' CHECK (recipient IN ('Primary borrower', 'Co-borrower'))`);
    const coverageColumns = new Set(db.prepare("PRAGMA table_info(staff_coverage)").all().map((column) => column.name));
    if (!coverageColumns.has("absentAccessRevision")) db.exec("ALTER TABLE staff_coverage ADD COLUMN absentAccessRevision INTEGER NOT NULL DEFAULT 0");
    if (!coverageColumns.has("backupAccessRevision")) db.exec("ALTER TABLE staff_coverage ADD COLUMN backupAccessRevision INTEGER NOT NULL DEFAULT 0");
    db.exec(`DROP INDEX IF EXISTS manual_document_by_loan_kind;
      CREATE UNIQUE INDEX IF NOT EXISTS manual_document_by_recipient ON document_requests(loanId, recipient, kind) WHERE conditionId IS NULL`);
    db.exec("CREATE INDEX IF NOT EXISTS document_requests_by_loan ON document_requests(loanId, requestedAt, id)");
    db.exec("CREATE INDEX IF NOT EXISTS received_documents_by_loan ON document_requests(loanId) WHERE status = 'Received'");
    db.exec(`CREATE INDEX IF NOT EXISTS borrower_documents_by_due ON document_requests(dueOn, id)
      WHERE dueOn IS NOT NULL AND status IN ('Requested', 'Needs replacement');
      CREATE INDEX IF NOT EXISTS missing_evidence_by_date ON document_requests(coalesce(dueOn, substr(requestedAt, 1, 10)), id)
      WHERE status IN ('Requested', 'Needs replacement');`);
    db.exec(`CREATE TABLE IF NOT EXISTS document_reminder_runs (
      id TEXT PRIMARY KEY, requestId TEXT NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
      documentRevision INTEGER NOT NULL, deadlineRevision INTEGER NOT NULL, dueOn TEXT NOT NULL,
      eligibleOn TEXT, timingOffsetDays INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('Failed', 'Completed', 'Superseded')), reason TEXT NOT NULL,
      receipt TEXT UNIQUE, attemptCount INTEGER NOT NULL, at TEXT NOT NULL,
      UNIQUE (requestId, documentRevision, deadlineRevision)
    );
    CREATE INDEX IF NOT EXISTS document_reminder_runs_by_time ON document_reminder_runs(at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS document_reminder_runs_by_status ON document_reminder_runs(status, at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS failed_document_reminders_by_deadline ON document_reminder_runs(dueOn, at, id) WHERE status = 'Failed';
    CREATE TABLE IF NOT EXISTS document_reminder_attempts (
      runId TEXT NOT NULL REFERENCES document_reminder_runs(id) ON DELETE CASCADE, attempt INTEGER NOT NULL, operationId TEXT NOT NULL,
      mode TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, taskChanges INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (runId, attempt), UNIQUE (runId, operationId)
    );
    CREATE TABLE IF NOT EXISTS document_reminder_checks (
      operationId TEXT PRIMARY KEY, actorEmail TEXT NOT NULL, simulated INTEGER NOT NULL,
      processed INTEGER NOT NULL, interrupted INTEGER NOT NULL, more INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_reminder_recoveries (
      operationId TEXT PRIMARY KEY, actorEmail TEXT NOT NULL, selection TEXT NOT NULL, result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_reminder_schedule (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, nextAt INTEGER,
      lastCheckedAt TEXT, lastProcessed INTEGER
    );`);
    const reminderColumns = new Set(db.prepare("PRAGMA table_info(document_reminder_runs)").all().map((column) => column.name));
    if (!reminderColumns.has("eligibleOn")) db.exec("ALTER TABLE document_reminder_runs ADD COLUMN eligibleOn TEXT");
    if (!reminderColumns.has("timingOffsetDays")) db.exec("ALTER TABLE document_reminder_runs ADD COLUMN timingOffsetDays INTEGER NOT NULL DEFAULT 0");
    db.exec(`CREATE TABLE IF NOT EXISTS uwm_document_deliveries (
      requestId TEXT PRIMARY KEY REFERENCES document_requests(id) ON DELETE CASCADE,
      receipt TEXT NOT NULL UNIQUE, sentAt TEXT NOT NULL, mockClearedAt TEXT
    )`);
    if (!db.prepare("PRAGMA table_info(uwm_document_deliveries)").all().some((column) => column.name === "documentRevision")) {
      db.exec("ALTER TABLE uwm_document_deliveries ADD COLUMN documentRevision INTEGER");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS uwm_document_delivery_history (
      requestId TEXT NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
      receipt TEXT PRIMARY KEY, sentAt TEXT NOT NULL, documentRevision INTEGER
    );
    CREATE INDEX IF NOT EXISTS uwm_document_delivery_history_by_request ON uwm_document_delivery_history(requestId);
    CREATE TABLE IF NOT EXISTS mock_delivery_failures (
      requestId TEXT NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, failedAt TEXT NOT NULL, PRIMARY KEY (requestId, revision)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS borrower_upload_access (${borrowerUploadAccessColumns});
    CREATE TABLE IF NOT EXISTS document_files (
      requestId TEXT PRIMARY KEY REFERENCES document_requests(id) ON DELETE CASCADE,
      objectId TEXT, uploadedAt TEXT, pendingId TEXT, pendingUntil INTEGER, attemptedAt INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0,
      uploadMode TEXT
    );
    CREATE TABLE IF NOT EXISTS lender_package_links (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE, borrowerId TEXT NOT NULL,
      applicationRevision INTEGER NOT NULL, lenderRevision INTEGER NOT NULL, recipient TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
      codeHash TEXT NOT NULL, requestHash TEXT NOT NULL, xml TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL, revokedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS lender_packages_by_loan ON lender_package_links(loanId, createdAt);
    CREATE TABLE IF NOT EXISTS lender_package_files (
      shareId TEXT NOT NULL REFERENCES lender_package_links(id) ON DELETE CASCADE, slot INTEGER NOT NULL, label TEXT NOT NULL,
      requestId TEXT, documentRevision INTEGER, objectId TEXT, downloads INTEGER NOT NULL DEFAULT 0,
      firstDownloadedAt TEXT, lastDownloadedAt TEXT, PRIMARY KEY(shareId, slot)
    );
    CREATE TABLE IF NOT EXISTS document_file_cleanup (objectId TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS lead_document_requests (
      id TEXT PRIMARY KEY, leadId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, instructions TEXT NOT NULL, requestedAt TEXT NOT NULL, dueOn TEXT, deadlineRevision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Received', 'Accepted', 'Needs replacement')),
      replacementNote TEXT NOT NULL DEFAULT '', submittedAt TEXT, revision INTEGER NOT NULL DEFAULT 0,
      objectId TEXT, uploadedAt TEXT, pendingId TEXT, pendingUntil INTEGER, attemptedAt INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0, UNIQUE(leadId, kind)
    );
    CREATE TABLE IF NOT EXISTS lead_document_links (
      id TEXT PRIMARY KEY, leadId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE, tokenHash TEXT NOT NULL UNIQUE,
      codeHash TEXT NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL, revokedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS lead_document_links_by_lead ON lead_document_links(leadId, expiresAt);
    CREATE TRIGGER IF NOT EXISTS lead_document_files_deleted AFTER DELETE ON lead_document_requests BEGIN
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.objectId WHERE OLD.objectId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM document_files WHERE objectId = OLD.objectId);
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.pendingId WHERE OLD.pendingId IS NOT NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS lead_document_files_replaced AFTER UPDATE ON lead_document_requests BEGIN
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.objectId WHERE OLD.objectId IS NOT NULL AND OLD.objectId IS NOT NEW.objectId;
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.pendingId WHERE OLD.pendingId IS NOT NULL
        AND OLD.pendingId IS NOT NEW.pendingId AND OLD.pendingId IS NOT NEW.objectId;
    END;
    CREATE TRIGGER IF NOT EXISTS document_files_deleted AFTER DELETE ON document_files BEGIN
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.objectId WHERE OLD.objectId IS NOT NULL;
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.pendingId WHERE OLD.pendingId IS NOT NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS document_files_replaced AFTER UPDATE ON document_files BEGIN
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.objectId WHERE OLD.objectId IS NOT NULL AND OLD.objectId IS NOT NEW.objectId;
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.pendingId WHERE OLD.pendingId IS NOT NULL
        AND OLD.pendingId IS NOT NEW.pendingId AND OLD.pendingId IS NOT NEW.objectId;
    END;`);
    if (!db.prepare("PRAGMA table_info(lead_document_requests)").all().some(({ name }) => name === "deadlineRevision")) {
      db.exec("ALTER TABLE lead_document_requests ADD COLUMN deadlineRevision INTEGER NOT NULL DEFAULT 0");
    }
    if (!db.prepare("PRAGMA table_info(document_files)").all().some(({ name }) => name === "uploadMode")) {
      db.exec("ALTER TABLE document_files ADD COLUMN uploadMode TEXT");
    }
    // Earlier presenter scenarios seeded a request ID that staff actions reject.
    if (!db.prepare("PRAGMA table_info(borrower_upload_access)").all().some((column) => column.name === "recipient")) {
      const columns = "loanId, tokenHash, email, codeHash, codeUntil, sendWindow, sendCount, sentAt, attempts, sessionHash, sessionUntil";
      db.exec(`CREATE TABLE borrower_upload_access_next (${borrowerUploadAccessColumns});
        INSERT INTO borrower_upload_access_next (${columns}) SELECT ${columns} FROM borrower_upload_access;
        DROP TABLE borrower_upload_access;
        ALTER TABLE borrower_upload_access_next RENAME TO borrower_upload_access;`);
    }
    const legacyInsurance = db.prepare(`SELECT request.id FROM pilot_scenario scenario
      JOIN document_requests request ON request.loanId = 'demo-presenter:' || scenario.id || ':closing'
      WHERE scenario.presenter = 1 AND request.id = request.loanId || ':insurance'
        AND request.kind = 'Homeowners insurance' AND request.submissionId IS NULL AND request.conditionId IS NULL`).get();
    if (typeof legacyInsurance?.id === "string") {
      const oldId = legacyInsurance.id;
      const newId = crypto.randomUUID();
      // Use a temporary kind while both rows exist under the per-loan unique index.
      db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status, replacementNote, submittedAt,
        revision, dueOn, deadlineRevision, submissionId, conditionId, recipient)
        SELECT ?, loanId, ?, instructions, requestedAt, status, replacementNote, submittedAt,
          revision, dueOn, deadlineRevision, submissionId, conditionId, recipient FROM document_requests WHERE id = ?`).run(newId, newId, oldId);
      for (const table of ["uwm_document_deliveries", "uwm_document_delivery_history", "mock_delivery_failures", "document_files"]) {
        db.prepare(`UPDATE ${table} SET requestId = ? WHERE requestId = ?`).run(newId, oldId);
      }
      db.prepare("DELETE FROM document_requests WHERE id = ?").run(oldId);
      db.prepare("UPDATE document_requests SET kind = 'Homeowners insurance' WHERE id = ?").run(newId);
    }
    const rateColumns = new Set(db.prepare("PRAGMA table_info(mock_uwm_rates)").all().map((column) => column.name));
    const mockOrderColumns = new Set(db.prepare("PRAGMA table_info(mock_credit_aus_runs)").all().map((column) => column.name));
    for (const [column, type] of Object.entries({ applicationRevision: "INTEGER", authorization: "TEXT", batchId: "TEXT", requestKey: "TEXT" })) {
      if (!mockOrderColumns.has(column)) db.exec(`ALTER TABLE mock_credit_aus_runs ADD COLUMN ${column} ${type}`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS initial_mock_order_by_batch ON mock_credit_aus_runs(batchId, service)
      WHERE batchId IS NOT NULL AND retryOf IS NULL`);
    if (!db.prepare("PRAGMA table_info(fee_worksheets)").all().some(({ name }) => name === "origin")) {
      db.exec("ALTER TABLE fee_worksheets ADD COLUMN origin TEXT");
    }
    for (const [column, type] of Object.entries({
      lockExtensionReference: "TEXT", lockExtensionDays: "INTEGER", lockCancellationReference: "TEXT", lockCancelledAt: "TEXT",
    })) {
      if (!rateColumns.has(column)) db.exec(`ALTER TABLE mock_uwm_rates ADD COLUMN ${column} ${type}`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS open_leads_by_due ON referral_leads(dueAt, id) WHERE resolvedAt IS NULL;
      CREATE INDEX IF NOT EXISTS active_leads_by_officer_due ON referral_leads(officerEmail, dueAt, id)
      WHERE resolvedAt IS NULL AND heldAt IS NULL;
      CREATE INDEX IF NOT EXISTS shared_realtor_claim_queue ON referral_leads(dueAt, id)
        WHERE resolvedAt IS NULL AND heldAt IS NULL AND officerEmail IS NULL AND realtorId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS shared_realtor_wait ON referral_leads(coalesce(realtorSharedSince, createdAt), id)
        WHERE resolvedAt IS NULL AND heldAt IS NULL AND officerEmail IS NULL AND realtorId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS open_contact_followups_by_officer_due ON contact_activity(followUpOwnerEmail, dueAt, id)
      WHERE completedAt IS NULL AND dueAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS departure_leads_by_owner ON referral_leads(officerEmail, id) WHERE resolvedAt IS NULL;
      CREATE INDEX IF NOT EXISTS departure_contact_work_by_owner ON contact_activity(followUpOwnerEmail, id)
        WHERE completedAt IS NULL AND dueAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS departure_reviews_by_requester ON loan_reviews(requesterEmail, id) WHERE status IN ('Requested', 'Changes requested');
      CREATE INDEX IF NOT EXISTS departure_reviews_by_reviewer ON loan_reviews(reviewerEmail, id) WHERE status IN ('Requested', 'Changes requested');
      CREATE INDEX IF NOT EXISTS loans_by_officer ON loans(officerEmail, id);
      CREATE INDEX IF NOT EXISTS loans_by_assignment_date ON loans(stageSince DESC, id);
      CREATE INDEX IF NOT EXISTS past_client_loans_by_officer ON loans(officerEmail, stageSince DESC, id)
        WHERE stage IN ('Funded', 'Closed');
      CREATE INDEX IF NOT EXISTS past_client_loans_by_stage_date ON loans(stageSince DESC, id)
        WHERE stage IN ('Funded', 'Closed');
      CREATE INDEX IF NOT EXISTS stalled_loans_by_officer_stage ON loans(officerEmail, julianday(stageSince), id)
        WHERE disposition = 'Active' AND stage NOT IN ('Funded', 'Closed');
      CREATE INDEX IF NOT EXISTS stalled_loans_by_stage_age ON loans(julianday(stageSince), id)
        WHERE disposition = 'Active' AND stage NOT IN ('Funded', 'Closed');
      CREATE INDEX IF NOT EXISTS referrals_by_loan ON referral_leads(loanId, createdAt, id) WHERE loanId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS referrals_by_cohort ON referral_leads(createdAt, id) WHERE realtorId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS leads_by_sales_intake ON referral_leads(createdAt, id);
      CREATE INDEX IF NOT EXISTS loans_by_sales_intake ON loans(strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(createdAt, stageSince)), id);
      CREATE INDEX IF NOT EXISTS campaign_members_by_cohort ON call_campaign_members(joinedAt, leadId);
      CREATE INDEX IF NOT EXISTS tasks_by_loan ON tasks(loanId);
      CREATE INDEX IF NOT EXISTS drafts_by_loan ON communication_drafts(loanId, createdAt);
      CREATE INDEX IF NOT EXISTS drafts_by_time ON communication_drafts(createdAt DESC, id DESC);
      CREATE INDEX IF NOT EXISTS shared_quotes_by_loan ON shared_quote_history(loanId, endedAt);
      CREATE INDEX IF NOT EXISTS open_tasks_by_loan_due ON tasks(loanId, dueAt, id) WHERE completedAt IS NULL;
      CREATE INDEX IF NOT EXISTS open_retention_tasks_by_loan_due ON tasks(loanId, dueAt, id)
        WHERE completedAt IS NULL AND (id GLOB 'rate-watch:*' OR id GLOB 'closing-anniversary:*');
      CREATE INDEX IF NOT EXISTS calendar_leads_by_due ON referral_leads(dueAt, id) WHERE resolvedAt IS NULL AND heldAt IS NULL;
      CREATE INDEX IF NOT EXISTS calendar_campaign_tasks_by_due ON lead_import_tasks(dueAt, id) WHERE completedAt IS NULL;
      CREATE INDEX IF NOT EXISTS calendar_contact_followups_by_due ON contact_activity(dueAt, id) WHERE completedAt IS NULL AND dueAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS calendar_loan_tasks_by_due ON tasks(dueAt, id) WHERE completedAt IS NULL;
      CREATE INDEX IF NOT EXISTS calendar_closing_items_by_due ON closing_items(dueDate, id) WHERE completedAt IS NULL;
      CREATE INDEX IF NOT EXISTS completed_loan_tasks_by_time ON tasks(completedAt, id) WHERE completedAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS completed_loan_tasks_by_loan ON tasks(loanId, completedAt, id) WHERE completedAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS completed_lead_tasks_by_time ON lead_import_tasks(completedAt, id) WHERE completedAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS completed_contact_tasks_by_time ON contact_activity(completedAt, id) WHERE completedAt IS NOT NULL AND dueAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS completed_contact_tasks_by_owner ON contact_activity(followUpOwnerEmail, completedAt, id)
        WHERE completedAt IS NOT NULL AND dueAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS completed_closing_items_by_time ON closing_items(completedAt, id) WHERE completedAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS reviewed_uwm_alerts_by_time ON uwm_alerts(reviewedAt, id) WHERE reviewedAt IS NOT NULL;
      CREATE INDEX IF NOT EXISTS active_locks_by_expiry ON mock_uwm_rates(lockExpiresAt, loanId) WHERE lockCancelledAt IS NULL;`);
    const targetSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sales_conversion_targets'").get()?.sql;
    if (typeof targetSchema === "string" && !targetSchema.includes("'Lead sources'")) {
      db.exec(`CREATE TABLE sales_conversion_targets_next (${salesTargetColumns});
        INSERT INTO sales_conversion_targets_next SELECT channel, windowDays, submitted, funded, revision FROM sales_conversion_targets;
        DROP TABLE sales_conversion_targets;
        ALTER TABLE sales_conversion_targets_next RENAME TO sales_conversion_targets;`);
    }
    closeReviewedApplicationFollowUps(db);
    createApplicationFollowUps(db);
    initializeRealtorReplyIndex(db);
    initializeContactOutreachIndex(db);
    initializeContactDuplicateQueue(db);
    initializeLeadReplyIndex(db);
    initializeBorrowerChannels(db);
    initializeProcessingConditions(db);
    if (db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('retiredClosingHoldDrafts', '1') RETURNING key").get()) {
      db.exec(`WITH pending AS MATERIALIZED (
        SELECT draft.id, ${reopenedMockUwmAtSql("draft.loanId")} AS since FROM communication_drafts draft
        WHERE draft.milestone = 'Clear to Close' AND draft.supersededAt IS NULL
      ) UPDATE communication_drafts AS draft SET supersededAt = pending.since
        FROM pending WHERE draft.id = pending.id AND pending.since IS NOT NULL`);
    }
    initializeCallReportReadiness(db);
    migrateCampaignOptOuts(db);
    if (!seedDemo || db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) return;
    const demo = demoRecords();
    for (const contact of demo.contacts) insertContact(db, contact);
    for (const loan of demo.loans) insertLoan(db, loan);
    for (const submission of demo.submissions) insertSubmission(db, submission);
    db.exec("INSERT INTO settings VALUES ('seeded', '1')");
  });
}

export function insertContact(db: Store, contact: Contact) {
  db.prepare("INSERT INTO contacts (id, name, email, phone, role, addedBy) VALUES (?, ?, ?, ?, ?, ?)")
    .run(contact.id, contact.name, contact.email, contact.phone, contact.role, contact.addedBy ?? null);
}

export function insertLoan(db: Store, loan: Loan) {
  db.prepare(`INSERT INTO loans (id, contactId, partnerId, officer, address, amount, purpose, stage, stageSince, officerEmail, leadSource, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(loan.id, loan.contactId, loan.partnerId, loan.officer, loan.address, loan.amount, loan.purpose, loan.stage, loan.stageSince, loan.officerEmail,
      loan.leadSource ?? (loan.partnerId ? "Realtor referral" : "Direct"), loan.createdAt ?? loan.stageSince);
}

export function insertSubmission(db: Store, submission: Submission) {
  db.prepare("INSERT INTO submissions (id, loanId, lender, externalId, status, conditions, syncedAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(submission.id, submission.loanId, submission.lender, submission.externalId, submission.status, JSON.stringify(submission.conditions), submission.syncedAt);
}

export function savedPricingRun(db: Store, loanId: string) {
  return db.prepare(`SELECT id, offers, selectedId, mode, quotedAt, applicationRevision, incomeReviewRevision,
    json_extract(scenario, '$.loanAmount') AS quotedAmount FROM pricing_runs
    WHERE loanId = ? AND selectedId IS NOT NULL ORDER BY selectedAt DESC, rowid DESC LIMIT 1`).get(loanId);
}

function rows<T>(db: Store, query: string, ...params: SqlValue[]) {
  // Both stores are owned by the schema above. Copy rows into plain objects for React and Workers RPC.
  return db.prepare(query).all(...params).map((row) => ({ ...row }) as T);
}

export function readBrokerageTemplates(db: Store) {
  return rows<BrokerageTemplate>(db, "SELECT audience, milestone, body, revision FROM brokerage_templates");
}

function quoteRows<T extends PublishedQuote>(db: Store, query: string, ...args: SqlValue[]) {
  return rows<Omit<T, "presentation"> & { presentation: string | null }>(db, query, ...args)
    .map((row) => ({ ...row, presentation: row.presentation ? JSON.parse(row.presentation) as QuotePresentation : null }));
}

export function loanWorkRecords(db: Store, includeReports: boolean, loanId?: string) {
  const args = loanId ? [loanId] : [];
  const where = (column = "loanId") => loanId ? `WHERE ${column} = ?` : "";
  const callbacks = new Map(carriedCallbacks(db, loanId).map((callback) => [callback.taskId, callback]));
  return {
    loans: rows<Loan>(db, `SELECT loans.*,
      (SELECT createdAt FROM activity WHERE loanId = loans.id ORDER BY createdAt DESC LIMIT 1) AS lastActivityAt,
      (SELECT createdAt FROM activity WHERE loanId = loans.id AND kind <> 'Note' ORDER BY createdAt DESC LIMIT 1) AS lastOutreachAt,
      (SELECT realtorId FROM referral_leads WHERE loanId = loans.id ORDER BY createdAt, id LIMIT 1) AS referralSourcePartnerId,
      (SELECT campaign.name FROM referral_leads lead JOIN call_campaign_members member ON member.leadId = lead.id
        JOIN call_campaigns campaign ON campaign.id = member.campaignId WHERE lead.loanId = loans.id) AS callCampaignName
      FROM loans ${where("id")} ORDER BY stageSince DESC, id`, ...args),
    submissions: rows<Omit<Submission, "conditions"> & { conditions: string }>(db, `SELECT * FROM submissions ${where()} ORDER BY lender, id`, ...args)
      .map((row) => ({ ...row, conditions: JSON.parse(row.conditions) })),
    tasks: rows<LoanTask>(db, `SELECT * FROM tasks ${where()} ORDER BY completedAt IS NOT NULL, dueAt, id`, ...args)
      .map((task): LoanTask => {
        const callback = callbacks.get(task.id);
        if (!callback || (task.completedAt && !callback.attemptEventId)) return task;
        return callback.attemptEventId ? { ...task, campaignCallback: "Recorded" } :
          { ...task, campaignCallback: "Pending", campaignCallbackRevision: callback.revision };
      }),
    communicationDrafts: rows<CommunicationDraft>(db, `SELECT id, loanId, contactId, audience, milestone,
      createdAt, emailCopiedAt, textCopiedAt, supersededAt FROM communication_drafts ${where()} ORDER BY createdAt DESC, rowid DESC`, ...args),
    pastClients: rows<Omit<PastClientProfile, "watchEnabled"> & { watchEnabled: number }>(db, `SELECT loanId, closingDate, currentRate, targetRate, observedRate, checkedAt, watchEnabled, note, revision FROM past_client_profiles ${where()}`, ...args)
      .map((profile) => ({ ...profile, watchEnabled: Boolean(profile.watchEnabled) })),
    closingPlans: rows<ClosingPlan>(db, `SELECT loanId, targetDate FROM closing_plans ${where()}`, ...args),
    closingItems: rows<ClosingItem>(db, `SELECT * FROM closing_items ${where()} ORDER BY completedAt IS NOT NULL, dueDate, id`, ...args),
    closingProgress: rows<ClosingProgress>(db, `SELECT * FROM closing_progress ${where()}`, ...args),
    loanProcessing: rows<LoanProcessing>(db, `SELECT * FROM loan_processing ${where()}`, ...args),
    callReportFiles: includeReports ? callReportFiles(db, loanId) : null,
    mismoLoans: rows<{ loanId: string }>(db, `SELECT loanId FROM mismo_rehearsals ${where()}`, ...args).map((row) => row.loanId),
    applications: staffApplications(db, loanId),
    documentRequests: rows<Omit<LoanDocumentRequest, "previousUwmDeliveries">>(db, `SELECT requests.*, deliveries.receipt AS uwmReceipt, deliveries.sentAt AS uwmSentAt,
      failures.failedAt AS uwmDeliveryFailedAt, origin.revision AS templateRevision, json_extract(version.config, '$.title') AS templateTitle,
      origin.applicationRevision AS templateApplicationRevision, ${pdfColumns()}
      FROM document_requests requests LEFT JOIN uwm_document_deliveries deliveries ON deliveries.requestId = requests.id
      LEFT JOIN document_files files ON files.requestId = requests.id
      LEFT JOIN mock_delivery_failures failures ON failures.requestId = requests.id AND failures.revision = requests.revision
      LEFT JOIN document_checklist_origins origin ON origin.requestId = requests.id
      LEFT JOIN document_checklist_versions version ON version.templateId = origin.templateId AND version.revision = origin.revision
      ${where("requests.loanId")} ORDER BY requests.requestedAt, requests.id`, ...args).map(({ templateTitle, templateRevision, templateApplicationRevision, ...request }) =>
      ({ ...request, ...(templateTitle ? { templateTitle, templateRevision } : {}),
        ...(templateApplicationRevision !== null ? { templateApplicationRevision } : {}), previousUwmDeliveries: db.prepare(`SELECT receipt, sentAt, documentRevision
        FROM uwm_document_delivery_history WHERE requestId = ? ORDER BY sentAt DESC`).all(request.id) as LoanDocumentRequest["previousUwmDeliveries"] })),
    pricingRuns: rows<Omit<PricingRun, "scenario" | "offers" | "notices" | "incomeReviewCurrent"> &
      { scenario: string; offers: string; notices: string; incomeReviewCurrent: number }>(db, `
      SELECT run.*, (run.incomeReviewRevision IS NULL OR EXISTS (${approvedIncomeSql("run.loanId", "run.incomeReviewRevision")})) AS incomeReviewCurrent
      FROM pricing_runs run
      WHERE ${loanId ? "run.loanId = ? AND " : ""}(run.id = (SELECT latest.id FROM pricing_runs latest WHERE latest.loanId = run.loanId ORDER BY latest.quotedAt DESC, latest.rowid DESC LIMIT 1)
         OR run.selectedId IS NOT NULL
         OR EXISTS (SELECT 1 FROM loan_scenario_plans plan JOIN json_each(plan.plan, '$.options') option
           WHERE plan.loanId = run.loanId AND json_extract(option.value, '$.quoteSource.runId') = run.id))
      ORDER BY run.quotedAt DESC, run.rowid DESC
    `, ...args).map((run) => ({ ...run, scenario: JSON.parse(run.scenario), offers: JSON.parse(run.offers), notices: JSON.parse(run.notices),
      incomeReviewCurrent: Boolean(run.incomeReviewCurrent) })),
    feeWorksheets: rows<Omit<FeeWorksheet, "inputs" | "origin"> & { inputs: string; origin: string | null }>(db, `SELECT pricing_runs.loanId, worksheet.*
      FROM fee_worksheets worksheet JOIN pricing_runs ON pricing_runs.id = worksheet.runId ${where("pricing_runs.loanId")}`, ...args)
      .map(({ inputs, origin, ...row }) => ({ ...row, inputs: JSON.parse(inputs), ...(origin ? { origin: JSON.parse(origin) } : {}) })),
    publishedQuotes: quoteRows<PublishedQuote>(db, `SELECT * FROM published_quotes ${where()}`, ...args),
    sharedQuoteHistory: quoteRows<SharedQuoteEvent>(db, `SELECT * FROM shared_quote_history ${where()} ORDER BY endedAt DESC, rowid DESC`, ...args),
    mockUwmRates: rows<MockUwmRate & { quotedAmount: number | null; quoteRevision: number | null }>(db, `
      SELECT rate.*, json_extract(run.scenario, '$.loanAmount') AS quotedAmount, run.applicationRevision AS quoteRevision
      FROM mock_uwm_rates rate LEFT JOIN pricing_runs run ON run.id = rate.runId AND run.loanId = rate.loanId
      ${where("rate.loanId")}`, ...args).map(({ quotedAmount, quoteRevision, ...rate }) => ({
        ...rate, ...(typeof quotedAmount === "number" ? { quoteTerms: { loanAmount: quotedAmount, applicationRevision: quoteRevision } } : {}),
      })),
    mockCreditAusRuns: mockCreditAusRuns(db, loanId),
    uwmAlerts: rows<UwmAlert>(db, `SELECT * FROM uwm_alerts ${where()} ORDER BY detectedAt DESC, rowid DESC`, ...args),
  };
}

type InboxLeadRow = Omit<InboxLead, "followUp" | "matches" | "restrictedMatch" | "importedTasks" | "outreachSuppressed" | "outreachHours">;

function inboxLeadRows(db: Store, leadIds?: string | string[]) {
  const scope = typeof leadIds === "string" ? "AND lead.id = ?" : leadIds ? "AND lead.id IN (SELECT value FROM json_each(?))" : "";
  return rows<InboxLeadRow & { contactHours: string | null; intakeProfile: string | null; intakeRevision: number | null;
    intakeAnswers: string | null; routingReceipt: string | null }>(db,
    `SELECT lead.id, lead.realtorId, contacts.name AS realtorName,
      lead.name, lead.email, lead.phone, lead.purpose, lead.officer, lead.officerEmail, lead.createdAt, lead.dueAt, lead.zip, lead.importedContactId,
      lead.heldAt, lead.holdReason, lead.revisitDate, ${leadChannelBlocksSql} AS outreachChannelBlocks,
      ${leadBorrowerHoursSql} AS contactHours,
      coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) AS source,
      member.campaignId, member.callbackTaskId AS campaignTaskId, coalesce(member.lastOutcome = 'Opted out', 0) AS campaignOptedOut,
      receipt.profile AS intakeProfile, receipt.formRevision AS intakeRevision, receipt.structuredAnswers AS intakeAnswers, receipt.routingReceipt
    FROM referral_leads lead LEFT JOIN contacts ON contacts.id = lead.realtorId
    LEFT JOIN call_campaign_members member ON member.leadId = lead.id
    LEFT JOIN quote_intake_receipts receipt ON receipt.leadId = lead.id
    WHERE lead.resolvedAt IS NULL ${scope}
    ORDER BY lead.dueAt, lead.id`, ...(leadIds ? [typeof leadIds === "string" ? leadIds : JSON.stringify(leadIds)] : []))
    .map(({ contactHours, intakeProfile, intakeRevision, intakeAnswers, routingReceipt, ...lead }) => {
      const outreachHours = storedBorrowerHours(contactHours);
      const intake = quoteIntakeEvidence(intakeProfile, intakeRevision, intakeAnswers);
      const initialRouting = storedQuoteRouting(routingReceipt);
      return { ...lead, ...(outreachHours ? { outreachHours } : {}), ...(intake ? { intake } : {}), ...(initialRouting ? { initialRouting } : {}) };
    });
}

function inboxLeadDetails(db: Store, lead: InboxLeadRow, suppression: Set<string>, contacts: Contact[]): InboxLead {
  return { ...lead, campaignOptedOut: Boolean(lead.campaignOptedOut),
    outreachSuppressed: Boolean(lead.campaignOptedOut) || outreachSuppressed(suppression, { ...lead, leadId: lead.id, contactId: lead.importedContactId }),
    followUp: leadFollowUp(db, lead.id),
    importedTasks: rows<InboxLead["importedTasks"][number]>(db, "SELECT id, title, dueAt, completedAt, purpose FROM lead_import_tasks WHERE leadId = ? ORDER BY dueAt, id", lead.id),
    matches: referralMatches(lead, contacts), restrictedMatch: false };
}

const officerCampaignLead = "(lead.officerEmail = ? OR (lead.officerEmail IS NULL AND lead.realtorId IS NULL))";
const officerCampaignFile = "loan.officerEmail = ?";

function campaignRows(db: Store, campaignId?: string, includeRouting = true, officerEmail?: string) {
  const filter = campaignId ? "WHERE campaign.id = ?" : officerEmail ? `WHERE EXISTS (
    SELECT 1 FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    LEFT JOIN loans loan ON loan.id = lead.loanId WHERE member.campaignId = campaign.id
      AND ((lead.resolvedAt IS NULL AND ${officerCampaignLead}) OR ${officerCampaignFile})
  )` : "";
  return rows<CallCampaign>(db, `SELECT campaign.id, campaign.name, campaign.createdAt,
      coalesce(rules.revision, 0) AS revision, coalesce(rules.voicemailDays, ?) AS voicemailDays,
      coalesce(rules.noResponseDays, ?) AS noResponseDays, coalesce(rules.maxAttempts, ?) AS maxAttempts,
      coalesce(rules.retryTime, ?) AS retryTime, coalesce(rules.automaticPaused, 0) AS automaticPaused
    FROM call_campaigns campaign LEFT JOIN call_campaign_rules rules ON rules.campaignId = campaign.id
    ${filter} ORDER BY campaign.createdAt DESC, campaign.id`,
    defaultCampaignRules.voicemailDays, defaultCampaignRules.noResponseDays, defaultCampaignRules.maxAttempts, defaultCampaignRules.retryTime,
    ...(campaignId ? [campaignId] : officerEmail ? [officerEmail, officerEmail] : []))
    .map((campaign) => {
      const routing = includeRouting && readCampaignRouting(db, campaign.id);
      return { ...campaign, automaticPaused: Boolean(campaign.automaticPaused),
        ...(includeRouting && campaignId ? { sequenceConfig: campaignSequenceConfig(db, campaignId) } : {}),
        ...(routing ? { routing: { enabled: routing.enabled, revision: routing.revision, officers: routing.officers } } : {}) };
    });
}

function campaignMemberRows(db: Store, suppression: Set<string>, leadIds?: string | string[]) {
  const scope = typeof leadIds === "string" ? "WHERE member.leadId = ?" : leadIds ? "WHERE member.leadId IN (SELECT value FROM json_each(?))" : "";
  return rows<Omit<CallCampaignMember, "outreachSuppressed"> & { email: string; phone: string; contactId: string | null;
    runId: string | null; runDueAt: string | null; requestEventId: string | null; promisedDueAt: string | null;
    sequencePosition: number; sequenceDueAt: string | null; sequenceTitle: string | null; sequencePaused: number;
    sequenceChannel: NonNullable<CallCampaignMember["sequence"]>["channel"] }>(db,
    `SELECT member.campaignId, member.leadId, member.segmentId, segment.name AS segmentName,
      lead.name, lead.resolvedAt, lead.loanId, lead.email, lead.phone, coalesce(loan.contactId, lead.importedContactId) AS contactId,
      member.attempts, member.lastOutcome, member.reachedAt, member.retryExhaustedAt, member.callbackTaskId,
      CASE WHEN task.completedAt IS NULL THEN task.dueAt END AS callbackDueAt,
      template.kind AS sequenceKind, sequence.position AS sequencePosition, sequence.dueAt AS sequenceDueAt, (sequence.outcome IS 'Paused') AS sequencePaused,
      json_extract(template.steps, '$[' || sequence.position || '].title') AS sequenceTitle,
      json_extract(template.steps, '$[' || sequence.position || '].channel') AS sequenceChannel,
      CASE WHEN run.status IN ('Failed', 'Paused') THEN run.status END AS followUpRunStatus, run.id AS runId, run.dueAt AS runDueAt,
      CASE WHEN run.status = 'Completed' AND run.outcome = 'Requested callback' AND run.taskId = task.id
        AND task.completedAt IS NULL AND task.leadId = member.leadId AND lead.resolvedAt IS NULL AND ${openCallbackPromise}
        THEN run.promiseRequestEventId END AS requestEventId, coalesce(run.promiseDueAt, run.dueAt) AS promisedDueAt
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    LEFT JOIN loans loan ON loan.id = lead.loanId
    LEFT JOIN crm_segments segment ON segment.id = member.segmentId
    LEFT JOIN lead_import_tasks task ON task.id = member.callbackTaskId
    LEFT JOIN campaign_sequence_enrollments sequence ON sequence.leadId = member.leadId
    LEFT JOIN campaign_sequence_versions template ON template.version = sequence.version
    LEFT JOIN campaign_follow_up_runs run ON run.leadId = lead.id AND run.campaignId = member.campaignId AND run.callNumber = member.attempts
      AND run.outcome = member.lastOutcome
    ${scope} ORDER BY member.joinedAt, member.leadId`, ...(leadIds ? [typeof leadIds === "string" ? leadIds : JSON.stringify(leadIds)] : []))
    .map(({ email, phone, contactId, runId, runDueAt, requestEventId, promisedDueAt,
      sequenceKind, sequencePosition, sequenceDueAt, sequenceTitle, sequencePaused, sequenceChannel, ...member }) => ({ ...member,
      ...(sequenceKind ? { sequenceKind } : {}),
      ...(sequenceDueAt && sequenceTitle ? { sequence: { position: sequencePosition, dueAt: sequenceDueAt, title: sequenceTitle,
        paused: Boolean(sequencePaused), channel: sequenceChannel } } : {}),
      ...(member.followUpRunStatus && runId && runDueAt ? { followUpRun: { id: runId, dueAt: runDueAt } } : {}),
      ...(requestEventId && runDueAt && promisedDueAt ? { callbackPromise: { requestEventId, originalDueAt: runDueAt, dueAt: promisedDueAt } } : {}),
      outreachSuppressed: member.lastOutcome === "Opted out" || outreachSuppressed(suppression, { email, phone, contactId, leadId: member.leadId }) }));
}

export function leadContactCandidates(db: Store, lead: Pick<InboxLeadRow, "email" | "phone">) {
  const phone = referralPhone(lead.phone);
  const fields = "contact.id, contact.name, contact.role, contact.email, contact.phone";
  // Older imports may contain a nonstandard phone that the outreach index intentionally omits.
  if (phone && !/^\d{10,15}$/.test(phone)) {
    return rows<Contact>(db, `SELECT ${fields} FROM contacts contact WHERE contact.role <> 'Realtor' ORDER BY contact.name COLLATE NOCASE`);
  }
  const keys = outreachIdentityKeys(lead);
  if (!keys.length) return [];
  indexPendingContactOutreach(db);
  return rows<Contact>(db, `SELECT ${fields} FROM contacts contact WHERE contact.id IN (
    SELECT contactId FROM contact_outreach_keys WHERE identityKey IN (SELECT value FROM json_each(?))
    UNION SELECT contactId FROM contact_outreach_pending
  ) ORDER BY contact.name COLLATE NOCASE`, JSON.stringify(keys));
}

function leadDetailsForWork(db: Store, lead: InboxLeadRow, suppression: Set<string>, officerEmail?: string) {
  const details = inboxLeadDetails(db, lead, suppression, leadContactCandidates(db, lead));
  if (officerEmail && details.matches.length) {
    const visible = new Set(db.prepare(`SELECT contact.id FROM contacts contact
      WHERE contact.id IN (SELECT value FROM json_each(?))
      AND (contact.addedBy = ? OR EXISTS (SELECT 1 FROM loans WHERE contactId = contact.id AND officerEmail = ?)
        OR EXISTS (SELECT 1 FROM loans WHERE partnerId = contact.id AND officerEmail = ?))`)
      .all(JSON.stringify(details.matches.map(({ id }) => id)), officerEmail, officerEmail, officerEmail).map(({ id }) => id));
    details.restrictedMatch = visible.size < details.matches.length;
    details.matches = details.matches.filter(({ id }) => visible.has(id));
  }
  return details;
}

export function leadWorkRecord(db: Store, leadId: string, officerEmail?: string) {
  const lead = inboxLeadRows(db, leadId)[0];
  if (!lead) return null;
  const identity = { ...lead, leadId: lead.id, contactId: lead.importedContactId };
  const suppression = blockedOutreachKeys(db, [identity]);
  return {
    lead: leadDetailsForWork(db, lead, suppression, officerEmail),
    campaign: lead.campaignId ? campaignRows(db, lead.campaignId, !officerEmail)[0] ?? null : null,
    member: lead.campaignId ? campaignMemberRows(db, suppression, lead.id)[0] ?? null : null,
  };
}

function unlinkedReferralRows(db: Store, leadIds?: string[]) {
  return rows<UnlinkedReferral>(db, `SELECT id, realtorId, name, createdAt, resolvedAt, officer, officerEmail
    FROM referral_leads WHERE loanId IS NULL AND realtorId IS NOT NULL
    ${leadIds ? "AND id IN (SELECT value FROM json_each(?))" : ""} ORDER BY createdAt DESC, id`,
    ...(leadIds ? [JSON.stringify(leadIds)] : []));
}

export function campaignWorkPatch(db: Store, campaignId: string, leadIds: string[], includeReports: boolean): CampaignWorkPatch {
  const leads = leadIds.length ? inboxLeadRows(db, leadIds).filter((lead) => lead.campaignId === campaignId) : [];
  const ids = leads.map(({ id }) => id);
  const suppression = blockedOutreachKeys(db, leads.map((lead) => ({ ...lead, leadId: lead.id, contactId: lead.importedContactId })));
  return {
    inboxLeads: leads.map((lead) => inboxLeadDetails(db, lead, suppression, leadContactCandidates(db, lead))),
    callCampaignMembers: campaignMemberRows(db, suppression, ids),
    campaignResponses: campaignResponses(db, ids),
    unlinkedReferrals: unlinkedReferralRows(db, ids),
    managerRecords: includeReports ? managerReportRecords(db, suppression, ids) : [],
    campaignRehearsal: readCampaignRehearsal(db),
  };
}

export function readCampaignQueue(db: Store, campaignId: string, staff: WorkspaceStaff | null): CampaignQueueSnapshot {
  const empty: CampaignQueueSnapshot = { campaignId, campaign: null, inboxLeads: [], members: [], responses: [], files: [], rehearsal: null };
  if (staff?.brokerage.role === "Processor") return empty;
  const officerEmail = staff?.brokerage.role === "LO" ? staff.email : undefined;
  const campaign = campaignRows(db, campaignId, !officerEmail)[0];
  if (!campaign) return empty;
  const visible = rows<{ leadId: string; loanId: string | null; email: string; phone: string; contactId: string | null;
    importedContactId: string | null; canReadLead: number; canReadFile: number }>(db, `
    SELECT member.leadId, loan.id AS loanId, lead.email, lead.phone, coalesce(loan.contactId, lead.importedContactId) AS contactId,
      lead.importedContactId,
      lead.resolvedAt IS NULL ${officerEmail ? `AND ${officerCampaignLead}` : ""} AS canReadLead,
      loan.id IS NOT NULL ${officerEmail ? `AND ${officerCampaignFile}` : ""} AS canReadFile
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    LEFT JOIN loans loan ON loan.id = lead.loanId
    WHERE member.campaignId = ? ${officerEmail ? "AND (canReadLead OR canReadFile)" : ""}
  `, ...(officerEmail ? [officerEmail, officerEmail] : []), campaignId);
  if (officerEmail && !visible.length) return empty;
  const leadIds = visible.map(({ leadId }) => leadId);
  const openIds = visible.filter(({ canReadLead }) => canReadLead).map(({ leadId }) => leadId);
  const fileIds = new Set(visible.flatMap(({ loanId, canReadFile }) => loanId && canReadFile ? [loanId] : []));
  const suppression = blockedOutreachKeys(db, visible.flatMap((identity) => [
    identity, ...(identity.canReadLead && identity.contactId !== identity.importedContactId ? [{ ...identity, contactId: identity.importedContactId }] : []),
  ]));
  const members = campaignMemberRows(db, suppression, leadIds).map((member) =>
    member.loanId && !fileIds.has(member.loanId) ? { ...member, loanId: null } : member);
  const rehearsal = readCampaignRehearsal(db);
  const buyer = members.find(({ leadId }) => leadId === rehearsal?.leadId);
  return { campaignId, campaign, members,
    inboxLeads: inboxLeadRows(db, openIds).map((lead) => leadDetailsForWork(db, lead, suppression, officerEmail)),
    responses: officerEmail ? [] : campaignResponses(db, leadIds),
    files: fileIds.size ? rows<CampaignQueueFile>(db, `
      SELECT loan.id, loan.officer, loan.stage, loan.amount, progress.fundingDate,
        coalesce((SELECT version.submittedAt FROM application_versions version WHERE version.loanId = loan.id
          ORDER BY version.revision LIMIT 1), app.submittedAt) AS submittedAt
      FROM loans loan LEFT JOIN closing_progress progress ON progress.loanId = loan.id
      LEFT JOIN applications app ON app.loanId = loan.id
      WHERE loan.id IN (SELECT value FROM json_each(?)) ORDER BY loan.id`, JSON.stringify([...fileIds])) : [],
    rehearsal: rehearsal?.campaignId === campaignId ? !officerEmail ? rehearsal : buyer ?
      { campaignId, leadId: rehearsal.leadId, importedCount: rehearsal.importedCount,
        ...(rehearsal.checkInActivityId && buyer.loanId && fileIds.has(buyer.loanId) ? { checkInActivityId: rehearsal.checkInActivityId } : {}) } : null : null,
  };
}

export function crmSegmentRows(db: Store) {
  return rows<Omit<CrmSegment, "customFilter"> & { customFilter: string | null }>(db,
    "SELECT id, name, kind, quietDays, revision, customFilter FROM crm_segments ORDER BY name, id")
    .map(({ customFilter, ...segment }): CrmSegment => customFilter === null ? segment :
      { ...segment, customFilter: crmFieldFilter.parse(JSON.parse(customFilter)) });
}

function campaignLeadOptions(db: Store): CampaignLeadOption[] {
  const leads = rows<CampaignLeadOption & { email: string; contactId: string | null }>(db, `
    SELECT lead.id, lead.name, lead.phone, lead.email, lead.importedContactId AS contactId
    FROM referral_leads lead WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND lead.phone <> ''
      AND NOT EXISTS (SELECT 1 FROM call_campaign_members WHERE leadId = lead.id)
    ORDER BY lead.dueAt, lead.id`);
  const suppression = blockedOutreachKeys(db, leads.map((lead) => ({ ...lead, leadId: lead.id })));
  return leads.flatMap((lead) => assignableCampaignLead({ phone: lead.phone,
    outreachSuppressed: outreachSuppressed(suppression, { ...lead, leadId: lead.id }) }) ?
    [{ id: lead.id, name: lead.name, phone: lead.phone }] : []);
}

export function readCampaignNavigation(db: Store, preferredId: string | undefined, staff: WorkspaceStaff | null, loadIntake: boolean): CampaignNavigation {
  if (staff?.brokerage.role === "Processor") return { campaigns: [], queue: null };
  const campaigns = campaignRows(db, undefined, false, staff?.brokerage.role === "LO" ? staff.email : undefined);
  const selected = campaigns.find(({ id }) => id === preferredId) ?? campaigns[0];
  return { campaigns, queue: selected ? readCampaignQueue(db, selected.id, staff) : null,
    ...(loadIntake && (!staff || (staff.brokerage.role === "Admin" && staff.brokerage.pilot)) ?
      { intake: { segments: crmSegmentRows(db), availableLeads: campaignLeadOptions(db) } } : {}),
  };
}

export function workspace(db: Store, includeReports = false): Workspace {
  const suppression = outreachSuppressionKeys(db);
  const contacts = rows<Contact>(db, `SELECT contact.*, coalesce(channels.blocked, 0) AS outreachChannelBlocks
    FROM contacts contact LEFT JOIN borrower_contact_channels channels ON channels.contactId = contact.id
    ORDER BY contact.name COLLATE NOCASE`).map((contact) => ({
    ...contact, outreachSuppressed: contact.role !== "Realtor" && outreachSuppressed(suppression, { ...contact, contactId: contact.id }),
  }));
  const referralLeads = rows<ReferralLead>(db, `SELECT lead.id, lead.realtorId, contacts.name AS realtorName,
      lead.name, lead.email, lead.phone, lead.purpose, lead.officer, lead.officerEmail, lead.createdAt, lead.dueAt
    FROM referral_leads lead JOIN contacts ON contacts.id = lead.realtorId
    WHERE lead.resolvedAt IS NULL ORDER BY lead.dueAt, lead.id`)
    .map((lead) => ({ ...lead, matches: referralMatches(lead, contacts), restrictedMatch: false }));
  return {
    ...loanWorkRecords(db, includeReports),
    contacts,
    followUpContacts: [],
    contactActivity: rows<Omit<ContactActivity, "latestCompletion" | "postFundingCheckIn"> & { completion: string | null; postFundingCheckIn: number }>(db, `SELECT activity.*,
      EXISTS (SELECT 1 FROM funding_check_ins checkIn WHERE checkIn.activityId = activity.id) AS postFundingCheckIn,
      ${contactCompletionSql} AS completion FROM contact_activity activity WHERE activity.dueAt IS NOT NULL ORDER BY activity.createdAt DESC, activity.id`)
      .map(({ completion, postFundingCheckIn, ...item }) => ({
        ...item, postFundingCheckIn: Boolean(postFundingCheckIn), latestCompletion: completion ? JSON.parse(completion) : null,
      })),
    brokerageTemplates: readBrokerageTemplates(db),
    returningClientLoans: rows<Workspace["returningClientLoans"][number]>(db, "SELECT fundedLoanId, loanId FROM returning_client_loans"),
    realtorPortals: rows<RealtorPortal>(db, "SELECT realtorId, token, expiresAt, officerEmail, revision FROM realtor_portals"),
    referralLeads,
    inboxLeads: inboxLeadRows(db).map((lead) => inboxLeadDetails(db, lead, suppression, contacts)),
    leadRouting: leadRouting(db),
    realtorClaimPolicy: readRealtorClaimPolicy(db),
    crmSegments: crmSegmentRows(db),
    callCampaigns: campaignRows(db),
    callCampaignMembers: campaignMemberRows(db, suppression),
    playbook: readPlaybook(db),
    demoGuide: demoGuideState(db),
    campaignRehearsal: readCampaignRehearsal(db),
    managerReports: includeReports ? managerReports(db, suppression) : null,
    campaignResponses: campaignResponses(db),
    unlinkedReferrals: unlinkedReferralRows(db),
    mockUwmChangesApplied: !!db.prepare("SELECT 1 FROM settings WHERE key = 'mockUwmChangesApplied'").get(),
    uwmSyncedAt: (db.prepare("SELECT value FROM settings WHERE key = 'uwmSyncedAt'").get()?.value as string | undefined) ?? null,
  };
}

export function readWorkspace(db: Store, includeReports = false) {
  return db.transaction(() => {
    synchronizeRetentionTasks(db);
    return workspace(db, includeReports);
  });
}

export function readStaffWorkspaceEntry(db: Store, staff: WorkspaceStaff): Workspace {
  return db.transaction(() => {
    const { role } = staff.brokerage;
    if (role !== "Processor") synchronizeRetentionTasks(db, new Date(), role === "LO" ? { officerEmail: staff.email } : undefined);
    const settings = readPlaybook(db);
    return {
      contacts: [], followUpContacts: [], loans: [], submissions: [], contactActivity: [], tasks: [],
      communicationDrafts: [], brokerageTemplates: readBrokerageTemplates(db),
      pastClients: [], closingPlans: [], closingItems: [], closingProgress: [], returningClientLoans: [], loanProcessing: [],
      realtorPortals: [], referralLeads: [], inboxLeads: [], leadRouting: null, callCampaigns: [], crmSegments: [],
      campaignResponses: [], callCampaignMembers: [],
      playbook: role === "Admin" ? settings : { ...settings, backupEmail: null, secondReview: null },
      demoGuide: null, campaignRehearsal: null, managerReports: null, callReportFiles: null, mismoLoans: [], unlinkedReferrals: [],
      applications: [], documentRequests: [], pricingRuns: [], feeWorksheets: [], publishedQuotes: [], sharedQuoteHistory: [],
      mockUwmRates: [], mockCreditAusRuns: [], uwmAlerts: [], mockUwmChangesApplied: false, uwmSyncedAt: null,
    };
  });
}
