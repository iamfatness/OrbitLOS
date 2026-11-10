"use client";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Calculator, CheckCircle2, Circle, ClipboardList, Clock3, Copy, ExternalLink, Pencil, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { activityKinds, contactOutcomes, leadSources, prospectingBlocked, stages, type ActivityKind, type Contact, type DraftAudience, type Loan, type Stage, type Submission, type Workspace } from "@/lib/model";
import { dateTime, initials, money, requestedMoney, stageDays } from "@/lib/utils";
import { Button } from "./ui/button";
import { ApplicationAnswers } from "./application-fields";
import { JointBorrowerLinks } from "./joint-borrower-links";
import { FollowUpPurposeField, LoanTaskRow } from "./loan-task";
import { carriedCallbackOutcomes } from "@/lib/campaign-callback-performance-model";
import { LoanPricing } from "./loan-pricing";
import { LoanScenarios } from "./loan-scenarios";
import type { ScenarioQuoteSource } from "@/lib/loan-scenario-model";
import { CommunicationPreview, LoanCommunications } from "./loan-communications";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { blankLenderDetails, lenderQuestions, lenderSupplement, type LenderDetails } from "@/lib/urla";
import { changedApplicationSections, reusablePropertyAddress, secondReviewBlocker, submittedRequestedLoanAmount, type StaffApplication } from "@/lib/application-model";
import { QuestionnaireFields, type ChangeAnswers } from "./urla-fields";
import { LoanRetention, RetentionFields } from "./past-client-crm";
import type { ReturningClientOption } from "@/lib/past-client-queue-model";
import { pastClientLoan, rateFollowUpContext } from "@/lib/client-retention";
import { DocumentRequestForm, LoanDocumentCard, LoanDocuments } from "./loan-documents";
import { DocumentFollowUp } from "./document-follow-up";
import { borrowerChecklistLinks, conditionDocumentBatchLimit, documentRecipient, needsBorrowerDocument, suggestedConditionDocument,
  type DocumentRecipient, type LoanDocumentRequest } from "@/lib/document-model";
import { latestSelectedPricingRun, mockRateQuoteTermsLabel, mockRateStatus, mockUwmQuoteAmountIssue, pricingInputsMatch } from "@/lib/pricing-model";
import type { ReviewedIncomeSource } from "@/lib/income-review-model";
import { CallReportLoanFacts } from "./call-report";
import { LoanAudit } from "./loan-audit";
import { LoanBorrowerQuestions } from "./loan-borrower-questions";
import { UwmDeliveryTimeline } from "./uwm-delivery-timeline";
import { ManualLenderExport } from "./manual-lender-export";
import { manualLenderAcknowledgmentTarget, type ManualReturnAssignment } from "@/lib/lender-export-model";
import { ClosingWorkbench } from "./closing-workbench";
import { LoanServiceOrders } from "./loan-service-orders";
import { serviceOrdersTarget, serviceOrderTargetPrefix } from "@/lib/service-order-model";
import { DisclosureWorkbench } from "./disclosure-workbench";
import { disclosureTarget, disclosureTask } from "@/lib/disclosure-model";
import { isSharedQuoteReview, sharedQuoteReviewTarget } from "@/lib/shared-quote-model";
import { mockUwmReceiptTaskPrefix } from "@/lib/uwm-handoff-recovery";
import { fundingTaskId, reversedFundingTaskPrefix } from "@/lib/playbook-model";
import { CreditAusWorkbench } from "./credit-aus-workbench";
import { IncomeWorksheet } from "./income-worksheet";
import { submittedApplicationRevision } from "@/lib/credit-aus-model";
import { conditionTarget, submissionTarget } from "@/lib/uwm-alert-model";
import { downloadSampleFile } from "./sample-download";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { canRecordFundingCheckIn, closingReviewReady, fundingCheckInTarget, loanAmountComparisonTarget, loanNextAction, mockClearanceClosingStages, pausedLoan,
  closingChecklistListTarget, reopenedMockClosingCondition } from "@/lib/loan-workflow";
import { LoanWorkflow } from "./loan-workflow";
import { ProcessingHandoff, SecondReviewCheckpoint } from "./processing-handoff";
import { FileReadiness } from "./file-readiness";
import { ManualConditions } from "./manual-conditions";
import { ContactHistory, FundingCheckInForm } from "./contact-crm";
import { ConditionResponse } from "./condition-response";
import { ActivityPages } from "./activity-pages";
import { ContactDuplicateReview } from "./contact-duplicate-review";
import { ContactDuplicateQueue } from "./contact-duplicate-queue";
import { ContactMergeHistory } from "./contact-merge-history";
import type { CampaignLenderPath } from "@/lib/call-campaign-model";
import type { ConversationSubject } from "@/lib/conversation-model";
import { appointmentTargetPrefix } from "@/lib/appointment-model";
import { LoanAppointments } from "./loan-appointments";
import { LoanReviews } from "./loan-reviews";
import { loanReviewsTarget, reviewTarget } from "@/lib/loan-review-model";
import { callReportFactsTarget } from "@/lib/call-report-readiness-model";
import { searchTaskTarget, type SearchContact } from "@/lib/workspace-search-model";
import { LoanContactPicker } from "./loan-contact-picker";
import { LoanAssignmentEditor } from "./loan-assignment";
import { observeHandoffChecks } from "@/lib/tab-return";
import { observeBorrowerChange } from "@/lib/borrower-change-signal";

export type Modal =
  | { kind: "details"; loanId: string; target?: string; campaignLender?: CampaignLenderPath }
  | { kind: "assignment"; loanId: string; returnTo?: "processing-handoff" | "document-checklist"; manualReturn?: ManualReturnAssignment }
  | { kind: "loan"; loanId?: string; stage?: Stage; contactId?: string }
  | { kind: "contactHistory"; contactId: string }
  | { kind: "contactDuplicates"; contactId: string }
  | { kind: "contactDuplicateQueue" }
  | { kind: "contactMergeHistory" }
  | { kind: "contact"; contactId?: string }
  | { kind: "communication"; loanId: string; audience: DraftAudience; draftId?: string;
    returnTo?: "closing-workbench" | "lender-submissions"; campaignLender?: CampaignLenderPath }
  | { kind: "documentFollowUp"; loanId: string }
  | { kind: "returningClient"; loanId: string; fromRateWatch?: true }
  | { kind: "fundingCheckIn"; loanId: string; returnToLoan?: boolean; campaignLender?: CampaignLenderPath }
  | { kind: "pricing"; loanId: string; campaignLender?: CampaignLenderPath; useMockScore?: boolean; sourceQuote?: ScenarioQuoteSource; reviewedIncome?: ReviewedIncomeSource; reviewSharedQuote?: boolean }
  | { kind: "retention"; loanId: string }
  | { kind: "submission"; loanId: string; submissionId?: string };

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;

function text(data: FormData, name: string) {
  return String(data.get(name) ?? "");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Form({ children, save, busy, done, onCancel, remove, newLead }: {
  children: ReactNode; save: (data: FormData) => unknown; busy: boolean;
  done: (input: unknown) => void; onCancel: () => void; remove?: () => void; newLead?: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    done(save(new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)));
  }
  return (
    <form className="record-form" onSubmit={submit}>
      {children}
      <div className="dialog-footer">
        {remove && <Button variant="danger" onClick={remove} disabled={busy}><Trash2 /> Delete</Button>}
        <div className="spacer" />
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant={newLead ? "outline" : "default"} disabled={busy}>{busy ? "Saving…" : newLead ? "Save lead" : "Save changes"}</Button>
        {newLead && <Button type="submit" name="start1003" value="yes" disabled={busy}>Save and open 1003</Button>}
      </div>
    </form>
  );
}

function LoanFields({ loan, state, stage, staff, existingContactId }: { loan?: Loan; state: Workspace; stage?: Stage; staff: WorkspaceStaff | null; existingContactId?: string }) {
  const initialBorrower = loan?.contactId ?? existingContactId ?? "";
  const initialPartner = loan?.partnerId ?? "";
  const [contactId, setContactId] = useState(initialBorrower);
  const [partnerId, setPartnerId] = useState(initialPartner);
  const [hasPriorLoan, setHasPriorLoan] = useState<boolean | undefined>(() =>
    state.loans.some((item) => item.contactId === existingContactId) ? true : undefined);
  const [leadSource, setLeadSource] = useState<string>();
  const [officerOptions, setOfficerOptions] = useState<string[]>([]);
  const [assignToSelf, setAssignToSelf] = useState(Boolean(staff && (!loan || loan.officerEmail === staff.email)));
  const [manualOfficer, setManualOfficer] = useState(loan?.officer ?? (staff ? "" : "Alex Morgan"));
  const borrowerLocked = loan && state.applications.some((application) => application.loanId === loan.id);
  const managed = staff && (staff.brokerage.id !== demoBrokerageId || staff.brokerage.role === "LO");
  const brokerageId = staff?.brokerage.id ?? demoBrokerageId;
  const contextualBorrower = !!existingContactId && contactId === existingContactId;
  const checkingSource = contextualBorrower && hasPriorLoan === undefined && leadSource === undefined;
  function initialOption(id: string) {
    const contact = state.contacts.find((item) => item.id === id);
    return contact ? { id, name: contact.name, detail: contact.email || contact.phone } : undefined;
  }
  return (
    <>
      {borrowerLocked ? <Field label="Borrower contact">
        <select disabled value={contactId}><option value={contactId}>{initialOption(contactId)?.name ?? "Current borrower"}</option></select>
      </Field> : <LoanContactPicker kind="borrower" brokerageId={brokerageId} value={contactId} onChange={setContactId}
        initialId={initialBorrower} initialOption={initialOption(initialBorrower)} onHasLoan={setHasPriorLoan} />}
      {borrowerLocked && <><input type="hidden" name="contactId" value={loan.contactId} /><p className="muted">The borrower’s existing 1003 link is tied to this contact.</p></>}
      {!contactId && <Field label="Borrower name"><input name="borrower" placeholder="e.g. Riley Smith" maxLength={160} required /></Field>}
      {!contactId && !loan && <div className="form-grid">
        <Field label="Borrower email (optional)"><input name="borrowerEmail" type="email" maxLength={160} /></Field>
        <Field label="Borrower phone (optional)"><input name="borrowerPhone" type="tel" maxLength={40} /></Field>
      </div>}
      <Field label="Property address"><input name="address" defaultValue={loan?.address} placeholder="City, state or street address" maxLength={240} /></Field>
      <div className="form-grid">
        <Field label="Loan amount"><input name="amount" type="number" min="0" max="1000000000" step="1" placeholder="0" defaultValue={loan?.amount || ""} /></Field>
        <Field label="Loan purpose"><select name="purpose" defaultValue={loan?.purpose ?? "Purchase"}><option>Purchase</option><option>Refinance</option></select></Field>
        <Field label="Pipeline stage"><select name="stage" defaultValue={loan?.stage ?? stage ?? "Lead"}>{stages.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Loan officer"><input name="officer" list="loan-officers" maxLength={160} placeholder="Unassigned"
          readOnly={assignToSelf || Boolean(managed)} value={managed ? loan?.officer ?? staff.name : assignToSelf ? staff?.name.slice(0, 160) ?? "" : manualOfficer} onChange={(event) => setManualOfficer(event.target.value)} /></Field>
      </div>
      {staff && !managed && <label className="demo-confirm"><input type="checkbox" name="assignToSelf" checked={assignToSelf} onChange={(event) => setAssignToSelf(event.target.checked)} />
        Assign to my account ({staff.email})</label>}
      <datalist id="loan-officers">{officerOptions.map((officer) => <option key={officer} value={officer} />)}</datalist>
      <LoanContactPicker kind="realtor" brokerageId={brokerageId} value={partnerId} onChange={setPartnerId}
        initialId={initialPartner} initialOption={initialOption(initialPartner)} onOfficers={setOfficerOptions} />
      <Field label="Lead source"><select name="leadSource" required={checkingSource}
        value={leadSource ?? loan?.leadSource ?? (contextualBorrower && hasPriorLoan ? "Returning client" : "")}
        onChange={(event) => setLeadSource(event.target.value)}>
        <option value="">{checkingSource ? "Checking borrower history…" : "Use lead details"}</option>
        {leadSources.map((source) => <option key={source}>{source}</option>)}
      </select></Field>
    </>
  );
}

function ContactFields({ contact }: { contact?: Contact }) {
  return <>
    <Field label="Full name"><input name="name" defaultValue={contact?.name} maxLength={160} required /></Field>
    <Field label="Contact type"><select name="role" defaultValue={contact?.role ?? "Borrower"}><option>Borrower</option><option>Co-borrower</option><option>Realtor</option></select></Field>
    <Field label="Email"><input name="email" type="email" defaultValue={contact?.email} /></Field>
    <Field label="Phone"><input name="phone" type="tel" maxLength={40} defaultValue={contact?.phone} /></Field>
  </>;
}

function SubmissionCard({ submission, requests, busy, save, onEdit, checklistLinks, joint, brokerageId, pilot, canSimulate }: {
  submission: Submission; requests: LoanDocumentRequest[]; busy: boolean; save: Save; onEdit: () => void;
  checklistLinks: Partial<Record<DocumentRecipient, string>>; joint: boolean; brokerageId: string; pilot?: boolean;
  canSimulate: boolean;
}) {
  const open = submission.conditions.filter((item) => !item.satisfiedAt);
  const cleared = submission.conditions.filter((item) => item.satisfiedAt);
  const byCondition = new Map(requests.filter((request) => request.submissionId === submission.id).map((request) => [request.conditionId, request]));
  const mockUwm = submission.lender === "UWM" && !!submission.syncedAt;
  const suggested = mockUwm ? open.flatMap((item) => {
    const document = !byCondition.has(item.id) && suggestedConditionDocument(item);
    return document ? [{ id: item.id, kind: document.kind }] : [];
  }).slice(0, conditionDocumentBatchLimit) : [];
  const waiting = open.flatMap((item) => {
    const request = byCondition.get(item.id);
    return request && needsBorrowerDocument(request.status) ? [documentRecipient(request)] : [];
  });
  const waitingCount = waiting.length;
  const sentCount = open.filter((item) => byCondition.get(item.id)?.uwmReceipt).length;
  return (
    <article className="submission" id={submissionTarget(submission.id)} tabIndex={-1}>
      <div className="submission-head">
        <div><strong>{submission.lender}</strong><p>Reference {submission.externalId}</p></div>
        <span className="pill">{submission.syncedAt ? "Mock sync" : "Manual"}</span>
        {!submission.syncedAt && <Button variant="ghost" size="icon" aria-label={`Edit ${submission.lender} submission`} onClick={onEdit}><Pencil /></Button>}
      </div>
      <p className="lender-status">{submission.status}</p>
      {submission.syncedAt && <>
        <p className="muted timestamp"><Clock3 size={13} /> Synced {dateTime(submission.syncedAt)} ET</p>
        <div className="condition-counts"><span>{open.length} outstanding</span><span>{cleared.length} cleared</span></div>
        {mockUwm && <UwmDeliveryTimeline submission={submission} brokerageId={brokerageId} busy={busy} canSimulate={canSimulate} save={save} />}
        {submission.conditions.length === 0 && <p className="muted">No conditions were returned for this loan.</p>}
        {mockUwm && (suggested.length > 1 || waitingCount > 0 || sentCount > 1) &&
          <div className="condition-checklist" role="group" aria-label="Mock UWM checklist">
            {suggested.length > 1 && <Button size="sm" disabled={busy} onClick={() => void save({
              type: "requestSuggestedUwmDocuments", loanId: submission.loanId, submissionId: submission.id, conditionIds: suggested.map((item) => item.id),
            })}>Request {suggested.length} suggested documents</Button>}
            {suggested.length > 1 && <small className="muted">{suggested.map((item) => item.kind).join(" · ")}{joint ? " · For primary borrower" : ""}</small>}
            {waitingCount > 0 && <>
              {waitingCount > 1 && [...new Set(waiting)].map((recipient) => checklistLinks[recipient] && <Button key={recipient} size="sm" variant="outline" asChild>
                <a href={checklistLinks[recipient]} target="_blank" rel="noopener noreferrer">Open {joint ? recipient.toLowerCase() : "borrower"} checklist <ExternalLink /></a>
              </Button>)}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({
                type: "refreshApplication", loanId: submission.loanId,
              })}><RefreshCw /> Refresh requested documents</Button>
            </>}
            {sentCount > 1 && <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
              type: "refreshMockUwmClearance", loanId: submission.loanId, submissionId: submission.id,
            })}><RefreshCw /> Check mock clearance for {sentCount} documents</Button>}
          </div>}
        {[...open, ...cleared].map((item) => {
          const request = byCondition.get(item.id);
          const borrowerUrl = request && checklistLinks[documentRecipient(request)];
          return <div className="condition" key={item.id} id={conditionTarget(submission.id, item.id)} tabIndex={-1}>
            {item.satisfiedAt ? <CheckCircle2 size={16} className="text-emerald-700" /> : <Circle size={16} className="text-amber-600" />}
            <div><strong>{item.category}{item.group && ` · ${item.group}`}</strong><p>{item.description}</p>
              <small>{submission.lender === "UWM" && "UWM · "}{item.satisfiedAt ? `Cleared ${dateTime(item.satisfiedAt)} ET` : item.uploaded ? "Document uploaded" : "Outstanding"}</small>
              {request ? <>
                {!item.satisfiedAt && (request.status === "Requested" || request.status === "Needs replacement") && <div className="loan-application-actions">
                  {borrowerUrl && <Button size="sm" variant="outline" asChild><a href={borrowerUrl} target="_blank" rel="noopener noreferrer">Open {joint ? documentRecipient(request).toLowerCase() : "borrower"} checklist <ExternalLink /></a></Button>}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshApplication", loanId: submission.loanId })}>Refresh condition</Button>
                </div>}
                <LoanDocumentCard key={request.revision} request={request} brokerageId={brokerageId} pilot={pilot}
                  openCondition={!item.satisfiedAt} replaceable={!item.satisfiedAt} busy={busy} save={save} compact showRecipient={joint} />
              </> : !item.satisfiedAt && <DocumentRequestForm loanId={submission.loanId} source={{ submissionId: submission.id, condition: item }} busy={busy} save={save} quick joint={joint} />}
              {!item.satisfiedAt && <ConditionResponse condition={item} request={request} lender={submission.lender} />}
              {canSimulate && submission.lender === "UWM" && item.satisfiedAt && <details className="document-form">
                <summary>Simulate reopening (mock)</summary>
                <p className="muted">Reopen the {item.category.toLowerCase()} condition and update its borrower checklist.</p>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
                    type: "reopenMockUwmCondition", loanId: submission.loanId, submissionId: submission.id, conditionId: item.id,
                    expectedSatisfiedAt: item.satisfiedAt, expectedReopenedAt: item.mockReopenedAt ?? null,
                })}>Confirm mock reopening</Button>
              </details>}
            </div>
          </div>;
        })}
      </>}
      {!submission.syncedAt && <ManualConditions submission={submission} requests={requests} checklistLinks={checklistLinks} joint={joint}
        brokerageId={brokerageId} pilot={pilot} busy={busy} save={save} />}
    </article>
  );
}

function LoanApplication({ loanId, state, busy, save, processor, jointLinks, openConditions, campaignManual, openReviews, openPricing, markDraftChanged, shareBrokerage }: {
  loanId: string; state: Workspace; busy: boolean; save: Save; processor?: boolean; jointLinks: boolean;
  openConditions: (id: string) => void; campaignManual: boolean; openReviews?: () => void;
  openPricing: () => void;
  markDraftChanged: (editor: Node) => void;
  shareBrokerage?: string;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [confirmingRevocation, setConfirmingRevocation] = useState<string | null>(null);
  const application = state.applications.find((item) => item.loanId === loanId);
  const loan = state.loans.find((item) => item.id === loanId);
  const requestedAmount = submittedRequestedLoanAmount(application);
  const wholeAmount = requestedAmount === null ? 0 : Math.round(requestedAmount);
  const canRecordReturn = Boolean(loan && !pausedLoan(loan) && !pastClientLoan(loan) &&
    !state.pastClients.some((item) => item.loanId === loanId && item.closingDate) &&
    !state.closingProgress.some((item) => item.loanId === loanId && item.fundingDate));
  const requireSecondReview = state.playbook.requireSecondReview;
  const blocker = secondReviewBlocker(requireSecondReview, application);
  const linkStatus = application?.revokedAt ? "Revoked" : application && application.expiresAt <= new Date().toISOString() ? "Expired" : "Active";
  const path = application ? `/apply#${application.token}` : "";
  const lastSent = application?.versions.find((version) => version.uwmReceipt);
  const currentSent = !!lastSent && lastSent.revision === application?.revision;
  const pendingReceipt = application?.uwmPendingReceipt;
  const quoteAmountIssue = currentSent ? null : mockUwmQuoteAmountIssue(latestSelectedPricingRun(state.pricingRuns, loanId), application);
  const linkedFile = state.submissions.find((file) =>
    file.id === application?.manualHandoff?.submissionId && file.loanId === loanId && file.syncedAt === null);
  const processingPending = state.loanProcessing.some((item) => item.loanId === loanId && item.processorEmail &&
    (item.status === "Assigned" || item.status === "Ready for processing"));
  const showCheckpoint = requireSecondReview && (!blocker || processingPending || (!currentSent && !linkedFile));
  const status = application?.correctionNote ? "Corrections requested" : application?.submittedAt && !application.reviewedAt
    ? "Needs review" : pendingReceipt ? "Receipt pending · Mock UWM" : currentSent ? "Sent to UWM · Mock" : application?.reviewedAt
      ? (application.uwmReference ? "Ready to send to existing file" : "Reviewed") : application?.joint ? "Collecting joint 1003" : "Draft";
  const run = (type: string) => void save({ type, loanId });

  async function copy() {
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setCopyStatus("Borrower link copied.");
    } catch {
      setCopyStatus("Open the borrower view and copy the address from your browser.");
    }
  }

  return <section className="details-section" aria-label="1003 application" id="loan-application" tabIndex={-1}>
    <div className="section-heading">
      <h3><ClipboardList size={17} /> 1003 application</h3>
      {application && <span className="pill">{status}</span>}
    </div>
    {showCheckpoint && <SecondReviewCheckpoint blocker={blocker} revision={application?.revision} busy={busy} openReviews={openReviews} />}
    {!application ? <div className="loan-application-box">
      <p className="muted">Create a link for a borrower to complete a sample application. Use fictional information.</p>
      {!processor && <Button size="sm" disabled={busy} onClick={() => run("startApplication")}><Plus /> Start 1003</Button>}
    </div> : <div className="loan-application-box">
      <p className="muted">Borrower link · <strong>{linkStatus}</strong>{linkStatus === "Active" && ` · Expires ${dateTime(application.expiresAt)} ET`}</p>
      <div className="loan-application-actions">
        {linkStatus === "Active" ? <>
          <Button asChild size="sm" variant="outline"><a href={path} target="_blank" rel="noopener noreferrer"><ExternalLink /> {application.submittedAt ? "Open borrower status" : "Open borrower view"}</a></Button>
          <Button size="sm" variant="outline" onClick={() => void copy()}><Copy /> Copy link</Button>
          {!processor && <Button size="sm" variant="ghost" disabled={busy}
            aria-expanded={confirmingRevocation === application.token}
            onClick={() => setConfirmingRevocation(application.token)}>Revoke borrower link</Button>}
        </> : !processor && <Button size="sm" variant="outline" disabled={busy} onClick={() => run("startApplication")}>Issue replacement link</Button>}
        {!application.submittedAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("refreshApplication")}><RefreshCw /> Refresh application</Button>}
      </div>
      {!processor && linkStatus === "Active" && confirmingRevocation === application.token && <div className="record-form">
        <p className="muted">The borrower will need a new link to return.</p>
        <div className="loan-application-actions">
          <Button size="sm" disabled={busy} onClick={() => {
            setCopyStatus("");
            setConfirmingRevocation(null);
            void save({ type: "revokeApplication", loanId, token: application.token });
          }}>Confirm borrower link revocation</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmingRevocation(null)}>Keep borrower link active</Button>
        </div>
      </div>}
      {copyStatus && <p role="status" className="muted">{copyStatus}</p>}
      <JointBorrowerLinks key={application.loanId} application={application} mayManage={jointLinks} busy={busy} save={save}
        canEnable={jointLinks && linkStatus === "Active" && canRecordReturn && !application.submittedAt && !application.versions.length} />
      {application.uwmReference && <div className="record-form">
        <p className="application-sent"><CheckCircle2 size={16} /> Mock UWM file · {application.uwmReference}</p>
        {lastSent?.uwmReceipt ? <p className="muted">Last received revision {lastSent.revision} · {dateTime(lastSent.uwmReceipt.sentAt)} ET</p>
          : <p className="muted">This file was linked before revision receipts were available.</p>}
      </div>}
      {pendingReceipt && <div className="work-queue" aria-label="Mock UWM receipt review">
        <strong>Mock UWM receipt pending</strong>
        <p>1003 revision {pendingReceipt.revision} · Attempted {dateTime(pendingReceipt.attemptedAt)} ET</p>
        <p>Check for the original receipt before sending another submission.</p>
        {!processor && <div><Button size="sm" disabled={busy} onClick={() => void save({
          type: "reconcileMockUwmReceipt", loanId, revision: pendingReceipt.revision,
        })}>Check mock UWM for receipt</Button></div>}
      </div>}
      {application.correctionNote && <p className="muted">Waiting on the borrower · {application.correctionNote}</p>}
      {!application.submittedAt ? <p className="muted timestamp">Last saved {dateTime(application.updatedAt)} ET</p> : <>
        <p className="muted">Received {dateTime(application.submittedAt)} ET</p>
        {loan && requestedAmount !== null && <section className="document-item" id={loanAmountComparisonTarget}
          tabIndex={-1} aria-label="Loan amount comparison">
          <p><strong>Recorded amount</strong> {money(loan.amount)} · <strong>1003 request</strong> {requestedMoney(requestedAmount)}</p>
          {requestedAmount !== loan.amount && <p className="muted">Pipeline totals use the recorded amount. MISMO uses the 1003 request. Pricing uses the amount entered for the quote.
            {requestedAmount !== wholeAmount && " Pipeline records whole dollars."}</p>}
          {!processor && canRecordReturn && wholeAmount > 0 && wholeAmount !== loan.amount &&
            (application.reviewedAt ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
              type: "useReviewedLoanAmount", loanId, revision: application.revision, previousAmount: loan.amount,
            })}>Use {money(wholeAmount)} as recorded amount</Button> :
              <p className="muted">Mark the current 1003 reviewed to use its requested amount.</p>)}
        </section>}
        {application.draft && <details className="application-review" open={!application.reviewedAt}>
          <summary>Review submitted answers</summary>
          <ApplicationAnswers draft={application.draft} />
        </details>}
        {application.reviewedAt ? !processor && !currentSent && !pendingReceipt && (quoteAmountIssue ? <div className="document-item">
          <p>{quoteAmountIssue}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={openPricing}>Review quote amount</Button>
        </div> : !blocker && <Button size="sm" disabled={busy}
          onClick={() => void save({ type: "sendApplication", loanId, revision: application.revision })}>
          <Send /> {application.uwmReference ? "Send to existing UWM file (mock)" : "Send to UWM (mock)"}</Button>) :
          <Button size="sm" disabled={busy} onClick={() => void save({ type: "reviewApplication", loanId, revision: application.revision })}><CheckCircle2 /> Mark reviewed</Button>}
        {shareBrokerage && !processor && canRecordReturn && application.reviewedAt && !currentSent && !pendingReceipt && !blocker && !quoteAmountIssue &&
          <details className="document-form">
            <summary>Rehearse a missing mock UWM acknowledgment</summary>
            <p>Orbit will open a receipt review task. Use it to check the mock lender before sending again.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
              type: "simulateMissingUwmReceipt", loanId, revision: application.revision,
            })}>Simulate missing mock UWM receipt</Button>
          </details>}
        {!pendingReceipt && <details className="loan-task-create"><summary>Request borrower corrections</summary>
          <form className="record-form" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void save({ type: "requestApplicationCorrection", loanId, revision: application.revision, note: text(data, "note"),
              recipient: data.get("recipient") || "Primary borrower" });
          }}>
            {application.joint && <Field label="Correction recipient"><select name="recipient"><option>Primary borrower</option><option>Co-borrower</option></select></Field>}
            <Field label="Instructions for the borrower"><textarea name="note" rows={3} required maxLength={500} /></Field>
            <div><Button size="sm" type="submit" disabled={busy}>Request corrections</Button></div>
          </form>
        </details>}
      </>}
      {application.versions.length > 0 && <details className="application-review">
        <summary>Application version history</summary>
        <ul>{application.versions.map((version, index) => <li key={version.revision}>
          Version {application.versions.length - index} · {dateTime(version.submittedAt)} ET · {version.reviewedAt ? "Reviewed" : "Submitted"}
          {version.uwmReceipt && <p className="rate-receipt">Mock UWM received revision {version.revision} · {dateTime(version.uwmReceipt.sentAt)} ET · {version.uwmReceipt.reference}</p>}
        </li>)}</ul>
        {application.previousAnswers && <details className="application-review"><summary>Compare with previous answers</summary>
          {application.draft && <p className="muted">Changed sections · {changedApplicationSections(application.previousAnswers, application.draft).join(", ") || "No answer changes"}</p>}
          <ApplicationAnswers draft={application.previousAnswers} />
        </details>}
      </details>}
      <ManualLenderExport key={`${loanId}:${application.revision}:${application.lender?.revision ?? 0}`}
        application={application} busy={busy} save={save} openConditions={openConditions}
        canRecordReturn={canRecordReturn} handoffBlocker={blocker} openReviews={openReviews}
        shareBrokerage={shareBrokerage}
        linkedFile={linkedFile}
        previousFile={state.submissions.find((submission) => submission.id === application.lastManualSubmissionId && submission.loanId === loanId)}
        campaignManual={campaignManual} />
      <LenderApplicationDetails key={`${loanId}:${application.lender?.revision ?? 0}`} application={application}
        busy={busy} save={save} markDraftChanged={markDraftChanged} />
    </div>}
  </section>;
}

function LenderApplicationDetails({ application, busy, save, markDraftChanged }: {
  application: StaffApplication; busy: boolean; save: Save; markDraftChanged: (editor: Node) => void;
}) {
  const editor = useRef<HTMLDetailsElement>(null);
  const [details, setDetails] = useState(() => application.lender?.details ?? blankLenderDetails());
  function change(key: keyof LenderDetails, update: Parameters<ChangeAnswers>[0]) {
    // Repeatable groups can change through Add and Remove without a form input event.
    if (editor.current) markDraftChanged(editor.current);
    setDetails((current) => ({ ...current, [key]: update(current[key]) }));
  }
  return <details ref={editor} className="application-review">
    <summary>Lender and originator details</summary>
    <p className="muted">Staff-only fields for the sample loan file.</p>
    <div className="urla-questionnaire">
      <QuestionnaireFields definition={lenderQuestions} answers={details.originator} change={(update) => change("originator", update)} />
      <details className="application-review">
        <summary>Property, title, mortgage terms, and cash to close</summary>
        <QuestionnaireFields definition={lenderSupplement} answers={details.supplement} change={(update) => change("supplement", update)} />
      </details>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save({
        type: "saveLenderDetails", loanId: application.loanId, revision: application.lender?.revision ?? 0, details,
      })}>Save lender details</Button>
    </div>
  </details>;
}

const loanSections = [
  ["Overview", "loan-workflow"], ["1003", "loan-application"], ["Conditions", "lender-submissions"],
  ["Scenarios", "loan-scenarios"],
  ["Pricing & credit", "loan-pricing"], ["Disclosures", disclosureTarget], ["Closing", "closing-workbench"], ["Activity", "loan-activity"],
] as const;

function loanSection(target?: string) {
  if (!target) return "Overview";
  if (target === "loan-scenarios") return "Scenarios";
  if (target === disclosureTarget) return "Disclosures";
  if (target === "loan-application" || target === loanAmountComparisonTarget || target === "manual-lender-export" ||
    target === manualLenderAcknowledgmentTarget) return "1003";
  if (target.startsWith("lender-") || target.startsWith("document-") || target.startsWith("loan-question-") ||
    target === serviceOrdersTarget || target.startsWith(serviceOrderTargetPrefix)) return "Conditions";
  if (target === "credit-aus" || target === "loan-pricing" || target === "income-worksheet" || target === sharedQuoteReviewTarget) return "Pricing & credit";
  if (target === "closing-workbench" || target === "loan-closing-date" || target === "loan-funding" ||
    target === callReportFactsTarget || target.startsWith("closing-checklist-")) return "Closing";
  if (["loan-activity", "loan-tasks", "loan-retention", "loan-communications", loanReviewsTarget].includes(target) ||
    target.startsWith(appointmentTargetPrefix) || target.startsWith(searchTaskTarget("")) || target.startsWith(reviewTarget(""))) return "Activity";
  return "Overview";
}

function CarriedCallbackForm({ loanId, taskId, dueAt, busy, save }: {
  loanId: string; taskId: string; dueAt: string; busy: boolean; save: Save;
}) {
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return <details className="loan-task-create document-form">
    <summary>Log callback outcome</summary>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const input = { type: "recordCarriedCampaignCallback", loanId, taskId, dueAt,
        outcome: text(data, "outcome"), note: text(data, "note").trim() };
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      void save({ ...input, eventId: attempt.current.id });
    }}>
      <Field label="Call outcome"><select name="outcome" defaultValue="" required>
        <option value="" disabled>Choose an outcome</option>
        {carriedCallbackOutcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}
      </select></Field>
      <Field label="Callback note (optional)"><textarea name="note" rows={2} maxLength={500} /></Field>
      <p className="muted">Saves the outcome to loan activity and the original campaign.</p>
      <div><Button type="submit" size="sm" disabled={busy}>Save callback outcome</Button></div>
    </form>
  </details>;
}

function CarriedCallbackRescheduleForm({ loanId, taskId, dueAt, revision, busy, save }: {
  loanId: string; taskId: string; dueAt: string; revision: number; busy: boolean; save: Save;
}) {
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return <details className="loan-task-create document-form">
    <summary>Reschedule callback</summary>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const callback = new Date(text(data, "callback"));
      if (!Number.isFinite(callback.getTime())) return;
      const input = { type: "rescheduleCarriedCampaignCallback", loanId, taskId, dueAt, revision,
        callbackAt: callback.toISOString(), reason: text(data, "reason").trim() };
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      void save({ ...input, eventId: attempt.current.id }, () => {
        attempt.current = null;
        form.reset();
        const details = form.closest("details");
        details?.removeAttribute("open");
        details?.querySelector("summary")?.focus();
      });
    }}>
      <Field label="New callback time (your local time)"><input name="callback" type="datetime-local" required /></Field>
      <Field label="Reason for rescheduling"><input name="reason" required maxLength={400} /></Field>
      <p className="muted">The new time appears in your queues. A missed deadline stays in campaign reporting.</p>
      <div><Button type="submit" size="sm" disabled={busy}>Save callback time</Button></div>
    </form>
  </details>;
}

function LoanDetails({ loan, state, staff, busy, save, show, target, campaignLender, openConversation, openRateWatchRefinance, appointmentChanged, reviewChanged,
  markDraftChanged, openScopedLoan }: {
  target?: string; campaignLender?: CampaignLenderPath; loan: Loan; state: Workspace; staff: WorkspaceStaff | null;
  busy: boolean; save: Save; show: (modal: Modal) => void;
  openConversation: (subject: ConversationSubject) => void;
  openRateWatchRefinance: (loanId: string) => void;
  appointmentChanged: () => void;
  reviewChanged: () => void;
  markDraftChanged: (editor: Node) => void;
  openScopedLoan: (destination?: string) => void;
}) {
  const processor = staff?.brokerage.role === "Processor";
  const canOpenReviews = Boolean(staff) || process.env.NODE_ENV === "development";
  const canOpenDisclosures = staff ? staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId : process.env.NODE_ENV === "development";
  const sharedProcessor = processor && loan.officerEmail !== staff.email;
  const [activityKind, setActivityKind] = useState<ActivityKind>("Note");
  const activityAttempt = useRef<{ key: string; id: string } | null>(null);
  const borrower = state.contacts.find((contact) => contact.id === loan.contactId);
  const partner = state.contacts.find((contact) => contact.id === loan.partnerId);
  const submissions = state.submissions.filter((item) => item.loanId === loan.id);
  const reopenedClosing = reopenedMockClosingCondition(loan.id, submissions);
  const requests = state.documentRequests.filter((item) => item.loanId === loan.id);
  const assignment = state.loanProcessing.find((item) => item.loanId === loan.id);
  const openConditionRequests = new Set(requests.filter((request) => submissions.some((submission) =>
    submission.id === request.submissionId && submission.lender === "UWM" && submission.syncedAt &&
    submission.conditions.some((condition) => condition.id === request.conditionId && !condition.satisfiedAt))).map((request) => request.id));
  const replaceableRequests = new Set(requests.filter((request) => submissions.some((submission) =>
    submission.id === request.submissionId && submission.conditions.some((condition) => condition.id === request.conditionId && !condition.satisfiedAt)))
    .map((request) => request.id));
  const application = state.applications.find((item) => item.loanId === loan.id);
  const propertyStatus = application && !application.submittedAt
    ? (application.draftHasPropertyStreet ? "Address entered in 1003 draft" : "Awaiting 1003 submission")
    : "Address pending";
  const requestedAmount = submittedRequestedLoanAmount(application);
  const amountDiffers = requestedAmount !== null && Math.round(requestedAmount) !== loan.amount;
  const callReportFile = state.callReportFiles?.find((file) => file.loanId === loan.id);
  const tasks = state.tasks.filter((item) => item.loanId === loan.id);
  const profile = state.pastClients.find((item) => item.loanId === loan.id);
  const rateContext = rateFollowUpContext(profile);
  const closingProgress = state.closingProgress.find((item) => item.loanId === loan.id);
  const canStartRateRefinance = !processor && pastClientLoan(loan) && (loan.disposition ?? "Active") === "Active" &&
    borrower?.role !== "Realtor" && !borrower?.outreachSuppressed && (!closingProgress || Boolean(closingProgress.fundingDate)) && Boolean(rateContext);
  const canOpenCheckIn = (!staff || staff.brokerage.role === "Admin" || loan.officerEmail === staff.email) &&
    canRecordFundingCheckIn(loan, state, staff?.brokerage.role);
  const checkInTask = canOpenCheckIn ? tasks.find((task) => task.id === fundingTaskId(loan.id, "borrower")) : undefined;
  const savedPricing = latestSelectedPricingRun(state.pricingRuns, loan.id);
  const savedOffer = savedPricing?.offers.find((item) => item.id === savedPricing.selectedId);
  const rate = state.mockUwmRates.find((item) => item.loanId === loan.id);
  const section = loanSection(target);
  const action = loanNextAction(loan, state, staff?.brokerage.role);
  const uwm = submissions.filter((item) => item.lender === "UWM");
  const linkedManual = submissions.find((item) => item.id === application?.manualHandoff?.submissionId && item.syncedAt === null);
  const displayManual = uwm.length === 0 ? linkedManual ?? submissions.find((item) => item.id === application?.lastManualSubmissionId && item.syncedAt === null) : undefined;
  const lenderStatus = displayManual?.status ?? uwm[0]?.status ?? "Awaiting submission";
  const openCount = (displayManual ? displayManual.conditions : uwm.flatMap((item) => item.conditions)).filter((item) => !item.satisfiedAt).length;
  const realtorDraft = state.communicationDrafts.find((draft) => draft.loanId === loan.id && draft.audience === "Realtor" && draft.contactId === loan.partnerId);
  const checklistLinks = borrowerChecklistLinks(application);
  const joint = !!application?.joint;
  const open = (destination: string) => {
    const needsDisclosures = !state.disclosureWork &&
      (destination === disclosureTarget || !staff && canOpenDisclosures && loanSection(destination) === "Closing");
    const needsServiceOrders = !staff && state.closingServiceEvidence === undefined && ["Conditions", "Closing"].includes(loanSection(destination));
    if (needsDisclosures || needsServiceOrders) {
      openScopedLoan(destination);
    }
    else show({ kind: "details", loanId: loan.id, target: destination, campaignLender });
  };
  const openPricing = (useMockScore?: boolean, reviewedIncome?: ReviewedIncomeSource) =>
    show({ kind: "pricing", loanId: loan.id, campaignLender, useMockScore, reviewedIncome });
  const inlineRequests = new Set(submissions.flatMap((item) => requests.filter((request) => request.submissionId === item.id &&
    item.conditions.some((condition) => condition.id === request.conditionId && (item.syncedAt || condition.manual))).map((request) => request.id)));
  return (
    <div className="details-body">
      <div className="loan-file-hero">
        <div className="details-person"><span className="avatar avatar-large">{initials(borrower?.name ?? "?")}</span>
          <div><h3>{borrower?.name}</h3><p>{[amountDiffers ? `Recorded ${money(loan.amount)}` : money(loan.amount), loan.purpose, loan.address || propertyStatus].join(" · ")}</p>
            {amountDiffers && <button className="name-link" type="button" onClick={() => open(loanAmountComparisonTarget)}>
              1003 request {requestedMoney(requestedAmount)}
            </button>}
            {loan.callCampaignName && <p><strong>Call campaign</strong> · {loan.callCampaignName}</p>}</div>
          {!processor && <Button variant="outline" size="sm" onClick={() => show({ kind: "loan", loanId: loan.id })}><Pencil /> Edit loan</Button>}
        </div>
        <div className="details-grid">
          <div><span>Pipeline stage</span><strong>{loan.stage}</strong><span suppressHydrationWarning>{stageDays(loan.stageSince)}d in stage</span></div>
          <div><span>{displayManual ? `${displayManual.lender} · Manual` : "UWM · Mock"}</span><strong>{lenderStatus}</strong>
            {(displayManual || uwm.length > 0) && <button type="button" className="condition-status" data-outstanding={openCount > 0}
              onClick={() => open(displayManual ? submissionTarget(displayManual.id) : "lender-submissions")}>{openCount} outstanding {openCount === 1 ? "condition" : "conditions"}</button>}</div>
          <div><span>Realtor partner</span><strong>{partner?.name ?? "Unassigned"}</strong></div>
          <div><span>Loan officer</span><strong>{loan.officer || "Unassigned"}</strong></div>
        </div>
      </div>
      <div className="loan-status-action">
        <div><small>Next action</small><strong>{action.title}</strong>
          {(action.blocker || action.dueAt) && <span>{[action.blocker, action.dueAt && `Due ${dateTime(action.dueAt)} ET`].filter(Boolean).join(" · ")}</span>}
        </div>
        <Button size="sm" onClick={() => open(action.target)}>Open next action <ArrowRight aria-hidden="true" /></Button>
      </div>
      <nav className="loan-section-nav" aria-label="Loan sections">{loanSections.filter(([name]) =>
        (name !== "Scenarios" || canOpenReviews) && (name !== "Disclosures" || canOpenDisclosures)).map(([name, destination]) =>
        <button key={name} type="button" aria-current={section === name ? "page" : undefined} onClick={() => open(destination)}>{name}</button>)}
      </nav>
      {section === "Overview" && <>
      <LoanWorkflow key={loan.dispositionRevision} loan={loan} busy={busy} readOnly={processor} save={(input) => void save(input)} />
      <ProcessingHandoff loan={loan} assignment={assignment} history={state.processingActivity}
        application={application} documents={requests} requireSecondReview={state.playbook.requireSecondReview} staff={staff}
        busy={busy} save={(input) => void save(input)} open={open} openReviews={canOpenReviews ? () => open(loanReviewsTarget) : undefined}
        openAssignment={staff?.brokerage.role === "Admin" ? () => show({ kind: "assignment", loanId: loan.id, returnTo: "processing-handoff" }) : undefined} />
      {canOpenReviews && !state.playbook.requireSecondReview && <div><Button size="sm" variant="outline" onClick={() => open(loanReviewsTarget)}>Open team reviews</Button></div>}
      <Field label="Pipeline stage"><select value={loan.stage} disabled={busy || processor || pausedLoan(loan)} onChange={(event) => void save({ type: "move", id: loan.id, stage: event.target.value })}>
        {stages.map((stage) => <option key={stage} disabled={!!reopenedClosing && stage !== loan.stage &&
          mockClearanceClosingStages.some((item) => item === stage)}>{stage}</option>)}
      </select></Field>
      <FileReadiness loan={loan} state={state} busy={busy} save={save} open={open}
        preapprovalBrokerage={staff ? !processor && (staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId) ? staff.brokerage.id : undefined :
          process.env.NODE_ENV === "development" ? demoBrokerageId : undefined} />
      </>}
      {section === "Scenarios" && (staff || process.env.NODE_ENV === "development") && <LoanScenarios key={loan.id} loan={loan} state={state}
        brokerageId={staff?.brokerage.id ?? demoBrokerageId} sampleAllowed={!staff || staff.brokerage.id === demoBrokerageId || Boolean(staff.brokerage.pilot)}
        markDraftChanged={markDraftChanged} openPricing={(sourceQuote) => show({ kind: "pricing", loanId: loan.id, campaignLender, sourceQuote })} />}
      {section === "Pricing & credit" && <>
      <section className="details-section" id={target === sharedQuoteReviewTarget ? sharedQuoteReviewTarget : "loan-pricing"} tabIndex={-1} aria-label="Loan pricing">
        <div className="section-heading"><h3><Calculator size={17} /> Loan pricing</h3>
          {!processor && <Button size="sm" variant="outline" onClick={() => openPricing()}>Price loan</Button>}
        </div>
        <p className="empty-inline">{savedOffer && savedPricing ? `${savedPricing.mode === "mock" ? "Saved sample" : "Saved stage quote"} · ${requestedMoney(savedPricing.scenario.loanAmount)} · ${savedOffer.product} at ${savedOffer.rate.toFixed(3)}%` : "Compare sample rate and fee options, then save a quote to the loan."}</p>
        {savedPricing && !pricingInputsMatch(savedPricing, application) &&
          <p className="quote-disclaimer">Saved quote needs repricing with the current 1003 and income inputs.</p>}
        {rate && <p className="timestamp">{mockRateStatus(rate, new Date().toISOString())} · {rate.rate.toFixed(3)}%
          {rate.quoteTerms && ` · ${mockRateQuoteTermsLabel(rate.quoteTerms)}`}{rate.lockCancelledAt
          ? ` · ${dateTime(rate.lockCancelledAt)} ET` : rate.lockExpiresAt && ` · Expires ${dateTime(rate.lockExpiresAt)} ET`}</p>}
      </section>
      {(staff?.brokerage.pilot || (!staff && process.env.NODE_ENV === "development")) &&
        <IncomeWorksheet key={loan.id} loanId={loan.id} brokerageId={staff?.brokerage.id ?? demoBrokerageId} focused={target === "income-worksheet"}
          onChanged={() => void save({ type: "refreshApplication", loanId: loan.id })}
          onPrice={processor ? undefined : (source) => openPricing(true, source)} />}
      <CreditAusWorkbench loanId={loan.id} runs={state.mockCreditAusRuns.filter((run) => run.loanId === loan.id)}
        revision={submittedApplicationRevision(application)} busy={busy} readOnly={processor} save={save} openPricing={() => openPricing(true)} />
      </>}
      {section === "Disclosures" && canOpenDisclosures &&
        <DisclosureWorkbench loan={loan} state={state} busy={busy} readOnly={processor} brokerageId={staff?.brokerage.id ?? demoBrokerageId}
          save={save} open={open} refresh={openScopedLoan} />}
      {section === "Closing" && <>
      <ClosingWorkbench loan={loan} state={state} busy={busy} save={save} canReverseFunding={!staff || staff.brokerage.role === "Admin"}
        brokerageId={staff?.brokerage.id ?? demoBrokerageId}
        reopenedCondition={reopenedClosing} openCondition={open}
        advanceDemoToFunding={(campaignLender || linkedManual) && (!staff || staff.brokerage.pilot) ? () => open("loan-funding") : undefined}
        canMarkClearToClose={!processor && loan.stage !== "Clear to Close" && closingReviewReady(loan, state)}
        manualClearance={Boolean(linkedManual && !application?.uwmReference)}
        canRehearseFailure={staff ? Boolean(staff.brokerage.pilot) && staff.brokerage.role === "Admin" : process.env.NODE_ENV === "development"}
        borrowerCheckIn={checkInTask && { dueAt: checkInTask.dueAt, open: () => open(fundingCheckInTarget) }}
        preview={(audience, draftId) => show({ kind: "communication", loanId: loan.id, audience, draftId, returnTo: "closing-workbench", campaignLender })} />
      {callReportFile && <CallReportLoanFacts key={`${loan.id}:${callReportFile.revision}`} file={callReportFile} busy={busy} save={save} />}
      </>}
      {section === "1003" && <>
      <LoanApplication loanId={loan.id} state={state} busy={busy} save={save} processor={processor}
        jointLinks={!processor && (staff ? staff.brokerage.id === demoBrokerageId || !!staff.brokerage.pilot : process.env.NODE_ENV === "development")}
        shareBrokerage={!processor && (staff ? staff.brokerage.pilot : process.env.NODE_ENV === "development") ? staff?.brokerage.id ?? demoBrokerageId : undefined}
        markDraftChanged={markDraftChanged}
        openConditions={(id) => open(submissionTarget(id))} campaignManual={campaignLender === "manual" && !processor}
        openPricing={() => openPricing()}
        openReviews={canOpenReviews ? () => open(loanReviewsTarget) : undefined} />
      {canOpenReviews && application?.reviewedAt && !state.playbook.requireSecondReview && <div><Button size="sm" variant="outline" onClick={() => open(loanReviewsTarget)}>Open team reviews</Button></div>}
      {staff?.brokerage.pilot && state.mismoLoans.includes(loan.id) && <section className="details-section" aria-label="Synthetic loan file">
        <h3>Synthetic loan file</h3>
        <p className="muted">Download the original reviewed field mapping for this fictional 1003 rehearsal.</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void save({ type: "exportMismo", loanId: loan.id }, ({ mismoXml }) => {
          if (mismoXml) downloadSampleFile(mismoXml, "orbit-fictional-rehearsal.xml", "application/xml");
        })}>Export original XML mapping</Button>
      </section>}
      </>}
      {section === "Conditions" && <>
      <section className="details-section" id="lender-submissions" tabIndex={-1}>
        <div className="section-heading"><h3>Lender conditions</h3><Button variant="outline" size="sm" onClick={() => show({ kind: "submission", loanId: loan.id })}><Plus /> Add lender</Button></div>
        {submissions.length === 0 && <p className="empty-inline">No lender submissions yet. Add a manual lender or send the reviewed 1003 to mock UWM.</p>}
        {submissions.map((submission) => <SubmissionCard key={submission.id} submission={submission} requests={requests} busy={busy} save={save}
          checklistLinks={checklistLinks} joint={joint} brokerageId={staff?.brokerage.id ?? demoBrokerageId} pilot={staff?.brokerage.pilot}
          canSimulate={!processor && (!staff || staff.brokerage.id === demoBrokerageId || !!staff.brokerage.pilot)}
          onEdit={() => show({ kind: "submission", loanId: loan.id, submissionId: submission.id })} />)}
      </section>
      {state.serviceOrders !== undefined && <LoanServiceOrders key={loan.id} loanId={loan.id}
        orders={state.serviceOrders.filter((item) => item.loanId === loan.id)} busy={busy}
        owner={state.loanProcessing.find((item) => item.loanId === loan.id && item.processorEmail)?.processorName || loan.officer || "Unassigned"}
        editable={!pausedLoan(loan) && !pastClientLoan(loan)} save={save} openClosing={() => open(closingChecklistListTarget)} />}
      <LoanDocuments loanId={loan.id} brokerageId={staff?.brokerage.id ?? demoBrokerageId} pilot={staff?.brokerage.pilot} joint={joint} requests={requests} inlineRequests={inlineRequests}
        openConditionRequests={openConditionRequests} replaceableRequests={replaceableRequests}
        customTemplates={!pausedLoan(loan) && !pastClientLoan(loan) && (staff ? staff.brokerage.id === demoBrokerageId || !!staff.brokerage.pilot :
          process.env.NODE_ENV === "development")}
        officer={loan.officer} processor={assignment?.processorName}
        openAssignment={staff?.brokerage.role === "Admin" ? () => show({ kind: "assignment", loanId: loan.id, returnTo: "document-checklist" }) : undefined}
        localTemplateEditor={!staff && process.env.NODE_ENV === "development"}
        applicationStarted={Boolean(application)} applicationSubmitted={Boolean(application?.submittedAt)} busy={busy} save={save}
        applicationReviewRevision={application?.reviewedAt && application.submittedAt ? application.revision : null}
        followUp={() => show({ kind: "documentFollowUp", loanId: loan.id })} />
      {canOpenDisclosures && (!staff || state.borrowerQuestions !== undefined) && <LoanBorrowerQuestions key={loan.id} loanId={loan.id}
        questions={(state.borrowerQuestions ?? []).filter((item) => item.loanId === loan.id)}
        canRequest={Object.values(checklistLinks).some(Boolean) && !pausedLoan(loan) && !pastClientLoan(loan)}
        joint={joint} busy={busy} save={save} />}
      </>}
      {section === "Activity" && <>
      {canOpenReviews && <LoanReviews loanId={loan.id} brokerageId={staff?.brokerage.id ?? demoBrokerageId}
        focusId={target?.startsWith(reviewTarget("")) ? target.slice(reviewTarget("").length) : undefined}
        onChanged={reviewChanged} openEvidence={open} />}
      <LoanAppointments loanId={loan.id} brokerageId={staff?.brokerage.id ?? demoBrokerageId}
        focusId={target?.startsWith(appointmentTargetPrefix) ? target.slice(appointmentTargetPrefix.length) : undefined} onChange={appointmentChanged} />
      {realtorDraft && <section className="details-section">
        <div className="section-heading"><h3>Latest realtor update</h3><span className="pill">{realtorDraft.milestone}</span></div>
        <Button size="sm" variant="outline" onClick={() => show({ kind: "communication", loanId: loan.id, audience: "Realtor",
          draftId: realtorDraft.id, returnTo: "lender-submissions", campaignLender })}>Preview latest realtor draft</Button>
      </section>}
      {!processor && <div id="loan-retention" tabIndex={-1}><LoanRetention loan={loan} profile={profile} edit={() => show({ kind: "retention", loanId: loan.id })} /></div>}
      {!sharedProcessor && <section className="details-section" aria-label="Loan follow-up tasks" id="loan-tasks" tabIndex={-1}>
        <div className="section-heading"><h3><CheckCircle2 size={17} /> Follow-up tasks</h3></div>
        {tasks.length ? <ul className="loan-task-list">{tasks.map((task) =>
          <LoanTaskRow key={task.id} id={searchTaskTarget(task.id)} task={task} officer={loan.officer} busy={busy}
            blocked={prospectingBlocked(task.purpose, borrower?.outreachSuppressed)}
            context={task.id === `rate-watch:${loan.id}` ? rateContext : undefined}
            action={task.id === checkInTask?.id ? <Button size="sm" variant="outline" disabled={busy} onClick={() => open(fundingCheckInTarget)}>Record check-in</Button> :
              disclosureTask(task.id) ? <Button size="sm" variant="outline" disabled={busy} onClick={() => open(disclosureTarget)}>Open disclosures</Button> :
              isSharedQuoteReview(task.id) && !processor ? <Button size="sm" variant="outline" disabled={busy}
                onClick={() => show({ kind: "pricing", loanId: loan.id, reviewSharedQuote: true })}>Open quote review</Button> : undefined}
            onChange={task.campaignCallback || disclosureTask(task.id) || isSharedQuoteReview(task.id) || task.id.startsWith(reversedFundingTaskPrefix) ||
              task.id.startsWith(mockUwmReceiptTaskPrefix) ? undefined :
              () => void save({ type: "completeTask", id: task.id, completed: !task.completedAt })}>
            {task.id === `rate-watch:${loan.id}` && !task.completedAt && canStartRateRefinance &&
              <div><Button size="sm" variant="outline" disabled={busy} onClick={() => openRateWatchRefinance(loan.id)}>Start refinance 1003</Button></div>}
            {task.campaignCallback === "Recorded" && <span className="pill">Callback outcome recorded</span>}
            {task.campaignCallback === "Pending" && (loan.disposition && loan.disposition !== "Active" ?
              <span className="pill">Reopen loan to work callback</span> :
              !prospectingBlocked(task.purpose, borrower?.outreachSuppressed) && <>
                <CarriedCallbackForm loanId={loan.id} taskId={task.id} dueAt={task.dueAt} busy={busy} save={save} />
                {task.campaignCallbackRevision !== undefined && <CarriedCallbackRescheduleForm loanId={loan.id} taskId={task.id}
                  dueAt={task.dueAt} revision={task.campaignCallbackRevision} busy={busy} save={save} />}
              </>)}
          </LoanTaskRow>
        )}</ul> : <p className="empty-inline">A follow-up task appears when the borrower submits a 1003.</p>}
        <details className="loan-task-create"><summary>Add follow-up task</summary>
          <form className="record-form" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void save({ type: "createTask", loanId: loan.id, title: text(data, "title"), days: Number(text(data, "days")), purpose: text(data, "purpose") }, () => {
              form.reset();
              form.closest("details")?.removeAttribute("open");
            });
          }}>
            <Field label="Task title"><input name="title" required maxLength={120} placeholder="e.g. Call about the quote" /></Field>
            <div className="form-grid">
              <FollowUpPurposeField optedOut={borrower?.outreachSuppressed} />
              <Field label="Due in"><select name="days"><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option></select></Field>
            </div>
            <div><Button size="sm" type="submit" disabled={busy}><Plus /> Add task</Button></div>
          </form>
        </details>
      </section>}
      <LoanCommunications loan={loan} state={state} openConversation={openConversation} preview={(loanId, audience, draftId) => show({ kind: "communication", loanId, audience, draftId })} />
      <LoanAudit key={loan.id} loanId={loan.id} busy={busy} save={save} />
      <section className="details-section" id="loan-activity" tabIndex={-1}>
        <div className="section-heading"><h3><ClipboardList size={17} /> Activity</h3></div>
        <form className="note-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const input = { type: "note", loanId: loan.id, kind: activityKind, text: text(data, "note"),
            outcome: text(data, "outcome") || undefined, followUp: text(data, "followUp") || undefined, purpose: text(data, "purpose") || undefined };
          const key = JSON.stringify(input);
          if (activityAttempt.current?.key !== key) activityAttempt.current = { key, id: crypto.randomUUID() };
          void save({ ...input, eventId: activityAttempt.current.id }, () => { activityAttempt.current = null; form.reset(); });
        }}>
          <Field label="Activity type"><select value={activityKind} onChange={(event) => setActivityKind(event.target.value as ActivityKind)}>{activityKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
          <textarea name="note" aria-label="Activity note" placeholder={activityKind === "Note" ? "Write a note about this loan…" : `Summarize the ${activityKind.toLowerCase()}…`} maxLength={2000} required />
          {activityKind !== "Note" && <div className="form-grid">
            <Field label="Contact outcome"><select name="outcome"><option value="">Choose an outcome</option>{contactOutcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}</select></Field>
            <Field label="Next follow-up date"><input type="date" name="followUp" /></Field>
            <FollowUpPurposeField optedOut={borrower?.outreachSuppressed} />
          </div>}
          <Button type="submit" variant="outline" size="sm" disabled={busy}>{activityKind === "Note" ? "Add note" : `Log ${activityKind.toLowerCase()}`}</Button>
        </form>
        <ActivityPages key={loan.id} record="loan" id={loan.id} brokerageId={staff?.brokerage.id ?? demoBrokerageId} version={state}
          render={(notes) => notes.length ? notes.map((note) => <div className="note" key={note.id}><div className="activity-meta">
            <span className="pill">{note.kind}{note.outcome && ` · ${note.outcome}`}</span><small>{dateTime(note.createdAt)} ET</small></div><p>{note.text}</p></div>)
            : <p className="empty-inline">No activity recorded on this loan.</p>} />
      </section>
      </>}
    </div>
  );
}

function ReturningClientForm({ borrower, originalProperty, fromRateWatch, busy, close, start }: {
  borrower: string; originalProperty?: string; fromRateWatch?: true; busy: boolean; close: () => void;
  start: (purpose: "Purchase" | "Refinance", confirmedPropertyAddress?: string) => void;
}) {
  const [purpose, setPurpose] = useState<"" | "Purchase" | "Refinance">(fromRateWatch ? "Refinance" : "");
  const reuse = purpose === "Refinance" ? originalProperty : undefined;
  return <form className="record-form" onSubmit={(event) => {
    event.preventDefault();
    if (purpose) start(purpose, new FormData(event.currentTarget).has("confirmProperty") ? reuse : undefined);
  }}>
    <p>Start a separate application for <strong>{borrower}</strong> using their saved contact details. Open or copy the borrower link from the new loan record.</p>
    {fromRateWatch ? <p>Start the refinance once the borrower asks to proceed. This completes the rate-watch task.</p> :
      <Field label="Loan purpose"><select id="returning-client-purpose" value={purpose} required onChange={(event) => setPurpose(event.target.value as typeof purpose)}>
        <option value="" disabled>Choose a loan purpose</option><option>Purchase</option><option>Refinance</option>
      </select></Field>}
    {reuse && <label className="demo-confirm" key={reuse}>
      <input type="checkbox" name="confirmProperty" id={fromRateWatch ? "returning-client-purpose" : undefined} />
      <span>Reuse the original property address <strong>{reuse}</strong></span>
    </label>}
    <div className="dialog-footer"><div className="spacer" /><Button variant="outline" onClick={close}>Cancel</Button>
      <Button id={fromRateWatch && !reuse ? "returning-client-purpose" : undefined} type="submit" disabled={busy}>Start and open 1003</Button></div>
  </form>;
}

export function RecordDialog({ modal, state, staff, busy, error, save, show, close, refreshLoan, refreshLoanOnReturn, openLead, openConversation, openContactConversation, openConversationThread, appointmentChanged, reviewChanged, searchContact, openContact, openContactLoan, repeatOption, openRateWatchRefinance, assignmentChanged, assignmentVersion }: {
  modal: Modal; state: Workspace; staff: WorkspaceStaff | null; busy: boolean; error: ReactNode; save: Save; show: (modal: Modal) => void; close: () => void;
  refreshLoan?: () => void;
  refreshLoanOnReturn?: (loanId: string, canApply: () => boolean, periodic: boolean) => Promise<void>;
  openLead: (id: string) => void;
  openConversation: (subject: ConversationSubject) => void;
  openContactConversation: (contactId: string) => void;
  openConversationThread: (id: string) => void;
  appointmentChanged: () => void;
  reviewChanged: () => void;
  searchContact?: SearchContact;
  repeatOption?: ReturningClientOption;
  openRateWatchRefinance: (loanId: string) => void;
  openContact: (id: string) => void;
  openContactLoan: (id: string, target?: string, manualReturn?: ManualReturnAssignment) => void;
  assignmentChanged: () => void;
  assignmentVersion: object;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const dirtyEditors = useRef(new Set<Node>());
  const [refreshDeferred, setRefreshDeferred] = useState<Modal | null>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  const target = modal.kind === "pricing" ? "pricing-workbench" : modal.kind === "returningClient" ? "returning-client-purpose" :
    modal.kind === "fundingCheckIn" ? "funding-check-in-channel" :
    modal.kind === "details" ? modal.target : undefined;
  useEffect(() => {
    if (!target) return;
    const item = document.getElementById(target);
    if (target === manualLenderAcknowledgmentTarget) item?.closest("details")?.setAttribute("open", "");
    if (item instanceof HTMLDetailsElement) {
      item.open = true;
      item.querySelector("summary")?.focus({ preventScroll: true });
    } else item?.focus({ preventScroll: true });
    if (loanSections.some(([, destination]) => destination === target)) dialog.current?.scrollTo({ top: 0 });
    else item?.scrollIntoView({ block: "start" });
  }, [modal, target]);
  const loan = "loanId" in modal ? state.loans.find((item) => item.id === modal.loanId) : undefined;
  const returnSection = modal.kind === "details" ? loanSection(target) : undefined;
  const processingHandoff = modal.kind === "details" && target === "processing-handoff";
  const returnLoanId = refreshLoanOnReturn && (processingHandoff || returnSection === "1003" || returnSection === "Conditions" ||
    returnSection === "Disclosures") ? loan?.id : undefined;
  const returnApplication = returnLoanId ? state.applications.find((application) => application.loanId === returnLoanId) : undefined;
  const returnToken = returnApplication?.token;
  const returnJointToken = returnApplication?.joint?.token;
  const returnBrokerageId = staff?.brokerage.id;
  const returnEmail = staff?.email;
  const returnRole = staff?.brokerage.role;
  const mockHandoff = staff?.brokerage.pilot === true;
  const refreshReturnedLoan = useEffectEvent(async (loanId: string, isCurrent: () => boolean, periodic = false) => {
    function canApply(notify = true) {
      if (!isCurrent()) return false;
      for (const editor of dirtyEditors.current) {
        if (!editor.isConnected) dirtyEditors.current.delete(editor);
      }
      if (dirtyEditors.current.size === 0) return true;
      if (notify) setRefreshDeferred(modal);
      return false;
    }
    if (busy || !canApply(!periodic)) return;
    setRefreshDeferred(null);
    await refreshLoanOnReturn?.(loanId, canApply, periodic);
  });
  useEffect(() => {
    if (!returnLoanId || (!returnToken && !processingHandoff)) return;
    let active = true;
    const stopChanges = returnToken && observeBorrowerChange(returnToken, "changed", () => void refreshReturnedLoan(returnLoanId, () => active));
    const stopJointChanges = returnJointToken && observeBorrowerChange(returnJointToken, "changed", () => void refreshReturnedLoan(returnLoanId, () => active));
    const stopChecks = observeHandoffChecks(document, window, (isCurrent, periodic) => refreshReturnedLoan(returnLoanId, isCurrent, periodic), mockHandoff);
    return () => {
      active = false;
      if (stopChanges) stopChanges();
      if (stopJointChanges) stopJointChanges();
      stopChecks();
    };
  }, [mockHandoff, modal, processingHandoff, returnLoanId, returnToken, returnJointToken, returnBrokerageId, returnEmail, returnRole]);
  function markDraftChanged(editor: Node) {
    if (returnLoanId) dirtyEditors.current.add(editor);
  }
  function trackDraftInput(event: FormEvent<HTMLDivElement>) {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
      markDraftChanged(field);
    }
  }
  const campaignLender = "campaignLender" in modal ? modal.campaignLender : undefined;
  const scopedContact = (modal.kind === "contactHistory" || modal.kind === "contact") &&
    searchContact?.contact.id === modal.contactId ? searchContact : undefined;
  const contact = scopedContact ? (scopedContact.assignedOnly ? undefined : scopedContact.contact) :
    "contactId" in modal ? state.contacts.find((item) => item.id === modal.contactId) : undefined;
  const assignedContact = scopedContact?.assignedOnly ? scopedContact.contact :
    !contact && modal.kind === "contactHistory" ? state.followUpContacts.find((item) => item.id === modal.contactId) : undefined;
  const submission = modal.kind === "submission" ? state.submissions.find((item) => item.id === modal.submissionId) : undefined;
  const title = {
    details: "Loan details", loan: loan ? "Edit loan" : "New Lead",
    assignment: modal.kind === "assignment" && modal.manualReturn ? "Reassign lender return" : "Loan assignment",
    contact: contact ? "Edit contact" : "New contact", submission: submission ? "Edit lender submission" : "Add lender submission",
    communication: "Message draft",
    documentFollowUp: "Document follow-up",
    pricing: "Loan pricing",
    retention: "Past-client follow-up",
    contactHistory: "Contact history",
    contactDuplicates: "Review duplicate contacts",
    contactDuplicateQueue: "Possible duplicate contacts",
    contactMergeHistory: "Contact merge history",
    returningClient: "Start returning-client 1003",
    fundingCheckIn: "Record borrower check-in",
  }[modal.kind];
  const backTarget = modal.kind === "pricing" ? (modal.sourceQuote ? "loan-scenarios" : "loan-pricing") : modal.kind === "communication" ? modal.returnTo ?? "loan-communications" :
    modal.kind === "retention" ? "loan-retention" : modal.kind === "documentFollowUp" ? "document-checklist" :
    modal.kind === "submission" ? "lender-submissions" : modal.kind === "fundingCheckIn" && modal.returnToLoan ? "loan-tasks" : undefined;
  const back = () => loan ? show({ kind: "details", loanId: loan.id, target: backTarget, campaignLender }) : close();
  const retention = modal.kind === "retention" ? state.pastClients.find((profile) => profile.loanId === modal.loanId) : undefined;
  const checkIn = modal.kind === "fundingCheckIn" ? state.closingProgress.find((item) => item.loanId === modal.loanId) : undefined;
  const checkInBorrower = checkIn && loan ? state.contacts.find((item) => item.id === loan.contactId) : undefined;
  const canStartRepeat = repeatOption ? repeatOption.kind === "start" : checkInBorrower && checkInBorrower.role !== "Realtor" &&
    !state.returningClientLoans.some((item) => item.fundedLoanId === loan?.id);
  const key = `${modal.kind}-${loan?.id ?? contact?.id ?? "new"}-${modal.kind === "communication" ? modal.draftId ?? modal.audience : submission?.id ?? ""}`;
  const remove = (input: unknown, question: string, after: () => void) => {
    if (window.confirm(question)) void save(input, after);
  };
  const handoffApplication = modal.kind === "pricing" && loan
    ? state.applications.find((item) => item.loanId === loan.id) : undefined;
  const receivedByUwm = handoffApplication?.versions.some((version) =>
    version.revision === handoffApplication.revision && version.uwmReceipt);
  const lenderReceived = campaignLender === "manual"
    ? handoffApplication?.manualHandoff?.outcome === "Acknowledged" && !!handoffApplication.manualHandoff.submissionId : receivedByUwm;
  const receiptPending = campaignLender !== "manual" && !!handoffApplication?.uwmPendingReceipt;
  const handoffBlocker = lenderReceived || receiptPending ? null : secondReviewBlocker(state.playbook.requireSecondReview, handoffApplication);
  const lenderHandoff = modal.kind === "pricing" && loan && (handoffApplication || handoffBlocker) && staff?.brokerage.role !== "Processor" ? {
    label: handoffBlocker ? (handoffApplication?.reviewedAt ? "Open team reviews" : "Open 1003 review") :
      campaignLender === "manual" ? "Open manual MISMO export" : receiptPending ? "Open mock UWM receipt review" :
        receivedByUwm ? "Open mock UWM checklist" : "Send reviewed 1003 to mock UWM",
    blocker: handoffBlocker,
    checkQuoteAmount: campaignLender !== "manual" && !receivedByUwm && !receiptPending,
    proceed: (quote: { runId: string; offerId: string }) => {
      if (handoffBlocker) {
        show({ kind: "details", loanId: loan.id, target: handoffApplication?.reviewedAt ? loanReviewsTarget : "loan-application", campaignLender });
        return;
      }
      if (campaignLender === "manual") {
        show({ kind: "details", loanId: loan.id, target: "manual-lender-export", campaignLender });
        return;
      }
      if (receiptPending) {
        show({ kind: "details", loanId: loan.id, target: "loan-application", campaignLender });
        return;
      }
      const openChecklist = (workspace: Workspace) => {
        const reference = workspace.applications.find((item) => item.loanId === loan.id)?.uwmReference;
        const submission = workspace.submissions.find((item) => item.loanId === loan.id && item.lender === "UWM" && item.externalId === reference);
        show({ kind: "details", loanId: loan.id, target: submission ? submissionTarget(submission.id) : "lender-submissions", campaignLender });
      };
      if (receivedByUwm) openChecklist(state);
      else if (handoffApplication) void save({ type: "sendApplication", loanId: loan.id, revision: handoffApplication.revision, quote }, (result) => openChecklist(result.state));
    },
  } : undefined;
  return (
    <dialog ref={dialog} className={(modal.kind === "pricing" || modal.kind === "details" ? "record-dialog record-dialog-wide" : "record-dialog") + (modal.kind === "details" && modal.target === "loan-scenarios" ? " record-dialog-scenarios" : "")} aria-labelledby="record-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="dialog-top">
        <div className="dialog-head">
          {modal.kind === "assignment" && modal.returnTo && <Button variant="ghost" size="icon"
            aria-label={modal.returnTo === "document-checklist" ? "Back to document checklist" : "Back to processing handoff"}
            onClick={() => openContactLoan(modal.loanId, modal.returnTo)}><ArrowLeft /></Button>}
          {loan && modal.kind !== "details" && modal.kind !== "assignment" && modal.kind !== "returningClient" && (modal.kind !== "fundingCheckIn" || modal.returnToLoan) &&
            <Button variant="ghost" size="icon" aria-label="Back to loan details" onClick={back}><ArrowLeft /></Button>}
          <h2 id="record-title">{title}</h2>
          {refreshLoan && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRefreshDeferred(null); refreshLoan(); }}><RefreshCw /> Refresh loan</Button>}
          <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={close}><X /></Button>
        </div>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        {refreshDeferred === modal && <p className="dialog-refresh-notice muted" role="status">Automatic refresh paused for your edits. Finish editing before refreshing the loan.</p>}
      </div>
      <div className="dialog-content" key={key} onInputCapture={trackDraftInput} onChangeCapture={trackDraftInput}
        onResetCapture={(event) => {
          if (!(event.target instanceof HTMLFormElement)) return;
          for (const editor of dirtyEditors.current) {
            if (event.target.contains(editor)) dirtyEditors.current.delete(editor);
          }
        }}>
        {modal.kind === "details" && loan && <LoanDetails loan={loan} state={state} staff={staff} busy={busy}
          save={save} show={show} target={target} campaignLender={campaignLender} openConversation={openConversation}
          openRateWatchRefinance={openRateWatchRefinance}
          appointmentChanged={appointmentChanged} reviewChanged={reviewChanged} markDraftChanged={markDraftChanged}
          openScopedLoan={(destination = disclosureTarget) => openContactLoan(loan.id, destination)} />}
        {modal.kind === "assignment" && staff?.brokerage.role === "Admin" && <LoanAssignmentEditor key={modal.loanId}
          brokerageId={staff.brokerage.id} loanId={modal.loanId} version={assignmentVersion} onChanged={assignmentChanged}
          manualReturn={modal.manualReturn}
          openLoan={(id) => openContactLoan(id, modal.manualReturn ? undefined : modal.returnTo ?? "processing-handoff", modal.manualReturn)} />}
        {modal.kind === "communication" && loan && <CommunicationPreview key={`${loan.id}:${modal.audience}:${modal.draftId ?? ""}`}
          loan={loan} state={state} audience={modal.audience} draftId={modal.draftId} brokerageId={staff?.brokerage.id ?? demoBrokerageId} busy={busy} save={save} />}
        {modal.kind === "documentFollowUp" && loan && <DocumentFollowUp loan={loan} state={state} />}
        {modal.kind === "fundingCheckIn" && (loan && checkIn && canRecordFundingCheckIn(loan, state, staff?.brokerage.role) ?
          <FundingCheckInForm key={checkIn.revision} loanId={loan.id} fundingRevision={checkIn.revision}
            borrower={checkInBorrower} busy={busy} save={save} close={modal.returnToLoan ? back : close}
            startRepeat={canStartRepeat ? () => show({ kind: "returningClient", loanId: loan.id }) : undefined} /> :
          <p className="empty-inline">Refresh the post-funding tasks to see the current check-in.</p>)}
        {modal.kind === "returningClient" && loan && <ReturningClientForm key={`${loan.id}:${modal.fromRateWatch ?? false}`}
          borrower={state.contacts.find((item) => item.id === loan.contactId)?.name ?? "this borrower"}
          originalProperty={reusablePropertyAddress(loan.address)} fromRateWatch={modal.fromRateWatch} busy={busy} close={close}
          start={(purpose, confirmedPropertyAddress) => void save({
            type: "startReturningClient1003", loanId: loan.id, purpose, fromRateWatch: modal.fromRateWatch, confirmedPropertyAddress,
          }, ({ applicationLoanId }) => {
            if (applicationLoanId) show({ kind: "details", loanId: applicationLoanId, target: "loan-application" });
          })} />}
        {modal.kind === "pricing" && loan && <LoanPricing loan={loan} state={state} busy={busy} save={save}
          brokerageId={staff?.brokerage.id ?? demoBrokerageId}
          openApplication={() => show({ kind: "details", loanId: loan.id, campaignLender, target: "loan-application" })}
          reviewedIncome={modal.reviewedIncome}
          openIncome={(staff?.brokerage.pilot || (!staff && process.env.NODE_ENV === "development")) ?
            () => show({ kind: "details", loanId: loan.id, campaignLender, target: "income-worksheet" }) : undefined}
          useMockScore={modal.useMockScore} lenderHandoff={lenderHandoff} sourceQuote={modal.sourceQuote} reviewSharedQuote={modal.reviewSharedQuote} />}
        {modal.kind === "retention" && loan && <Form busy={busy} onCancel={back} done={(input) => void save(input, back)}
          save={(data) => ({
            type: "saveRetention", loanId: loan.id, revision: retention?.revision ?? 0, closingDate: text(data, "closingDate"),
            currentRate: text(data, "currentRate"), targetRate: text(data, "targetRate"), observedRate: text(data, "observedRate"),
            watchEnabled: data.has("watchEnabled"), note: text(data, "note"),
          })}><RetentionFields profile={retention} /></Form>}
        {modal.kind === "loan" && <Form busy={busy} onCancel={back} newLead={!loan} done={(input) => void save(input, (result) => {
          const token = result.applicationToken ?? result.state.applications.find((item) => item.loanId === result.applicationLoanId)?.token;
          if (token) router.push(`/apply#${token}`);
          else back();
        })}
          remove={loan && staff?.brokerage.role !== "LO" ? () => remove({ type: "deleteLoan", id: loan.id }, "Delete this loan, its closing checklist, application, document requests, tasks, submissions and activity?", close) : undefined}
          save={(data) => ({
            type: "loan", id: loan?.id, contactId: text(data, "contactId"), borrower: text(data, "borrower"),
            borrowerEmail: text(data, "borrowerEmail"), borrowerPhone: text(data, "borrowerPhone"), start1003: data.has("start1003"),
            address: text(data, "address"), amount: Number(text(data, "amount")), purpose: text(data, "purpose"),
            stage: text(data, "stage"), officer: text(data, "officer"), partnerId: text(data, "partnerId") || null,
            leadSource: text(data, "leadSource") || undefined,
            assignToSelf: staff ? data.has("assignToSelf") : undefined,
          })}>
          <LoanFields loan={loan} state={state} stage={modal.stage} staff={staff} existingContactId={modal.contactId} />
        </Form>}
        {modal.kind === "contactHistory" && contact && <ContactHistory key={contact.id} contact={contact} state={state}
          brokerageId={staff?.brokerage.id ?? demoBrokerageId} linkedLoans={scopedContact}
          open={openContactLoan} openLead={openLead} openThread={openConversationThread} busy={busy}
          save={staff?.brokerage.role === "Processor" ? undefined : save}
          reviewDuplicates={!staff || staff.brokerage.role === "Admin" ? () => show({ kind: "contactDuplicates", contactId: contact.id }) : undefined}
          conversation={staff?.brokerage.role !== "Processor" ? () => openContactConversation(contact.id) : undefined}
          optOut={staff?.brokerage.role !== "Processor" && contact.role !== "Realtor" ? () => void save({ type: "optOutContact", contactId: contact.id }) : undefined}
          repeat={staff?.brokerage.role !== "Processor" && contact.role !== "Realtor" ? () => show({ kind: "loan", contactId: contact.id }) : undefined} />}
        {assignedContact && <ContactHistory key={assignedContact.id} contact={assignedContact} state={state} assignedOnly
          brokerageId={staff?.brokerage.id ?? demoBrokerageId}
          open={openContactLoan} openLead={openLead} openThread={openConversationThread} busy={busy} />}
        {modal.kind === "contactHistory" && !contact && !assignedContact && <p className="empty-inline">This contact is unavailable in your current view.</p>}
        {modal.kind === "contactDuplicates" && contact && <ContactDuplicateReview key={contact.id} contact={contact} contacts={state.contacts}
          brokerageId={staff?.brokerage.id ?? demoBrokerageId}
          onMerged={(id) => void save({ type: "refreshWorkspace" }, () => show({ kind: "contactHistory", contactId: id }))} />}
        {modal.kind === "contactDuplicateQueue" && <ContactDuplicateQueue brokerageId={staff?.brokerage.id ?? demoBrokerageId}
          onSaved={() => void save({ type: "refreshWorkspace" })}
          openContact={openContact} />}
        {modal.kind === "contactMergeHistory" && <ContactMergeHistory brokerageId={staff?.brokerage.id ?? demoBrokerageId}
          refreshContacts={() => void save({ type: "refreshWorkspace" })}
          openContact={openContact} />}
        {modal.kind === "contact" && modal.contactId && !contact && <p className="empty-inline">This contact is unavailable in your current view.</p>}
        {modal.kind === "contact" && (!modal.contactId || contact) && <Form busy={busy} onCancel={close} done={(input) => void save(input, close)}
          remove={contact ? () => remove({ type: "deleteContact", id: contact.id }, "Delete this contact?", close) : undefined}
          save={(data) => ({ type: "contact", id: contact?.id, name: text(data, "name"), role: text(data, "role"), email: text(data, "email"), phone: text(data, "phone") })}>
          <ContactFields contact={contact} />
        </Form>}
        {modal.kind === "submission" && loan && <Form busy={busy} onCancel={back} done={(input) => void save(input, back)}
          remove={submission ? () => remove({ type: "deleteSubmission", id: submission.id }, "Delete this lender submission?", back) : undefined}
          save={(data) => ({ type: "submission", id: submission?.id, loanId: loan.id, lender: text(data, "lender"), externalId: text(data, "externalId"), status: text(data, "status") })}>
          <Field label="Lender"><input name="lender" placeholder="e.g. UWM" defaultValue={submission?.lender} maxLength={160} required /></Field>
          <Field label="Lender reference"><input name="externalId" defaultValue={submission?.externalId} maxLength={160} required /></Field>
          <Field label="Lender status"><input name="status" placeholder="e.g. File received" defaultValue={submission?.status} maxLength={160} required /></Field>
        </Form>}
      </div>
    </dialog>
  );
}
