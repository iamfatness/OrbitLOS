import { queueAutomationEvent } from "./automation-events";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { applicationDraft, applicationIssues, applicationSteps, blankApplication, manualHandoffOutcomes, requestedLoanAmount, splitLegacyAddress, type AddressLocation, type ApplicationDraft, type BorrowerResult, type StaffApplication } from "./application-model";
import type { Store } from "./store";
import { createApplicationFollowUps } from "./tasks";
import { createMilestoneDrafts } from "./communications";
import { borrowerDetailsSchema, lenderDetailsSchema, normalizeBorrowerDetails, normalizeUrla, type BorrowerDetails } from "./urla";
import { coBorrowerDocumentRecipient, needsBorrowerDocument, primaryDocumentRecipient, type BorrowerLoanStatus, type DocumentRecipient, type DocumentRequest } from "./document-model";
import { sharedQuoteExpired } from "./shared-quote-model";
import { readBorrowerFinancingRequest } from "./realtor-financing";
import { readSharedPreapprovalLetters } from "./preapproval-sharing";
import { portalToken, portalTokenPattern } from "./brokerage-model";
import type { BorrowerQuote } from "./pricing-model";
import { approvedIncomeSql, pricingInputError } from "./income-review-freshness";
import { borrowerQuotePresentation } from "./quote-worksheet";
import { borrowerDocuments } from "./borrower-documents";
import { accessEvent } from "./workspace-access";
import { loanAuditSnapshot, recordLoanAudit } from "./loan-audit";
import { zipCityState } from "./zip-city-state";
import { approvedSecondReview, currentManualExportPrepared, currentManualLenderSubmission, hasRecordedLenderRejection, lastManualLenderSubmission } from "./application-review-checkpoint";
import type { LoanNextActionState } from "./loan-workflow";
import { activeCoBorrowerLink, jointApplication, staffJointApplications } from "./joint-application";
import { coBorrowerCommand, coBorrowerSubmissionIssues, jointLinkUnavailable, primaryJointDraft, type CoBorrowerApplication } from "./joint-application-model";
import { readClosingPauses } from "./processing-conditions";
import { borrowerChannelActivityPrefix, borrowerChannelBlocked, borrowerChannelMask, borrowerChannels } from "./borrower-channel-model";
import { linkedChannelLeadIds, readBorrowerHours, readContactChannelBlocks, setBorrowerHours, setContactChannelBlocks } from "./borrower-channels";
import { reconcileBorrowerSequences } from "./borrower-sequences";
import { borrowerHoursInput, borrowerHoursLabel, sameBorrowerHours } from "./borrower-hours";
import { borrowerDisclosureResponse } from "./disclosure-model";
import { readBorrowerDisclosure, respondToBorrowerDisclosure } from "./disclosures";
import { answerBorrowerQuestion } from "./borrower-question-model";
import { borrowerQuestions, recordBorrowerAnswer } from "./borrower-questions";
import { loanOutreachSuppressed } from "./outreach-preferences";
import { defaultLenderExportProfile, lenderExportProfile } from "./lender-export-model";
import { sameManualQuote, type ManualQuoteBasis } from "./manual-pricing-model";
import { applicationQuestionnaireInput } from "./application-questionnaire-model";
import { pinApplicationQuestionnaire, prepareApplicationAnswers, readApplicationQuestionnaire,
  sameApplicationAnswers, saveApplicationAnswers } from "./application-questionnaires";
import { brokerAgreementStates } from "./state-broker-agreement-model";

type ApplicationRow = Omit<StaffApplication, "draft" | "draftHasPropertyStreet" | "brokerAgreementState" | "joint" | "lender" | "manualHandoff" | "lastManualSubmissionId" | "currentManualExportPrepared" | "lastExportProfile" |
  "versions" | "previousAnswers" | "secondReviewApproved" | "uwmPendingReceipt" | "manualLenderRejected"> & { draft: string; step: number };
type BorrowerStatusRow = Pick<ApplicationRow, "loanId" | "submittedAt" | "reviewedAt" | "correctionNote" | "revision">;

export function getApplication(db: Store, loanId: string) {
  return db.prepare("SELECT * FROM applications WHERE loanId = ?").get(loanId) as ApplicationRow | undefined;
}

export function staffApplications(db: Store, loanId?: string): StaffApplication[] {
  const filter = loanId ? " WHERE loanId = ?" : "";
  const args = loanId ? [loanId] : [];
  const joints = staffJointApplications(db, loanId);
  const lender = new Map(db.prepare(`SELECT * FROM application_lender_details${filter}`).all(...args).map((item) => [item.loanId, {
    details: lenderDetailsSchema.parse(JSON.parse(String(item.details))), revision: Number(item.revision),
  }]));
  const handoffs = new Map<string, NonNullable<StaffApplication["manualHandoff"]>>();
  for (const event of db.prepare(`SELECT event.loanId, event.outcome, event.submissionId, event.exportProfile, event.quoteBasis,
    event.activityId, event.exportDigest FROM application_handoff_events event
    JOIN activity ON activity.id = event.activityId
    JOIN applications app ON app.loanId = event.loanId AND app.revision = event.applicationRevision AND app.reviewedAt IS NOT NULL
    LEFT JOIN application_lender_details details ON details.loanId = event.loanId
    WHERE event.lenderRevision = coalesce(details.revision, 0)${loanId ? " AND event.loanId = ?" : ""} ORDER BY activity.rowid DESC`).all(...args)) {
    const loanId = String(event.loanId);
    const handoff = handoffs.get(loanId) ?? { exportPrepared: false, outcome: null };
    const basis = event.quoteBasis ? JSON.parse(String(event.quoteBasis)) as ManualQuoteBasis : null;
    if (event.outcome === "Export prepared") {
      const profile = lenderExportProfile.safeParse(event.exportProfile ?? defaultLenderExportProfile);
      if (profile.success && event.exportDigest &&
        !handoff.preparedExports?.some((item) => item.profile === profile.data && sameManualQuote(item.quote, basis))) {
        (handoff.preparedExports ??= []).push({ eventId: String(event.activityId), profile: profile.data,
          ...(basis ? { quote: { runId: basis.runId, offerId: basis.offerId } } : {}) });
      }
      if (!basis) {
        handoff.exportPrepared = true;
        if (profile.success && !handoff.exportProfiles?.includes(profile.data)) (handoff.exportProfiles ??= []).push(profile.data);
      } else if (profile.success && !handoff.preparedQuotes?.some((item) => sameManualQuote(item, basis) && item.profile === profile.data)) {
        (handoff.preparedQuotes ??= []).push({ runId: basis.runId, offerId: basis.offerId, profile: profile.data });
      }
    }
    else if (!handoff.outcome) {
      handoff.outcome = manualHandoffOutcomes.find((outcome) => outcome === event.outcome) ?? null;
      if (handoff.outcome === "Acknowledged" && typeof event.submissionId === "string") handoff.submissionId = event.submissionId;
      if (handoff.outcome === "Acknowledged" && basis) handoff.acknowledgedQuote = basis;
    }
    handoffs.set(loanId, handoff);
  }
  return db.prepare(`SELECT app.*, CASE WHEN app.submittedAt IS NOT NULL THEN ${approvedSecondReview} ELSE 0 END AS secondReviewApproved,
    pending.revision AS pendingRevision, pending.attemptedAt AS pendingAttemptedAt,
    ${currentManualLenderSubmission} AS currentManualFile, ${currentManualExportPrepared} AS currentManualExportPrepared,
    ${lastManualLenderSubmission} AS lastManualSubmissionId, ${hasRecordedLenderRejection} AS manualLenderRejected,
    (SELECT event.exportProfile FROM application_handoff_events event JOIN activity ON activity.id = event.activityId
      WHERE event.loanId = app.loanId AND event.outcome = 'Export prepared'
      ORDER BY event.applicationRevision DESC, event.lenderRevision DESC, activity.rowid DESC LIMIT 1) AS lastExportProfile
    FROM applications app LEFT JOIN mock_uwm_acceptances pending ON pending.loanId = app.loanId AND pending.reconciledAt IS NULL
    ${loanId ? "WHERE app.loanId = ?" : ""}`).all(...args).map((value) => {
    const row = value as ApplicationRow & { secondReviewApproved: number; lastManualSubmissionId: string | null; lastExportProfile: string | null;
      currentManualFile: string | null; currentManualExportPrepared: number; manualLenderRejected: number;
      pendingRevision: number | null; pendingAttemptedAt: string | null };
    const draft = JSON.parse(row.draft);
    const draftState = typeof draft?.propertyLocation?.state === "string" ? draft.propertyLocation.state.trim().toUpperCase() : "";
    const brokerAgreementState = brokerAgreementStates.find(state => state === draftState);
    const prior = db.prepare(`SELECT draft FROM application_versions WHERE loanId = ? AND revision < ?
      ORDER BY reviewedAt IS NOT NULL DESC, revision DESC LIMIT 1`).get(row.loanId, row.revision);
    const versions = db.prepare("SELECT revision, submittedAt, reviewedAt, uwmReceipt, uwmSentAt FROM application_versions WHERE loanId = ? ORDER BY revision DESC")
      .all(row.loanId).map((item) => ({
        revision: Number(item.revision), submittedAt: String(item.submittedAt), reviewedAt: item.reviewedAt as string | null,
        uwmReceipt: typeof item.uwmReceipt === "string" && typeof item.uwmSentAt === "string"
          ? { reference: item.uwmReceipt, sentAt: item.uwmSentAt } : null,
      }));
    const manualHandoff = handoffs.get(row.loanId);
    if (manualHandoff?.submissionId && !row.currentManualFile) manualHandoff.acknowledgmentOutdated = true;
    if (manualHandoff?.exportProfiles?.length === 1 && manualHandoff.exportProfiles[0] === defaultLenderExportProfile) {
      delete manualHandoff.exportProfiles;
    }
    const lastManualSubmissionId = manualHandoff?.submissionId ?? row.lastManualSubmissionId;
    const joint = joints.get(row.loanId);
    const lastExportProfile = lenderExportProfile.safeParse(row.lastExportProfile);
    return {
      loanId: row.loanId, token: row.token, expiresAt: row.expiresAt, revokedAt: row.revokedAt, updatedAt: row.updatedAt,
      submittedAt: row.submittedAt, reviewedAt: row.reviewedAt, secondReviewApproved: Boolean(row.secondReviewApproved), uwmReference: row.uwmReference,
      ...(row.pendingRevision !== null && row.pendingAttemptedAt ? { uwmPendingReceipt: { revision: row.pendingRevision, attemptedAt: row.pendingAttemptedAt } } : {}),
      draft: row.submittedAt ? applicationDraft.parse(draft) : null,
      ...(brokerAgreementState ? { brokerAgreementState } : {}),
      ...(!row.submittedAt && typeof draft?.propertyAddress === "string" && draft.propertyAddress.trim()
        ? { draftHasPropertyStreet: true } : {}),
      lender: lender.get(row.loanId) ?? null,
      manualHandoff, ...(row.currentManualExportPrepared ? { currentManualExportPrepared: true } : {}),
      ...(lastExportProfile.success ? { lastExportProfile: lastExportProfile.data } : {}),
      ...(typeof lastManualSubmissionId === "string" ? { lastManualSubmissionId } : {}),
      ...(row.manualLenderRejected ? { manualLenderRejected: true } : {}),
      revision: row.revision, correctionNote: row.correctionNote, versions,
      previousAnswers: prior ? applicationDraft.parse(JSON.parse(String(prior.draft))) : null,
      ...(joint ? { joint } : {}),
    };
  });
}

type ActionApplication = LoanNextActionState["applications"][number] & { requestedAmount: number | null };
type ActionApplicationRow = Omit<ActionApplication, "versions" | "secondReviewApproved" | "lastManualSubmissionId" | "requestedAmount" | "uwmPendingReceipt"> & {
  requestedAmount: string | null;
  secondReviewApproved: number; uwmReceipt: string | null; uwmSentAt: string | null;
  manualSubmissionId: string | null; exportPrepared: number; lastManualSubmissionId: string | null; rejected: number;
  pendingRevision: number | null; pendingAttemptedAt: string | null;
};

export function loanActionApplications(db: Store, loanIds: string[]): ActionApplication[] {
  if (!loanIds.length) return [];
  const rows = db.prepare(`SELECT app.loanId, app.submittedAt, app.reviewedAt, app.revision, app.uwmReference,
    CASE WHEN app.correctionNote <> '' THEN 'Pending' ELSE '' END AS correctionNote,
    CASE WHEN app.submittedAt IS NOT NULL AND coalesce(app.correctionNote, '') = '' THEN json_extract(app.draft, '$.loanAmount') END AS requestedAmount,
    ${approvedSecondReview} AS secondReviewApproved, version.uwmReceipt, version.uwmSentAt,
    ${currentManualLenderSubmission} AS manualSubmissionId, ${currentManualExportPrepared} AS exportPrepared,
    ${lastManualLenderSubmission} AS lastManualSubmissionId, ${hasRecordedLenderRejection} AS rejected,
    pending.revision AS pendingRevision, pending.attemptedAt AS pendingAttemptedAt
    FROM applications app LEFT JOIN application_versions version ON version.loanId = app.loanId AND version.revision = app.revision
    LEFT JOIN mock_uwm_acceptances pending ON pending.loanId = app.loanId AND pending.reconciledAt IS NULL
    WHERE app.loanId IN (SELECT value FROM json_each(?))`).all(JSON.stringify(loanIds)) as unknown as ActionApplicationRow[];
  return rows.map(({ secondReviewApproved, uwmReceipt, uwmSentAt, manualSubmissionId, exportPrepared,
    lastManualSubmissionId, rejected, pendingRevision, pendingAttemptedAt, ...app }) => ({
    ...app, requestedAmount: requestedLoanAmount(app.requestedAmount), secondReviewApproved: Boolean(secondReviewApproved),
    versions: typeof uwmReceipt === "string" && typeof uwmSentAt === "string"
      ? [{ revision: app.revision, uwmReceipt: { reference: uwmReceipt, sentAt: uwmSentAt } }] : [],
    ...(manualSubmissionId ? { manualHandoff: { outcome: "Acknowledged", submissionId: manualSubmissionId, exportPrepared: Boolean(exportPrepared) } } : {}),
    ...(exportPrepared ? { currentManualExportPrepared: true } : {}),
    ...(lastManualSubmissionId ? { lastManualSubmissionId } : {}),
    ...(rejected ? { manualLenderRejected: true } : {}),
    ...(pendingRevision !== null && pendingAttemptedAt ? {
      uwmPendingReceipt: { revision: pendingRevision, attemptedAt: pendingAttemptedAt },
    } : {}),
  }));
}

export function saveApplicationVersion(db: Store, row: ApplicationRow) {
  if (!row.submittedAt) return;
  db.prepare(`INSERT INTO application_versions (loanId, revision, draft, submittedAt, reviewedAt) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (loanId, revision) DO UPDATE SET reviewedAt = excluded.reviewedAt`)
    .run(row.loanId, row.revision, row.draft, row.submittedAt, row.reviewedAt);
}

export function addApplicationActivity(db: Store, loanId: string, text: string, now: string) {
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
    .run(crypto.randomUUID(), loanId, text, now);
}

function fillPropertyLocality(location: AddressLocation): AddressLocation {
  if (location.city && location.state) return location;
  const locality = zipCityState(location.zip);
  if (!locality || (location.state && location.state.trim().toUpperCase() !== locality.state)) return location;
  return { ...location, city: location.city || locality.city, state: location.state || locality.state };
}

export function startApplication(db: Store, loanId: string, now: string, brokerageId?: string,
  intake?: { email?: string; phone?: string; propertyZip?: string; propertyAddress?: string; propertyState?: string;
    reviewedFields?: Partial<Pick<ApplicationDraft, "occupancy" | "loanAmount" | "estimatedValue">> }) {
  const loan = db.prepare(`SELECT loans.address, loans.amount, loans.purpose, contacts.name, contacts.email, contacts.phone
    FROM loans JOIN contacts ON contacts.id = loans.contactId WHERE loans.id = ?`).get(loanId);
  if (!loan) return false;
  const existing = getApplication(db, loanId);
  if (existing && !existing.revokedAt && existing.expiresAt > now) return true;

  const token = portalToken(brokerageId);
  const expiresAt = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
  if (existing) {
    db.prepare("UPDATE applications SET token = ?, expiresAt = ?, revokedAt = NULL WHERE loanId = ?").run(token, expiresAt, loanId);
    return true;
  }
  const property = splitLegacyAddress(intake?.propertyAddress ?? String(loan.address));
  const zip = property.location.zip || intake?.propertyZip || "";
  const email = intake?.email || String(loan.email);
  const purpose = loan.purpose === "Refinance" ? "Refinance" : "Purchase";
  const draft: ApplicationDraft = {
    ...blankApplication(), borrowerName: String(loan.name), propertyAddress: property.street,
    propertyLocation: fillPropertyLocality({ ...property.location, zip, state: property.location.state || intake?.propertyState || "" }),
    email: email.length <= 160 ? email : "", phone: intake?.phone || String(loan.phone),
    loanAmount: Number(loan.amount) > 0 ? String(loan.amount) : "",
    purpose,
    ...intake?.reviewedFields,
  };
  db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run(loanId, token, expiresAt, JSON.stringify(draft), now);
  pinApplicationQuestionnaire(db, loanId, purpose);
  addApplicationActivity(db, loanId, "Demo 1003 link created.", now);
  return true;
}

const token = z.string().regex(portalTokenPattern);
const write = {
  token, draft: applicationDraft,
  questionnaire: applicationQuestionnaireInput,
  revision: z.number().int().min(0),
  step: z.number().int().min(0).max(applicationSteps.length - 1),
};
const borrowerCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), token }),
  z.object({ type: z.literal("status"), token }),
  borrowerDisclosureResponse,
  answerBorrowerQuestion,
  z.strictObject({ type: z.literal("contactPreferences"), token }),
  z.strictObject({ type: z.literal("saveContactPreferences"), token, expected: borrowerChannelMask, blocked: borrowerChannelMask,
    hours: z.strictObject({ expected: borrowerHoursInput.nullable(), value: borrowerHoursInput.nullable() }).optional() }),
  z.object({ type: z.literal("save"), ...write }),
  z.object({ type: z.literal("submit"), ...write }),
  z.object({ type: z.literal("attachSample"), token, requestId: z.uuid(), revision: z.number().int().nonnegative(), statusOnly: z.boolean().optional() }),
]);
const borrowerLink = "FROM applications WHERE token = ? AND expiresAt > ? AND revokedAt IS NULL";
const borrowerLinkUnavailable = { status: 404, error: "This application link is invalid or expired. Ask your loan officer for a new link." };

function borrowerContactPreferences(db: Store, data: Extract<z.infer<typeof borrowerCommand>,
  { type: "contactPreferences" | "saveContactPreferences" }>, now: string): BorrowerResult {
  const row = db.prepare(`SELECT loanId ${borrowerLink}`).get(data.token, now);
  const contact = row && db.prepare(`SELECT contact.id FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
    WHERE loan.id = ? AND contact.role <> 'Realtor'`).get(row.loanId);
  if (!row || !contact) return borrowerLinkUnavailable;
  const loanId = String(row.loanId);
  const contactId = String(contact.id);
  const blocked = readContactChannelBlocks(db, contactId);
  const optedOut = loanOutreachSuppressed(db, loanId);
  const hours = readBorrowerHours(db, contactId);
  const view = (blocked: number, hours: ReturnType<typeof readBorrowerHours>): BorrowerResult =>
    ({ preferences: { blocked, optedOut, ...(hours ? { hours } : {}) } });
  if (data.type === "contactPreferences") return view(blocked, hours);
  if (optedOut) return { status: 409, error: "An outreach opt-out is active. Ask your loan team if you need to change it." };
  const nextHours = data.hours ? data.hours.value : hours;
  const hoursChanged = !sameBorrowerHours(hours, nextHours);
  if (blocked === data.blocked && !hoursChanged) return view(blocked, hours);
  if (blocked !== data.expected || (data.hours && !sameBorrowerHours(hours, data.hours.expected))) {
    return { status: 409, error: "Your contact preferences changed. Refresh preferences and try again." };
  }
  if (blocked !== data.blocked) setContactChannelBlocks(db, contactId, data.blocked);
  if (hoursChanged) setBorrowerHours(db, contactId, nextHours);
  reconcileBorrowerSequences(db, linkedChannelLeadIds(db, contactId), now);
  const labels = { Call: "Calls", Email: "Email", Text: "Texts" };
  const changes = borrowerChannels.filter((channel) => borrowerChannelBlocked(blocked ^ data.blocked, channel))
    .map((channel) => `${labels[channel]} ${borrowerChannelBlocked(data.blocked, channel) ? "blocked" : "allowed"}`);
  if (hoursChanged) changes.push(nextHours ? `Preferred contact hours ${borrowerHoursLabel(nextHours)}` : "Preferred contact hours cleared");
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
    .run(`${borrowerChannelActivityPrefix}${crypto.randomUUID()}`, loanId, `Borrower updated contact preferences · ${changes.join(" · ")}`, now);
  return view(data.blocked, nextHours);
}

function readBorrowerLoanStatus(db: Store, row: BorrowerStatusRow, token: string, now: string, sampleSigning: boolean, pilot: boolean): BorrowerLoanStatus | null {
  const loan = row.submittedAt ? db.prepare("SELECT stage, stageSince FROM loans WHERE id = ?").get(row.loanId) : null;
  const published = loan && !row.correctionNote && db.prepare(`SELECT quote.product, quote.rate, quote.principalAndInterest,
    quote.quotedAt, quote.publishedAt, quote.presentation, quote.expiresOn FROM published_quotes quote
    JOIN pricing_runs run ON run.id = quote.runId AND run.loanId = quote.loanId
    WHERE quote.loanId = ? AND run.applicationRevision = ?
      AND (run.incomeReviewRevision IS NULL OR EXISTS (${approvedIncomeSql("run.loanId", "run.incomeReviewRevision")}))`).get(row.loanId, row.revision);
  const presentation = published && published.presentation ? JSON.parse(String(published.presentation)) as BorrowerQuote["presentation"] : null;
  const currentAlternatives = presentation?.alternatives.every((option) => {
    const run = db.prepare("SELECT applicationRevision, incomeReviewRevision FROM pricing_runs WHERE id = ? AND loanId = ?").get(option.runId, row.loanId);
    return run && !pricingInputError(db, row.loanId, { applicationRevision: run.applicationRevision, incomeReviewRevision: run.incomeReviewRevision }, row);
  }) ?? true;
  const preapproval = loan && row.reviewedAt && !row.correctionNote &&
    readSharedPreapprovalLetters(db, [row.loanId], "Borrower", token, now).get(row.loanId);
  const closingPause = loan?.stage === "Clear to Close" ? readClosingPauses(db, [row.loanId]).get(row.loanId) : undefined;
  const disclosure = loan && sampleSigning ? readBorrowerDisclosure(db, row.loanId, "Borrower") : undefined;
  const questions = loan && sampleSigning ? borrowerQuestions(db, row.loanId, primaryDocumentRecipient) : [];
  const expiresOn = published && typeof published.expiresOn === "string" ? published.expiresOn : null;
  const expired = currentAlternatives && sharedQuoteExpired(expiresOn, new Date(now));
  const realtorFinancing = loan && pilot ? readBorrowerFinancingRequest(db, row.loanId, "Borrower", token, now) : null;
  return loan ? {
    stage: loan.stage as BorrowerLoanStatus["stage"], stageSince: String(loan.stageSince), reviewed: Boolean(row.reviewedAt),
    documents: borrowerDocuments(db, row.loanId, primaryDocumentRecipient),
    ...(questions.length ? { questions } : {}),
    quote: published && currentAlternatives && !expired ? { ...published, presentation: borrowerQuotePresentation(presentation) } as unknown as BorrowerQuote : null,
    ...(expired && expiresOn ? { quoteExpiredOn: expiresOn } : {}),
    ...(preapproval ? { preapproval } : {}),
    ...(realtorFinancing ? { realtorFinancing } : {}),
    ...(closingPause ? { closingPause } : {}),
    ...(disclosure ? { disclosure } : {}),
  } : null;
}

function borrowerResult(db: Store, row: ApplicationRow, now: string, sampleSigning: boolean, pilot: boolean): BorrowerResult {
  const joint = jointApplication(db, row.loanId);
  const stored = applicationDraft.parse(JSON.parse(row.draft));
  const draft = joint ? primaryJointDraft(stored) : stored;
  const questionnaire = !row.submittedAt && !joint?.primarySubmittedAt
    ? readApplicationQuestionnaire(db, row.loanId, primaryDocumentRecipient) : undefined;
  if (!row.submittedAt) draft.propertyLocation = fillPropertyLocality(draft.propertyLocation);
  return { application: {
    draft,
    step: row.step, revision: row.revision, updatedAt: row.updatedAt, submittedAt: row.submittedAt ?? joint?.primarySubmittedAt ?? null,
    loanStatus: readBorrowerLoanStatus(db, row, row.token, now, sampleSigning, pilot),
    correctionNote: !joint?.primarySubmittedAt && row.correctionNote ? row.correctionNote : undefined,
    ...(questionnaire ? { questionnaire } : {}),
    ...(joint ? { separateJoint: true } : {}),
  } };
}

function saveBorrowerDraft(db: Store, row: ApplicationRow, draft: ApplicationDraft, step: number, now: string, submitted: boolean) {
  const next: ApplicationRow = { ...row, draft: JSON.stringify(draft), step, revision: row.revision + 1,
    updatedAt: now, submittedAt: submitted ? now : null, correctionNote: submitted ? "" : row.correctionNote };
  db.prepare("UPDATE applications SET draft = ?, step = ?, revision = ?, updatedAt = ?, submittedAt = ?, correctionNote = ? WHERE loanId = ?")
    .run(next.draft, next.step, next.revision, next.updatedAt, next.submittedAt, next.correctionNote, next.loanId);
  return next;
}

function finishApplication(db: Store, row: ApplicationRow, draft: ApplicationDraft, step: number, now: string, pilot: boolean) {
  const auditBefore = loanAuditSnapshot(db, row.loanId);
  const next = saveBorrowerDraft(db, row, draft, step, now, true);
  saveApplicationVersion(db, next);
  queueAutomationEvent(db, { eventType: "application.submitted", kind: "loan", id: row.loanId,
    revision: next.revision, origin: "Borrower portal" }, now);
  const { unit, city, state, zip } = draft.propertyLocation;
  const propertyPending = draft.purpose === "Purchase" && draft.urla.property.fields.propertyPending === "Yes";
  const locality = `${city}, ${state.toUpperCase()} ${zip}`;
  const street = [draft.propertyAddress, unit].filter(Boolean).join(", ");
  const address = propertyPending ? "" : `${street.slice(0, 238 - locality.length).trimEnd()}, ${locality}`;
  db.prepare(`UPDATE loans SET
    stage = CASE WHEN disposition = 'Active' AND stage IN ('Lead', 'Pre-qual') THEN 'Application' ELSE stage END,
    stageSince = CASE WHEN disposition = 'Active' AND stage IN ('Lead', 'Pre-qual') THEN ? ELSE stageSince END,
    address = CASE WHEN trim(address) = '' THEN ? ELSE address END,
    amount = CASE WHEN amount = 0 THEN ? ELSE amount END
    WHERE id = ?`).run(now, address, Math.round(Number(draft.loanAmount)), row.loanId);
  createApplicationFollowUps(db, row.loanId);
  if (row.correctionNote) {
    db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Review corrected 1003', ?)
      ON CONFLICT(id) DO NOTHING`).run(`application-correction:${row.loanId}:${next.revision}`, row.loanId, new Date(Date.parse(now) + 86_400_000).toISOString());
  }
  createMilestoneDrafts(db, row.loanId, "Application received", now);
  addApplicationActivity(db, row.loanId, row.correctionNote ? "Corrected 1003 received." : "Demo 1003 received. Follow-up task created for the loan officer.", now);
  recordLoanAudit(db, row.loanId, "Borrower", "Submitted 1003", now, auditBefore);
  if (pilot) accessEvent(db, { name: "Borrower", email: "Borrower" }, "Pilot 1003 submitted", row.loanId, now);
  return next;
}

function combinedJointDraft(primary: ApplicationDraft, coBorrower: BorrowerDetails): ApplicationDraft {
  return { ...primary, urla: { ...primary.urla, additional: [coBorrower] } };
}

function invalidApplication(issues: string[]) {
  return { status: 422, error: `Complete these items before submitting: ${issues.join("; ")}.` };
}

function attachBorrowerSample(db: Store, row: Pick<BorrowerStatusRow, "loanId" | "submittedAt">, data: { requestId: string; revision: number },
  allowSample: boolean, now: string, recipient: DocumentRecipient = primaryDocumentRecipient) {
  if (!allowSample) return { status: 409, error: "Use the verified PDF upload for this checklist." };
  if (!row.submittedAt) return { status: 409, error: "Submit your application to open the document checklist." };
  const request = db.prepare("SELECT kind, status, revision FROM document_requests WHERE id = ? AND loanId = ? AND recipient = ?")
    .get(data.requestId, row.loanId, recipient);
  if (!request) return { status: 404, error: "This document request is unavailable." };
  if (db.prepare("SELECT 1 FROM document_files WHERE requestId = ? AND (objectId IS NOT NULL OR pendingUntil > ?)").get(data.requestId, Date.parse(now))) {
    return { status: 409, error: "Continue with the PDF upload for this request." };
  }
  if (request.status === "Received" && request.revision === data.revision + 1) return null;
  if (request.revision !== data.revision || !needsBorrowerDocument(request.status as DocumentRequest["status"])) {
    return { status: 409, error: "This document request changed. Refresh status before attaching a sample." };
  }
  db.prepare("UPDATE document_requests SET status = 'Received', submittedAt = ?, revision = revision + 1 WHERE id = ?")
    .run(now, data.requestId);
  addApplicationActivity(db, row.loanId, `Sample document received · ${request.kind}${recipient === coBorrowerDocumentRecipient ? ` · ${recipient}` : ""}`, now);
  return null;
}

export function borrowerCommandResult(db: Store, input: unknown, allowSample = true, pilot = false, sampleSigning = true): BorrowerResult {
  const parsed = borrowerCommand.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Check the length of your answers and use valid amounts, then try again." };
  const data = parsed.data;
  const now = new Date().toISOString();
  return db.transaction(() => {
    if (data.type === "contactPreferences" || data.type === "saveContactPreferences") return borrowerContactPreferences(db, data, now);
    if (data.type === "status" || data.type === "respondToSampleDisclosure" || data.type === "answerBorrowerQuestion" || (data.type === "attachSample" && data.statusOnly)) {
      const row = db.prepare(`SELECT loanId, submittedAt, reviewedAt, correctionNote, revision ${borrowerLink}`)
        .get(data.token, now) as BorrowerStatusRow | undefined;
      if (!row) return borrowerLinkUnavailable;
      if (data.type === "respondToSampleDisclosure") {
        if (!sampleSigning || !row.submittedAt) return { status: 404, error: "This sample package is unavailable." };
        const failure = respondToBorrowerDisclosure(db, row.loanId, "Borrower", data, now);
        if (failure) return failure;
      }
      if (data.type === "answerBorrowerQuestion") {
        if (!sampleSigning || !row.submittedAt) return { status: 404, error: "This question is unavailable." };
        const failure = recordBorrowerAnswer(db, row.loanId, primaryDocumentRecipient, data, now);
        if (failure) return failure;
      }
      if (!row.submittedAt) {
        const submittedAt = jointApplication(db, row.loanId)?.primarySubmittedAt;
        return { statusView: submittedAt ? { kind: "joint-waiting", submittedAt } : { kind: "resume" } };
      }
      if (data.type === "attachSample") {
        const failure = attachBorrowerSample(db, row, data, allowSample, now);
        if (failure) return failure;
      }
      const loanStatus = readBorrowerLoanStatus(db, row, data.token, now, sampleSigning, pilot);
      return loanStatus ? { statusView: { kind: "status", submittedAt: row.submittedAt, loanStatus } } : borrowerLinkUnavailable;
    }
    const row = db.prepare(`SELECT * ${borrowerLink}`).get(data.token, now) as ApplicationRow | undefined;
    if (!row) return borrowerLinkUnavailable;
    if (data.type === "read") return borrowerResult(db, row, now, sampleSigning, pilot);
    if (data.type === "attachSample") {
      return attachBorrowerSample(db, row, data, allowSample, now) ?? borrowerResult(db, row, now, sampleSigning, pilot);
    }
    const submitted = data.type === "submit";
    const joint = jointApplication(db, row.loanId);
    const primaryReady = joint?.primarySubmittedAt;
    const alreadySubmitted = { status: 409, error: "This application has been submitted. Reopen the link to see your loan status." };
    if (primaryReady && (!submitted || row.step !== data.step)) return alreadySubmitted;
    if (!primaryReady && row.submittedAt && (!submitted || row.revision !== data.revision + 1 || row.step !== data.step)) return alreadySubmitted;
    if (!primaryReady && !row.submittedAt && row.revision !== data.revision) {
      return { status: 409, error: "This application was updated in another tab. Reopen the link to continue from the latest saved draft." };
    }
    const questionnaire = readApplicationQuestionnaire(db, row.loanId, primaryDocumentRecipient);
    const prepared = prepareApplicationAnswers(questionnaire, data.questionnaire, submitted);
    if (prepared && "error" in prepared) return prepared;

    const inputDraft = joint ? primaryJointDraft(data.draft) : data.draft;
    const normalized = normalizeUrla(inputDraft.urla, false);
    if (normalized.issues.length) return { status: 422, error: "Use a fictional tax ID in the format 000-00-1234 and only four digits for account references." };
    const draft = { ...inputDraft, urla: normalized.details };
    const work = draft.urla.primary.work;
    if (work.fields.hasJobs || work.fields.hasIncome) {
      const jobs = work.fields.hasJobs === "Yes" ? work.groups.jobs ?? [] : [];
      const current = jobs.filter((job) => job.status === "Current");
      const incomeKeys = ["base", "overtime", "bonus", "commission", "military", "other", "business"];
      const other = work.fields.hasIncome === "Yes" ? work.groups.income ?? [] : [];
      const amounts = [...current.flatMap((job) => incomeKeys.map((key) => job[key])), ...other.map((item) => item.monthly)];
      const monthlyIncome = amounts.reduce((total, item) => total + (Number(item) || 0), 0);
      draft.employer = current[0]?.employer?.slice(0, 160) ?? "";
      draft.monthlyIncome = Math.min(1_000_000_000, Math.max(0, monthlyIncome)).toFixed(2);
    }
    if (primaryReady) {
      const stored = primaryJointDraft(applicationDraft.parse(JSON.parse(row.draft)));
      return isDeepStrictEqual(draft, stored) && sameApplicationAnswers(questionnaire, prepared)
        ? borrowerResult(db, row, now, sampleSigning, pilot) : alreadySubmitted;
    }
    if (row.submittedAt) {
      return isDeepStrictEqual(JSON.parse(JSON.stringify(draft)), JSON.parse(row.draft)) && sameApplicationAnswers(questionnaire, prepared)
        ? borrowerResult(db, row, now, sampleSigning, pilot) : alreadySubmitted;
    }
    if (submitted) {
      const issues = applicationIssues(draft, !!joint);
      if (issues.length) return invalidApplication(issues);
    }
    if (prepared) saveApplicationAnswers(db, row.loanId, primaryDocumentRecipient, prepared, submitted ? now : null, row.revision + 1);
    if (!submitted) return borrowerResult(db, saveBorrowerDraft(db, row, draft, data.step, now, false), now, sampleSigning, pilot);
    const combined = joint?.submittedAt ? combinedJointDraft(draft, borrowerDetailsSchema.parse(JSON.parse(joint.draft))) : draft;
    if (joint) {
      db.prepare("UPDATE joint_applications SET primarySubmittedAt = ? WHERE loanId = ?").run(now, row.loanId);
      addApplicationActivity(db, row.loanId, "Primary borrower submitted their portion of the joint 1003.", now);
    }
    const next = joint && !joint.submittedAt ? saveBorrowerDraft(db, row, draft, data.step, now, false) :
      finishApplication(db, row, combined, data.step, now, pilot);
    return borrowerResult(db, next, now, sampleSigning, pilot);
  });
}

export function coBorrowerCommandResult(db: Store, input: unknown, pilot = false, now = new Date().toISOString(), sampleSigning = true):
  { value: CoBorrowerApplication } | { status: number; error: string } {
  const parsed = coBorrowerCommand.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Check the length and format of your answers." };
  const data = parsed.data;
  return db.transaction(() => {
    const row = activeCoBorrowerLink(db, data.token, now);
    const application = row && getApplication(db, row.loanId);
    if (!row || !application) return { status: 404, error: jointLinkUnavailable };
    const current = borrowerDetailsSchema.parse(JSON.parse(row.draft));
    const view = (draft = current, revision = row.revision, step = row.step, updatedAt = row.updatedAt,
      submittedAt = row.submittedAt, complete = Boolean(application.submittedAt), confirmedDemo = Boolean(row.confirmedDemo)): { value: CoBorrowerApplication } => {
      const closingPause = complete && submittedAt ? readClosingPauses(db, [row.loanId]).get(row.loanId) : undefined;
      const disclosure = complete && submittedAt && sampleSigning ? readBorrowerDisclosure(db, row.loanId, "Co-borrower") : undefined;
      const questions = complete && submittedAt && sampleSigning ? borrowerQuestions(db, row.loanId, coBorrowerDocumentRecipient) : [];
      const realtorFinancing = complete && submittedAt && pilot ? readBorrowerFinancingRequest(db, row.loanId, "Co-borrower", data.token, now) : null;
      const questionnaire = !submittedAt ? readApplicationQuestionnaire(db, row.loanId, coBorrowerDocumentRecipient) : undefined;
      return { value: { draft, revision, step, updatedAt, submittedAt, complete, confirmedDemo,
        ...(complete && submittedAt ? { documents: borrowerDocuments(db, row.loanId, coBorrowerDocumentRecipient) } : {}),
        ...(questions.length ? { questions } : {}),
        ...(questionnaire ? { questionnaire } : {}),
        ...(realtorFinancing ? { realtorFinancing } : {}),
        ...(closingPause ? { closingPause } : {}),
        ...(disclosure ? { disclosure } : {}),
        ...(row.correctionNote && !submittedAt ? { correctionNote: row.correctionNote } : {}) } };
    };
    if (data.type === "read") return view();
    if (data.type === "respondToSampleDisclosure") {
      if (!sampleSigning || !row.submittedAt || !application.submittedAt) return { status: 404, error: "This sample package is unavailable." };
      return respondToBorrowerDisclosure(db, row.loanId, "Co-borrower", data, now) ?? view();
    }
    if (data.type === "answerBorrowerQuestion") {
      if (!sampleSigning || !row.submittedAt || !application.submittedAt) return { status: 404, error: "This question is unavailable." };
      return recordBorrowerAnswer(db, row.loanId, coBorrowerDocumentRecipient, data, now) ?? view();
    }
    if (data.type === "attachSample") {
      const ready = row.submittedAt && application.submittedAt;
      return attachBorrowerSample(db, { loanId: row.loanId, submittedAt: ready }, data, true, now, coBorrowerDocumentRecipient) ?? view();
    }
    const submitted = data.type === "submit";
    const questionnaire = readApplicationQuestionnaire(db, row.loanId, coBorrowerDocumentRecipient);
    const prepared = prepareApplicationAnswers(questionnaire, data.questionnaire, submitted);
    if (prepared && "error" in prepared) return prepared;
    const { borrower, issues } = normalizeBorrowerDetails(data.draft, false, false, true);
    if (issues.length) return { status: 422, error: "Use a fictional tax ID in the format 000-00-1234 and only four digits for account references." };
    if (row.submittedAt) {
      return submitted && row.revision === data.revision + 1 && row.step === data.step && data.confirmedDemo &&
        isDeepStrictEqual(borrower, current) && sameApplicationAnswers(questionnaire, prepared)
        ? view() : { status: 409, error: "Your portion has already been submitted. Reopen the link to check its status." };
    }
    if (row.revision !== data.revision) return { status: 409, error: "Your draft changed in another tab. Reopen the link to load the latest answers." };
    if (submitted) {
      const missing = coBorrowerSubmissionIssues(borrower, data.confirmedDemo);
      if (missing.length) return invalidApplication(missing);
    }
    const submittedAt = submitted ? now : null;
    if (prepared) saveApplicationAnswers(db, row.loanId, coBorrowerDocumentRecipient, prepared, submittedAt, row.revision + 1);
    db.prepare(`UPDATE joint_applications SET draft = ?, step = ?, revision = revision + 1, updatedAt = ?, submittedAt = ?,
      confirmedDemo = ?, correctionNote = CASE WHEN ? IS NULL THEN correctionNote ELSE '' END WHERE loanId = ?`)
      .run(JSON.stringify(borrower), data.step, now, submittedAt, Number(data.confirmedDemo), submittedAt, row.loanId);
    const complete = submitted && Boolean(row.primarySubmittedAt);
    if (submitted) {
      addApplicationActivity(db, row.loanId, "Co-borrower submitted their portion of the joint 1003.", now);
      if (complete) {
        const primary = primaryJointDraft(applicationDraft.parse(JSON.parse(application.draft)));
        finishApplication(db, application, combinedJointDraft(primary, borrower), application.step, now, pilot);
      }
    }
    return view(borrower, data.revision + 1, data.step, now, submittedAt, complete, data.confirmedDemo);
  });
}
