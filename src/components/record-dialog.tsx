"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Calculator, CheckCircle2, Circle, ClipboardList, Clock3, Copy, ExternalLink, Pencil, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { activityKinds, contactOutcomes, leadSources, stages, type ActivityKind, type Contact, type DraftAudience, type Loan, type Stage, type Submission, type Workspace } from "@/lib/model";
import { dateTime, initials, money, stageDays } from "@/lib/utils";
import { Button } from "./ui/button";
import { ApplicationAnswers } from "./application-fields";
import { LoanTaskRow } from "./loan-task";
import { LoanPricing } from "./loan-pricing";
import { CommunicationPreview, LoanCommunications } from "./loan-communications";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { blankLenderDetails, lenderQuestions, lenderSupplement, type LenderDetails } from "@/lib/urla";
import { changedApplicationSections, type StaffApplication } from "@/lib/application-model";
import { QuestionnaireFields, type ChangeAnswers } from "./urla-fields";
import { LoanRetention, RetentionFields } from "./past-client-crm";
import { DocumentRequestForm, LoanDocumentCard, LoanDocuments } from "./loan-documents";
import { DocumentFollowUp } from "./document-follow-up";
import type { LoanDocumentRequest } from "@/lib/document-model";
import { mockRateStatus } from "@/lib/pricing-model";
import { CallReportLoanFacts } from "./call-report";
import { LoanAudit } from "./loan-audit";
import { ManualLenderExport } from "./manual-lender-export";
import { ClosingWorkbench } from "./closing-workbench";
import { CreditAusWorkbench } from "./credit-aus-workbench";
import { conditionTarget, submissionTarget } from "@/lib/uwm-alert-model";
import { downloadSampleFile } from "./sample-download";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { loanNextAction, pausedLoan } from "@/lib/loan-workflow";
import { LoanWorkflow } from "./loan-workflow";
import { ProcessingHandoff } from "./processing-handoff";
import { FileReadiness } from "./file-readiness";
import { ManualConditions } from "./manual-conditions";
import { ContactHistory } from "./contact-crm";
import { ConditionResponse } from "./condition-response";

export type Modal =
  | { kind: "details"; loanId: string; target?: string }
  | { kind: "loan"; loanId?: string; stage?: Stage; contactId?: string }
  | { kind: "contactHistory"; contactId: string }
  | { kind: "contact"; contactId?: string }
  | { kind: "communication"; loanId: string; audience: DraftAudience; draftId?: string }
  | { kind: "documentFollowUp"; loanId: string }
  | { kind: "pricing"; loanId: string; target?: string }
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
  const [contactId, setContactId] = useState(loan?.contactId ?? existingContactId ?? "");
  const [assignToSelf, setAssignToSelf] = useState(Boolean(staff && (!loan || loan.officerEmail === staff.email)));
  const [manualOfficer, setManualOfficer] = useState(loan?.officer ?? (staff ? "" : "Alex Morgan"));
  const borrowerLocked = loan && state.applications.some((application) => application.loanId === loan.id);
  const managed = staff && (staff.brokerage.id !== demoBrokerageId || staff.brokerage.role === "LO");
  return (
    <>
      <Field label="Borrower contact">
        <select name="contactId" disabled={borrowerLocked} value={contactId} onChange={(event) => setContactId(event.target.value)}>
          <option value="">Create a borrower</option>
          {state.contacts.filter((contact) => contact.role !== "Realtor").map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
        </select>
      </Field>
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
      <datalist id="loan-officers">{[...new Set(state.loans.map((item) => item.officer).filter(Boolean))].sort().map((officer) => <option key={officer} value={officer} />)}</datalist>
      <Field label="Realtor partner">
        <select name="partnerId" defaultValue={loan?.partnerId ?? ""}>
          <option value="">No realtor linked</option>
          {state.contacts.filter((contact) => contact.role === "Realtor").map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
        </select>
      </Field>
      <Field label="Lead source"><select name="leadSource" defaultValue={loan?.leadSource ?? (existingContactId && state.loans.some((item) => item.contactId === existingContactId) ? "Returning client" : "")}>
        <option value="">Use lead details</option>{leadSources.map((source) => <option key={source}>{source}</option>)}
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

function SubmissionCard({ submission, requests, busy, save, onEdit, borrowerUrl, brokerageId, pilot }: {
  submission: Submission; requests: LoanDocumentRequest[]; busy: boolean; save: Save; onEdit: () => void; borrowerUrl?: string; brokerageId: string; pilot?: boolean;
}) {
  const open = submission.conditions.filter((item) => !item.satisfiedAt);
  const cleared = submission.conditions.filter((item) => item.satisfiedAt);
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
        {submission.conditions.length === 0 && <p className="muted">No conditions were returned for this loan.</p>}
        {[...open, ...cleared].map((item) => {
          const request = requests.find((entry) => entry.submissionId === submission.id && entry.conditionId === item.id);
          return <div className="condition" key={item.id} id={conditionTarget(submission.id, item.id)} tabIndex={-1}>
            {item.satisfiedAt ? <CheckCircle2 size={16} className="text-emerald-700" /> : <Circle size={16} className="text-amber-600" />}
            <div><strong>{item.category}{item.group && ` · ${item.group}`}</strong><p>{item.description}</p>
              <small>{submission.lender === "UWM" && "UWM · "}{item.satisfiedAt ? `Cleared ${dateTime(item.satisfiedAt)} ET` : item.uploaded ? "Document uploaded" : "Outstanding"}</small>
              {request ? <>
                {!item.satisfiedAt && (request.status === "Requested" || request.status === "Needs replacement") && <div className="loan-application-actions">
                  {borrowerUrl && <Button size="sm" variant="outline" asChild><a href={borrowerUrl} target="_blank" rel="noopener noreferrer">Open borrower checklist <ExternalLink /></a></Button>}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshApplication", loanId: submission.loanId })}>Refresh condition</Button>
                </div>}
                <LoanDocumentCard key={request.revision} request={request} brokerageId={brokerageId} pilot={pilot}
                  openCondition={!item.satisfiedAt} replaceable={!item.satisfiedAt} busy={busy} save={save} compact />
              </> : !item.satisfiedAt && <DocumentRequestForm loanId={submission.loanId} source={{ submissionId: submission.id, condition: item }} busy={busy} save={save} quick />}
              {!item.satisfiedAt && <ConditionResponse condition={item} request={request} lender={submission.lender} />}
            </div>
          </div>;
        })}
      </>}
      {!submission.syncedAt && <ManualConditions submission={submission} requests={requests} busy={busy} save={save} />}
    </article>
  );
}

function LoanApplication({ loanId, state, busy, save, processor }: { loanId: string; state: Workspace; busy: boolean; save: Save; processor?: boolean }) {
  const [copyStatus, setCopyStatus] = useState("");
  const application = state.applications.find((item) => item.loanId === loanId);
  const linkStatus = application?.revokedAt ? "Revoked" : application && application.expiresAt <= new Date().toISOString() ? "Expired" : "Active";
  const path = application ? `/apply#${application.token}` : "";
  const status = application?.correctionNote ? "Corrections requested" : application?.submittedAt && !application.reviewedAt
    ? "Needs review" : application?.uwmReference ? "Sent to UWM · Mock" : application?.reviewedAt ? "Reviewed" : "Draft";
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
    {!application ? <div className="loan-application-box">
      <p className="muted">Create a link for a borrower to complete a sample application. Use fictional information.</p>
      {!processor && <Button size="sm" disabled={busy} onClick={() => run("startApplication")}><Plus /> Start 1003</Button>}
    </div> : <div className="loan-application-box">
      <p className="muted">Borrower link · <strong>{linkStatus}</strong>{linkStatus === "Active" && ` · Expires ${dateTime(application.expiresAt)} ET`}</p>
      <div className="loan-application-actions">
        {linkStatus === "Active" ? <>
          <Button asChild size="sm" variant="outline"><a href={path} target="_blank" rel="noopener noreferrer"><ExternalLink /> {application.submittedAt ? "Open borrower status" : "Open borrower view"}</a></Button>
          <Button size="sm" variant="outline" onClick={() => void copy()}><Copy /> Copy link</Button>
          {!processor && <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
            if (window.confirm("Revoke this borrower link? The borrower will need a new link to return.")) {
              setCopyStatus("");
              void save({ type: "revokeApplication", loanId, token: application.token });
            }
          }}>Revoke borrower link</Button>}
        </> : !processor && <Button size="sm" variant="outline" disabled={busy} onClick={() => run("startApplication")}>Issue replacement link</Button>}
        {!application.submittedAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("refreshApplication")}><RefreshCw /> Refresh application</Button>}
      </div>
      {copyStatus && <p role="status" className="muted">{copyStatus}</p>}
      {application.correctionNote && <p className="muted">Waiting on the borrower · {application.correctionNote}</p>}
      {!application.submittedAt ? <p className="muted timestamp">Last saved {dateTime(application.updatedAt)} ET</p> : <>
        <p className="muted">Received {dateTime(application.submittedAt)} ET</p>
        {application.draft && <details className="application-review" open={!application.reviewedAt}>
          <summary>Review submitted answers</summary>
          <ApplicationAnswers draft={application.draft} />
        </details>}
        {application.uwmReference && <p className="application-sent"><CheckCircle2 size={16} /> Mock UWM import confirmed · {application.uwmReference}</p>}
        {application.reviewedAt ? !processor && !application.uwmReference && <Button size="sm" disabled={busy} onClick={() => run("sendApplication")}><Send /> Send to UWM (mock)</Button> :
          <Button size="sm" disabled={busy} onClick={() => void save({ type: "reviewApplication", loanId, revision: application.revision })}><CheckCircle2 /> Mark reviewed</Button>}
        <details className="loan-task-create"><summary>Request borrower corrections</summary>
          <form className="record-form" onSubmit={(event) => {
            event.preventDefault();
            void save({ type: "requestApplicationCorrection", loanId, revision: application.revision, note: text(new FormData(event.currentTarget), "note") });
          }}>
            <Field label="Instructions for the borrower"><textarea name="note" rows={3} required maxLength={500} /></Field>
            <div><Button size="sm" type="submit" disabled={busy}>Request corrections</Button></div>
          </form>
        </details>
      </>}
      {application.versions.length > 0 && <details className="application-review">
        <summary>Application version history</summary>
        <ul>{application.versions.map((version, index) => <li key={version.revision}>
          Version {application.versions.length - index} · {dateTime(version.submittedAt)} ET · {version.reviewedAt ? "Reviewed" : "Submitted"}
        </li>)}</ul>
        {application.previousAnswers && <details className="application-review"><summary>Compare with previous answers</summary>
          {application.draft && <p className="muted">Changed sections · {changedApplicationSections(application.previousAnswers, application.draft).join(", ") || "No answer changes"}</p>}
          <ApplicationAnswers draft={application.previousAnswers} />
        </details>}
      </details>}
      <ManualLenderExport key={`${loanId}:${application.revision}:${application.lender?.revision ?? 0}`}
        application={application} busy={busy} save={save} />
      <LenderApplicationDetails key={`${loanId}:${application.lender?.revision ?? 0}`} application={application} busy={busy} save={save} />
    </div>}
  </section>;
}

function LenderApplicationDetails({ application, busy, save }: { application: StaffApplication; busy: boolean; save: Save }) {
  const [details, setDetails] = useState(() => application.lender?.details ?? blankLenderDetails());
  const change = (key: keyof LenderDetails): ChangeAnswers => (update) =>
    setDetails((current) => ({ ...current, [key]: update(current[key]) }));
  return <details className="application-review">
    <summary>Lender and originator details</summary>
    <p className="muted">Staff-only fields for the sample loan file.</p>
    <div className="urla-questionnaire">
      <QuestionnaireFields definition={lenderQuestions} answers={details.originator} change={change("originator")} />
      <details className="application-review">
        <summary>Property, title, mortgage terms, and cash to close</summary>
        <QuestionnaireFields definition={lenderSupplement} answers={details.supplement} change={change("supplement")} />
      </details>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save({
        type: "saveLenderDetails", loanId: application.loanId, revision: application.lender?.revision ?? 0, details,
      })}>Save lender details</Button>
    </div>
  </details>;
}

const loanSections = [
  ["Overview", "loan-workflow"], ["1003", "loan-application"], ["Conditions", "lender-submissions"],
  ["Pricing & credit", "loan-pricing"], ["Closing", "closing-workbench"], ["Activity", "loan-activity"],
] as const;

function loanSection(target?: string) {
  if (!target) return "Overview";
  if (target === "loan-application" || target === "manual-lender-export") return "1003";
  if (target.startsWith("lender-") || target.startsWith("document-")) return "Conditions";
  if (target === "credit-aus" || target === "loan-pricing") return "Pricing & credit";
  if (target === "closing-workbench" || target === "loan-call-report") return "Closing";
  if (["loan-activity", "loan-tasks", "loan-retention", "loan-communications"].includes(target)) return "Activity";
  return "Overview";
}

function LoanDetails({ loan, state, staff, busy, save, show, target }: { target?: string; loan: Loan; state: Workspace; staff: WorkspaceStaff | null; busy: boolean; save: Save; show: (modal: Modal) => void }) {
  const processor = staff?.brokerage.role === "Processor";
  const sharedProcessor = processor && loan.officerEmail !== staff.email;
  const [activityKind, setActivityKind] = useState<ActivityKind>("Note");
  const activityAttempt = useRef<{ key: string; id: string } | null>(null);
  const borrower = state.contacts.find((contact) => contact.id === loan.contactId);
  const partner = state.contacts.find((contact) => contact.id === loan.partnerId);
  const submissions = state.submissions.filter((item) => item.loanId === loan.id);
  const requests = state.documentRequests.filter((item) => item.loanId === loan.id);
  const openConditionRequests = new Set(requests.filter((request) => submissions.some((submission) =>
    submission.id === request.submissionId && submission.lender === "UWM" && submission.syncedAt &&
    submission.conditions.some((condition) => condition.id === request.conditionId && !condition.satisfiedAt))).map((request) => request.id));
  const replaceableRequests = new Set(requests.filter((request) => submissions.some((submission) =>
    submission.id === request.submissionId && submission.conditions.some((condition) => condition.id === request.conditionId && !condition.satisfiedAt)))
    .map((request) => request.id));
  const application = state.applications.find((item) => item.loanId === loan.id);
  const callReportFile = state.callReportFiles?.find((file) => file.loanId === loan.id);
  const notes = state.activity.filter((item) => item.loanId === loan.id);
  const tasks = state.tasks.filter((item) => item.loanId === loan.id);
  const savedPricing = state.pricingRuns.filter((item) => item.loanId === loan.id && item.selectedAt)
    .sort((a, b) => (b.selectedAt ?? "").localeCompare(a.selectedAt ?? ""))[0];
  const savedOffer = savedPricing?.offers.find((item) => item.id === savedPricing.selectedId);
  const rate = state.mockUwmRates.find((item) => item.loanId === loan.id);
  const section = loanSection(target);
  const action = loanNextAction(loan, state);
  const uwm = submissions.filter((item) => item.lender === "UWM");
  const uwmStatus = uwm[0]?.status ?? "Awaiting submission";
  const openCount = uwm.flatMap((item) => item.conditions).filter((item) => !item.satisfiedAt).length;
  const realtorDraft = state.communicationDrafts.find((draft) => draft.loanId === loan.id && draft.audience === "Realtor" && draft.contactId === loan.partnerId);
  const borrowerUrl = application?.submittedAt && !application.revokedAt && application.expiresAt > new Date().toISOString()
    ? `/apply#${application.token}` : undefined;
  const open = (destination: string) => show({ kind: "details", loanId: loan.id, target: destination });
  const inlineRequests = new Set(submissions.filter((item) => item.syncedAt).flatMap((item) =>
    requests.filter((request) => request.submissionId === item.id && item.conditions.some((condition) => condition.id === request.conditionId)).map((request) => request.id)));
  return (
    <div className="details-body">
      <div className="details-person"><span className="avatar avatar-large">{initials(borrower?.name ?? "?")}</span>
        <div><h3>{borrower?.name}</h3><p>{[money(loan.amount), loan.purpose, loan.address || "Address pending"].join(" · ")}</p></div>
        {!processor && <Button variant="outline" size="sm" onClick={() => show({ kind: "loan", loanId: loan.id })}><Pencil /> Edit loan</Button>}
      </div>
      <div className="loan-status-panel">
        <div className="details-grid">
          <div><span>Pipeline stage</span><strong suppressHydrationWarning>{loan.stage} · {stageDays(loan.stageSince)}d in stage</strong></div>
          <div><span>UWM · Mock</span><strong>{uwmStatus}</strong>{uwm.length > 0 && <button className="name-link" onClick={() => open("lender-submissions")}>{openCount} outstanding {openCount === 1 ? "condition" : "conditions"}</button>}</div>
          <div><span>Realtor partner</span><strong>{partner?.name ?? "Unassigned"}</strong></div>
          <div><span>Loan officer</span><strong>{loan.officer || "Unassigned"}</strong></div>
        </div>
        <div className="loan-status-action">
          <div><small>Next action</small><strong>{action.title}</strong>
            {(action.blocker || action.dueAt) && <span>{[action.blocker, action.dueAt && `Due ${dateTime(action.dueAt)} ET`].filter(Boolean).join(" · ")}</span>}
          </div>
          <Button size="sm" onClick={() => open(action.target)}>Open next action</Button>
        </div>
      </div>
      <nav className="loan-section-nav" aria-label="Loan sections">{loanSections.map(([name, destination]) =>
        <button key={name} type="button" aria-current={section === name ? "page" : undefined} onClick={() => open(destination)}>{name}</button>)}
      </nav>
      {section === "Overview" && <>
      <LoanWorkflow key={loan.dispositionRevision} loan={loan} busy={busy} readOnly={processor} save={(input) => void save(input)} />
      <ProcessingHandoff loan={loan} assignment={state.loanProcessing.find((item) => item.loanId === loan.id)}
        staff={staff} busy={busy} save={(input) => void save(input)} />
      <Field label="Pipeline stage"><select value={loan.stage} disabled={busy || processor || pausedLoan(loan)} onChange={(event) => void save({ type: "move", id: loan.id, stage: event.target.value })}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></Field>
      <FileReadiness loan={loan} state={state} busy={busy} save={save} open={open} />
      </>}
      {section === "Pricing & credit" && <>
      <section className="details-section" id="loan-pricing" tabIndex={-1} aria-label="Loan pricing">
        <div className="section-heading"><h3><Calculator size={17} /> Loan pricing</h3>
          {!processor && <Button size="sm" variant="outline" onClick={() => show({ kind: "pricing", loanId: loan.id })}>Price loan</Button>}
        </div>
        <p className="empty-inline">{savedOffer ? `${savedPricing?.mode === "mock" ? "Saved sample" : "Saved stage quote"} · ${savedOffer.product} at ${savedOffer.rate.toFixed(3)}%` : "Compare sample rate and fee options, then save a quote to the loan."}</p>
        {rate && <p className="timestamp">{mockRateStatus(rate, new Date().toISOString())} · {rate.rate.toFixed(3)}%{rate.lockCancelledAt
          ? ` · ${dateTime(rate.lockCancelledAt)} ET` : rate.lockExpiresAt && ` · Expires ${dateTime(rate.lockExpiresAt)} ET`}</p>}
      </section>
      <CreditAusWorkbench loanId={loan.id} runs={state.mockCreditAusRuns.filter((run) => run.loanId === loan.id)} busy={busy} readOnly={processor} save={save} />
      </>}
      {section === "Closing" && <>
      <ClosingWorkbench loan={loan} state={state} busy={busy} save={save}
        preview={(audience, draftId) => show({ kind: "communication", loanId: loan.id, audience, draftId })} />
      {callReportFile && <CallReportLoanFacts key={`${loan.id}:${callReportFile.revision}`} file={callReportFile} busy={busy} save={save} />}
      </>}
      {section === "1003" && <>
      <LoanApplication loanId={loan.id} state={state} busy={busy} save={save} processor={processor} />
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
        {submissions.length === 0 && <p className="empty-inline">No lender submissions yet. Review the 1003 and send it to mock UWM to start the condition checklist.</p>}
        {submissions.map((submission) => <SubmissionCard key={submission.id} submission={submission} requests={requests} busy={busy} save={save}
          borrowerUrl={borrowerUrl} brokerageId={staff?.brokerage.id ?? demoBrokerageId} pilot={staff?.brokerage.pilot}
          onEdit={() => show({ kind: "submission", loanId: loan.id, submissionId: submission.id })} />)}
      </section>
      <LoanDocuments loanId={loan.id} brokerageId={staff?.brokerage.id ?? demoBrokerageId} pilot={staff?.brokerage.pilot} requests={requests} inlineRequests={inlineRequests}
        openConditionRequests={openConditionRequests} replaceableRequests={replaceableRequests}
        applicationStarted={Boolean(application)} applicationSubmitted={Boolean(application?.submittedAt)} busy={busy} save={save}
        followUp={() => show({ kind: "documentFollowUp", loanId: loan.id })} />
      </>}
      {section === "Activity" && <>
      {realtorDraft && <section className="details-section">
        <div className="section-heading"><h3>Latest realtor update</h3><span className="pill">{realtorDraft.milestone}</span></div>
        <Button size="sm" variant="outline" onClick={() => show({ kind: "communication", loanId: loan.id, audience: "Realtor", draftId: realtorDraft.id })}>Preview latest realtor draft</Button>
      </section>}
      {!processor && <div id="loan-retention" tabIndex={-1}><LoanRetention loan={loan} profile={state.pastClients.find((profile) => profile.loanId === loan.id)} edit={() => show({ kind: "retention", loanId: loan.id })} /></div>}
      {!sharedProcessor && <section className="details-section" aria-label="Loan follow-up tasks" id="loan-tasks" tabIndex={-1}>
        <div className="section-heading"><h3><CheckCircle2 size={17} /> Follow-up tasks</h3></div>
        {tasks.length ? <ul className="loan-task-list">{tasks.map((task) =>
          <LoanTaskRow key={task.id} task={task} officer={loan.officer} busy={busy}
            onChange={() => void save({ type: "completeTask", id: task.id, completed: !task.completedAt })} />
        )}</ul> : <p className="empty-inline">A follow-up task appears when the borrower submits a 1003.</p>}
        <details className="loan-task-create"><summary>Add follow-up task</summary>
          <form className="task-form" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void save({ type: "createTask", loanId: loan.id, title: text(data, "title"), days: Number(text(data, "days")) }, () => {
              form.reset();
              form.closest("details")?.removeAttribute("open");
            });
          }}>
            <Field label="Task title"><input name="title" required maxLength={120} placeholder="e.g. Call about the quote" /></Field>
            <Field label="Due in"><select name="days"><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option></select></Field>
            <Button size="sm" type="submit" disabled={busy}><Plus /> Add task</Button>
          </form>
        </details>
      </section>}
      <LoanCommunications loan={loan} state={state} preview={(loanId, audience, draftId) => show({ kind: "communication", loanId, audience, draftId })} />
      <LoanAudit key={loan.id} loanId={loan.id} busy={busy} save={save} />
      <section className="details-section" id="loan-activity" tabIndex={-1}>
        <div className="section-heading"><h3><ClipboardList size={17} /> Activity</h3></div>
        <form className="note-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const input = { type: "note", loanId: loan.id, kind: activityKind, text: text(data, "note"),
            outcome: text(data, "outcome") || undefined, followUp: text(data, "followUp") || undefined };
          const key = JSON.stringify(input);
          if (activityAttempt.current?.key !== key) activityAttempt.current = { key, id: crypto.randomUUID() };
          void save({ ...input, eventId: activityAttempt.current.id }, () => { activityAttempt.current = null; form.reset(); });
        }}>
          <Field label="Activity type"><select value={activityKind} onChange={(event) => setActivityKind(event.target.value as ActivityKind)}>{activityKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
          <textarea name="note" aria-label="Activity note" placeholder={activityKind === "Note" ? "Write a note about this loan…" : `Summarize the ${activityKind.toLowerCase()}…`} maxLength={2000} required />
          {activityKind !== "Note" && <div className="form-grid">
            <Field label="Contact outcome"><select name="outcome"><option value="">Choose an outcome</option>{contactOutcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}</select></Field>
            <Field label="Next follow-up date"><input type="date" name="followUp" /></Field>
          </div>}
          <Button type="submit" variant="outline" size="sm" disabled={busy}>{activityKind === "Note" ? "Add note" : `Log ${activityKind.toLowerCase()}`}</Button>
        </form>
        {notes.map((note) => <div className="note" key={note.id}><div className="activity-meta"><span className="pill">{note.kind}{note.outcome && ` · ${note.outcome}`}</span><small>{dateTime(note.createdAt)} ET</small></div><p>{note.text}</p></div>)}
      </section>
      </>}
    </div>
  );
}

export function RecordDialog({ modal, state, staff, busy, error, save, show, close }: {
  modal: Modal; state: Workspace; staff: WorkspaceStaff | null; busy: boolean; error: string; save: Save; show: (modal: Modal) => void; close: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const target = "target" in modal ? modal.target : undefined;
  useEffect(() => {
    if (!target) return;
    const item = document.getElementById(target);
    item?.focus({ preventScroll: true });
    if (loanSections.some(([, destination]) => destination === target)) dialog.current?.scrollTo({ top: 0 });
    else item?.scrollIntoView({ block: "start" });
  }, [modal, target]);
  const loan = "loanId" in modal ? state.loans.find((item) => item.id === modal.loanId) : undefined;
  const contact = "contactId" in modal ? state.contacts.find((item) => item.id === modal.contactId) : undefined;
  const submission = modal.kind === "submission" ? state.submissions.find((item) => item.id === modal.submissionId) : undefined;
  const title = {
    details: "Loan details", loan: loan ? "Edit loan" : "New Lead",
    contact: contact ? "Edit contact" : "New contact", submission: submission ? "Edit lender submission" : "Add lender submission",
    communication: "Message draft",
    documentFollowUp: "Document follow-up",
    pricing: "Loan pricing",
    retention: "Past-client follow-up",
    contactHistory: "Contact history",
  }[modal.kind];
  const backTarget = modal.kind === "pricing" ? "loan-pricing" : modal.kind === "communication" ? "loan-communications" :
    modal.kind === "retention" ? "loan-retention" : modal.kind === "documentFollowUp" ? "document-checklist" :
    modal.kind === "submission" ? "lender-submissions" : undefined;
  const back = () => loan ? show({ kind: "details", loanId: loan.id, target: backTarget }) : close();
  const retention = modal.kind === "retention" ? state.pastClients.find((profile) => profile.loanId === modal.loanId) : undefined;
  const key = `${modal.kind}-${loan?.id ?? contact?.id ?? "new"}-${modal.kind === "communication" ? modal.draftId ?? modal.audience : submission?.id ?? ""}`;
  const remove = (input: unknown, question: string, after: () => void) => {
    if (window.confirm(question)) void save(input, after);
  };
  return (
    <dialog ref={dialog} className={modal.kind === "pricing" || modal.kind === "details" ? "record-dialog record-dialog-wide" : "record-dialog"} aria-labelledby="record-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="dialog-head">
        {loan && modal.kind !== "details" && <Button variant="ghost" size="icon" aria-label="Back to loan details" onClick={back}><ArrowLeft /></Button>}
        <h2 id="record-title">{title}</h2>
        <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={close}><X /></Button>
      </div>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-content" key={key}>
        {modal.kind === "details" && loan && <LoanDetails loan={loan} state={state} staff={staff} busy={busy} save={save} show={show} target={target} />}
        {modal.kind === "communication" && loan && <CommunicationPreview loan={loan} state={state} audience={modal.audience} draftId={modal.draftId} busy={busy} save={save} />}
        {modal.kind === "documentFollowUp" && loan && <DocumentFollowUp loan={loan} state={state} />}
        {modal.kind === "pricing" && loan && <LoanPricing loan={loan} state={state} busy={busy} save={save} />}
        {modal.kind === "retention" && loan && <Form busy={busy} onCancel={back} done={(input) => void save(input, back)}
          save={(data) => ({
            type: "saveRetention", loanId: loan.id, revision: retention?.revision ?? 0, closingDate: text(data, "closingDate"),
            currentRate: text(data, "currentRate"), targetRate: text(data, "targetRate"), observedRate: text(data, "observedRate"),
            watchEnabled: data.has("watchEnabled"), note: text(data, "note"),
          })}><RetentionFields profile={retention} /></Form>}
        {modal.kind === "loan" && <Form busy={busy} onCancel={back} newLead={!loan} done={(input) => void save(input, (result) => {
          const application = result.state.applications.find((item) => item.loanId === result.applicationLoanId);
          if (application) router.push(`/apply#${application.token}`);
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
        {modal.kind === "contactHistory" && contact && <ContactHistory contact={contact} state={state}
          open={(loanId) => show({ kind: "details", loanId })}
          repeat={staff?.brokerage.role !== "Processor" && contact.role !== "Realtor" ? () => show({ kind: "loan", contactId: contact.id }) : undefined} />}
        {modal.kind === "contact" && <Form busy={busy} onCancel={close} done={(input) => void save(input, close)}
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
