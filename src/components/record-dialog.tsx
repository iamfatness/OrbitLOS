"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Calculator, CheckCircle2, Circle, ClipboardList, Clock3, Copy, ExternalLink, Pencil, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import { activityKinds, stages, type ActivityKind, type Contact, type DraftAudience, type Loan, type Stage, type Submission, type Workspace } from "@/lib/model";
import { dateTime, initials, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { ApplicationAnswers } from "./application-fields";
import { LoanTaskRow } from "./loan-task";
import { LoanPricing } from "./loan-pricing";
import { CommunicationPreview, LoanCommunications } from "./loan-communications";
import type { StaffIdentity } from "@/lib/staff-store";
import { blankLenderDetails, lenderQuestions, lenderSupplement, type LenderDetails } from "@/lib/urla";
import type { StaffApplication } from "@/lib/application-model";
import { QuestionnaireFields, type ChangeAnswers } from "./urla-fields";
import { LoanRetention, RetentionFields } from "./past-client-crm";
import { DocumentRequestForm, LoanDocuments } from "./loan-documents";
import { DocumentFollowUp } from "./document-follow-up";
import { DocumentStatusPill } from "./sample-document";
import type { LoanDocumentRequest } from "@/lib/document-model";
import { mockRateStatus } from "@/lib/pricing-model";

export type Modal =
  | { kind: "details"; loanId: string; target?: string }
  | { kind: "loan"; loanId?: string; stage?: Stage }
  | { kind: "contact"; contactId?: string }
  | { kind: "communication"; loanId: string; audience: DraftAudience; draftId?: string }
  | { kind: "documentFollowUp"; loanId: string }
  | { kind: "pricing"; loanId: string; target?: string }
  | { kind: "retention"; loanId: string }
  | { kind: "submission"; loanId: string; submissionId?: string };

type Save = (input: unknown, after?: () => void) => Promise<void>;

function text(data: FormData, name: string) {
  return String(data.get(name) ?? "");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Form({ children, save, busy, done, onCancel, remove }: {
  children: ReactNode; save: (data: FormData) => unknown; busy: boolean;
  done: (input: unknown) => void; onCancel: () => void; remove?: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    done(save(new FormData(event.currentTarget)));
  }
  return (
    <form className="record-form" onSubmit={submit}>
      {children}
      <div className="dialog-footer">
        {remove && <Button variant="danger" onClick={remove} disabled={busy}><Trash2 /> Delete</Button>}
        <div className="spacer" />
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}

function LoanFields({ loan, state, stage, staff }: { loan?: Loan; state: Workspace; stage?: Stage; staff: StaffIdentity | null }) {
  const [contactId, setContactId] = useState(loan?.contactId ?? "");
  const [assignToSelf, setAssignToSelf] = useState(Boolean(staff && (!loan || loan.officerEmail === staff.email)));
  const [manualOfficer, setManualOfficer] = useState(loan?.officer ?? (staff ? "" : "Alex Morgan"));
  const borrowerLocked = loan && state.applications.some((application) => application.loanId === loan.id);
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
      <Field label="Property address"><input name="address" defaultValue={loan?.address} placeholder="City, state or street address" maxLength={240} /></Field>
      <div className="form-grid">
        <Field label="Loan amount"><input name="amount" type="number" min="0" max="1000000000" step="1" placeholder="0" defaultValue={loan?.amount || ""} /></Field>
        <Field label="Loan purpose"><select name="purpose" defaultValue={loan?.purpose ?? "Purchase"}><option>Purchase</option><option>Refinance</option></select></Field>
        <Field label="Pipeline stage"><select name="stage" defaultValue={loan?.stage ?? stage ?? "Lead"}>{stages.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Loan officer"><input name="officer" list="loan-officers" maxLength={160} placeholder="Unassigned"
          readOnly={assignToSelf} value={assignToSelf ? staff?.name.slice(0, 160) ?? "" : manualOfficer} onChange={(event) => setManualOfficer(event.target.value)} /></Field>
      </div>
      {staff && <label className="demo-confirm"><input type="checkbox" name="assignToSelf" checked={assignToSelf} onChange={(event) => setAssignToSelf(event.target.checked)} />
        Assign to my account ({staff.email})</label>}
      <datalist id="loan-officers">{[...new Set(state.loans.map((item) => item.officer).filter(Boolean))].sort().map((officer) => <option key={officer} value={officer} />)}</datalist>
      <Field label="Realtor partner">
        <select name="partnerId" defaultValue={loan?.partnerId ?? ""}>
          <option value="">No realtor linked</option>
          {state.contacts.filter((contact) => contact.role === "Realtor").map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
        </select>
      </Field>
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

function SubmissionCard({ submission, requests, busy, save, onEdit }: {
  submission: Submission; requests: LoanDocumentRequest[]; busy: boolean; save: Save; onEdit: () => void;
}) {
  const open = submission.conditions.filter((item) => !item.satisfiedAt);
  const cleared = submission.conditions.filter((item) => item.satisfiedAt);
  return (
    <article className="submission">
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
          return <div className="condition" key={item.id}>
            {item.satisfiedAt ? <CheckCircle2 size={16} className="text-emerald-700" /> : <Circle size={16} className="text-amber-600" />}
            <div><strong>{item.category}{item.group && ` · ${item.group}`}</strong><p>{item.description}</p>
              <small>{submission.lender === "UWM" && "UWM · "}{item.satisfiedAt ? `Cleared ${dateTime(item.satisfiedAt)} ET` : item.uploaded ? "Document uploaded" : "Outstanding"}</small>
              {request ? <div className="condition-checklist">
                <a href={`#document-${request.id}`}>View checklist request</a><DocumentStatusPill status={request.status} />
                {request.uwmReceipt && <span className="pill">Sent to UWM · Mock</span>}
              </div> : submission.lender === "UWM" && !item.satisfiedAt && <div className="condition-checklist">
                <DocumentRequestForm loanId={submission.loanId} source={{ submissionId: submission.id, condition: item }} busy={busy} save={save} />
              </div>}
            </div>
          </div>;
        })}
      </>}
    </article>
  );
}

function LoanApplication({ loanId, state, busy, save }: { loanId: string; state: Workspace; busy: boolean; save: Save }) {
  const [copyStatus, setCopyStatus] = useState("");
  const application = state.applications.find((item) => item.loanId === loanId);
  const path = application ? `/apply#${application.token}` : "";
  const status = application?.uwmReference ? "Sent to UWM · Mock" : application?.reviewedAt ? "Reviewed" : application?.submittedAt ? "Needs review" : "Draft";
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
      <Button size="sm" disabled={busy} onClick={() => run("startApplication")}><Plus /> Start 1003</Button>
    </div> : <div className="loan-application-box">
      <p className="muted">{application.submittedAt ? "The borrower can use this link to check their loan status and attach sample documents." : "The borrower can save a draft and return to the same link."} Link expires {dateTime(application.expiresAt)} ET.</p>
      <div className="loan-application-actions">
        <Button asChild size="sm" variant="outline"><a href={path} target="_blank" rel="noopener noreferrer"><ExternalLink /> {application.submittedAt ? "Open borrower status" : "Open borrower view"}</a></Button>
        <Button size="sm" variant="outline" onClick={() => void copy()}><Copy /> Copy link</Button>
        {!application.submittedAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("refreshApplication")}><RefreshCw /> Refresh application</Button>}
      </div>
      <details className="application-link-help">
        <summary>Expired link?</summary>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("startApplication")}>Renew expired link</Button>
      </details>
      {copyStatus && <p role="status" className="muted">{copyStatus}</p>}
      {!application.submittedAt ? <p className="muted timestamp">Last saved {dateTime(application.updatedAt)} ET</p> : <>
        <p className="muted">Received {dateTime(application.submittedAt)} ET</p>
        {application.draft && <details className="application-review" open={!application.reviewedAt}>
          <summary>Review submitted answers</summary>
          <ApplicationAnswers draft={application.draft} />
        </details>}
        {application.uwmReference ? <p className="application-sent"><CheckCircle2 size={16} /> Mock UWM import confirmed · {application.uwmReference}</p> :
          application.reviewedAt ? <Button size="sm" disabled={busy} onClick={() => run("sendApplication")}><Send /> Send to UWM (mock)</Button> :
            <Button size="sm" disabled={busy} onClick={() => run("reviewApplication")}><CheckCircle2 /> Mark reviewed</Button>}
      </>}
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

function LoanDetails({ loan, state, busy, save, show }: { loan: Loan; state: Workspace; busy: boolean; save: Save; show: (modal: Modal) => void }) {
  const [activityKind, setActivityKind] = useState<ActivityKind>("Note");
  const borrower = state.contacts.find((contact) => contact.id === loan.contactId);
  const partner = state.contacts.find((contact) => contact.id === loan.partnerId);
  const submissions = state.submissions.filter((item) => item.loanId === loan.id);
  const requests = state.documentRequests.filter((item) => item.loanId === loan.id);
  const openConditionRequests = new Set(requests.filter((request) => submissions.some((submission) =>
    submission.id === request.submissionId && submission.lender === "UWM" && submission.syncedAt &&
    submission.conditions.some((condition) => condition.id === request.conditionId && !condition.satisfiedAt))).map((request) => request.id));
  const application = state.applications.find((item) => item.loanId === loan.id);
  const notes = state.activity.filter((item) => item.loanId === loan.id);
  const tasks = state.tasks.filter((item) => item.loanId === loan.id);
  const savedPricing = state.pricingRuns.filter((item) => item.loanId === loan.id && item.selectedAt)
    .sort((a, b) => (b.selectedAt ?? "").localeCompare(a.selectedAt ?? ""))[0];
  const savedOffer = savedPricing?.offers.find((item) => item.id === savedPricing.selectedId);
  const rate = state.mockUwmRates.find((item) => item.loanId === loan.id);
  return (
    <div className="details-body">
      <div className="details-person"><span className="avatar avatar-large">{initials(borrower?.name ?? "?")}</span>
        <div><h3>{borrower?.name}</h3><p>{loan.address || "Property address pending"}</p></div>
        <Button variant="outline" size="sm" onClick={() => show({ kind: "loan", loanId: loan.id })}><Pencil /> Edit loan</Button>
      </div>
      <div className="details-grid">
        <div><span>Loan amount</span><strong>{money(loan.amount)}</strong></div>
        <div><span>Purpose</span><strong>{loan.purpose}</strong></div>
        <div><span>Loan officer</span><strong>{loan.officer || "Unassigned"}</strong></div>
        <div><span>Realtor</span><strong>{partner?.name ?? "Unassigned"}</strong></div>
      </div>
      <Field label="Pipeline stage"><select value={loan.stage} disabled={busy} onChange={(event) => void save({ type: "move", id: loan.id, stage: event.target.value })}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></Field>
      <section className="details-section" aria-label="Loan pricing">
        <div className="section-heading"><h3><Calculator size={17} /> Loan pricing</h3>
          <Button size="sm" variant="outline" onClick={() => show({ kind: "pricing", loanId: loan.id })}>Price loan</Button>
        </div>
        <p className="empty-inline">{savedOffer ? `${savedPricing?.mode === "mock" ? "Saved sample" : "Saved stage quote"} · ${savedOffer.product} at ${savedOffer.rate.toFixed(3)}%` : "Compare UWM Easy Qualifier options and save a quote on the loan."}</p>
        {rate && <p className="timestamp">{mockRateStatus(rate, new Date().toISOString())} · {rate.rate.toFixed(3)}%{rate.lockCancelledAt
          ? ` · ${dateTime(rate.lockCancelledAt)} ET` : rate.lockExpiresAt && ` · Expires ${dateTime(rate.lockExpiresAt)} ET`}</p>}
      </section>
      <LoanDocuments loanId={loan.id} requests={requests} openConditionRequests={openConditionRequests}
        applicationStarted={Boolean(application)} applicationSubmitted={Boolean(application?.submittedAt)} busy={busy} save={save}
        followUp={() => show({ kind: "documentFollowUp", loanId: loan.id })} />
      <LoanApplication loanId={loan.id} state={state} busy={busy} save={save} />
      <LoanRetention loan={loan} profile={state.pastClients.find((profile) => profile.loanId === loan.id)} edit={() => show({ kind: "retention", loanId: loan.id })} />
      <section className="details-section" aria-label="Loan follow-up tasks">
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
      </section>
      <LoanCommunications loan={loan} state={state} preview={(loanId, audience, draftId) => show({ kind: "communication", loanId, audience, draftId })} />
      <section className="details-section">
        <div className="section-heading"><h3>Lender submissions</h3><Button variant="outline" size="sm" onClick={() => show({ kind: "submission", loanId: loan.id })}><Plus /> Add lender</Button></div>
        {submissions.length === 0 && <p className="empty-inline">No lender submissions yet.</p>}
        {submissions.map((submission) => <SubmissionCard key={submission.id} submission={submission} requests={requests} busy={busy} save={save}
          onEdit={() => show({ kind: "submission", loanId: loan.id, submissionId: submission.id })} />)}
      </section>
      <section className="details-section">
        <div className="section-heading"><h3><ClipboardList size={17} /> Activity</h3></div>
        <form className="note-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void save({ type: "note", loanId: loan.id, kind: activityKind, text: text(new FormData(form), "note") }, () => form.reset());
        }}>
          <Field label="Activity type"><select value={activityKind} onChange={(event) => setActivityKind(event.target.value as ActivityKind)}>{activityKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
          <textarea name="note" aria-label="Activity note" placeholder={activityKind === "Note" ? "Write a note about this loan…" : `Summarize the ${activityKind.toLowerCase()}…`} maxLength={2000} required />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>{activityKind === "Note" ? "Add note" : `Log ${activityKind.toLowerCase()}`}</Button>
        </form>
        {notes.map((note) => <div className="note" key={note.id}><div className="activity-meta"><span className="pill">{note.kind}</span><small>{dateTime(note.createdAt)} ET</small></div><p>{note.text}</p></div>)}
      </section>
    </div>
  );
}

export function RecordDialog({ modal, state, staff, busy, error, save, show, close }: {
  modal: Modal; state: Workspace; staff: StaffIdentity | null; busy: boolean; error: string; save: Save; show: (modal: Modal) => void; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const target = "target" in modal ? modal.target : undefined;
  useEffect(() => {
    if (!target) return;
    const item = document.getElementById(target);
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: "start" });
  }, [target]);
  const loan = "loanId" in modal ? state.loans.find((item) => item.id === modal.loanId) : undefined;
  const contact = modal.kind === "contact" ? state.contacts.find((item) => item.id === modal.contactId) : undefined;
  const submission = modal.kind === "submission" ? state.submissions.find((item) => item.id === modal.submissionId) : undefined;
  const title = {
    details: "Loan details", loan: loan ? "Edit loan" : "New loan",
    contact: contact ? "Edit contact" : "New contact", submission: submission ? "Edit lender submission" : "Add lender submission",
    communication: "Message draft",
    documentFollowUp: "Document follow-up",
    pricing: "Loan pricing",
    retention: "Past-client follow-up",
  }[modal.kind];
  const back = () => loan ? show({ kind: "details", loanId: loan.id }) : close();
  const retention = modal.kind === "retention" ? state.pastClients.find((profile) => profile.loanId === modal.loanId) : undefined;
  const key = `${modal.kind}-${loan?.id ?? contact?.id ?? "new"}-${modal.kind === "communication" ? modal.draftId ?? modal.audience : submission?.id ?? ""}`;
  const remove = (input: unknown, question: string, after: () => void) => {
    if (window.confirm(question)) void save(input, after);
  };
  return (
    <dialog ref={dialog} className={modal.kind === "pricing" ? "record-dialog record-dialog-wide" : "record-dialog"} aria-labelledby="record-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="dialog-head">
        {loan && modal.kind !== "details" && <Button variant="ghost" size="icon" aria-label="Back to loan details" onClick={back}><ArrowLeft /></Button>}
        <h2 id="record-title">{title}</h2>
        <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={close}><X /></Button>
      </div>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-content" key={key}>
        {modal.kind === "details" && loan && <LoanDetails loan={loan} state={state} busy={busy} save={save} show={show} />}
        {modal.kind === "communication" && loan && <CommunicationPreview loan={loan} state={state} audience={modal.audience} draftId={modal.draftId} busy={busy} save={save} />}
        {modal.kind === "documentFollowUp" && loan && <DocumentFollowUp loan={loan} state={state} />}
        {modal.kind === "pricing" && loan && <LoanPricing loan={loan} state={state} busy={busy} save={save} />}
        {modal.kind === "retention" && loan && <Form busy={busy} onCancel={back} done={(input) => void save(input, back)}
          save={(data) => ({
            type: "saveRetention", loanId: loan.id, revision: retention?.revision ?? 0, closingDate: text(data, "closingDate"),
            currentRate: text(data, "currentRate"), targetRate: text(data, "targetRate"), observedRate: text(data, "observedRate"),
            watchEnabled: data.has("watchEnabled"), note: text(data, "note"),
          })}><RetentionFields profile={retention} /></Form>}
        {modal.kind === "loan" && <Form busy={busy} onCancel={back} done={(input) => void save(input, back)}
          remove={loan ? () => remove({ type: "deleteLoan", id: loan.id }, "Delete this loan, its application, document requests, tasks, submissions and activity?", close) : undefined}
          save={(data) => ({
            type: "loan", id: loan?.id, contactId: text(data, "contactId"), borrower: text(data, "borrower"),
            address: text(data, "address"), amount: Number(text(data, "amount")), purpose: text(data, "purpose"),
            stage: text(data, "stage"), officer: text(data, "officer"), partnerId: text(data, "partnerId") || null,
            assignToSelf: staff ? data.has("assignToSelf") : undefined,
          })}>
          <LoanFields loan={loan} state={state} stage={modal.stage} staff={staff} />
        </Form>}
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
