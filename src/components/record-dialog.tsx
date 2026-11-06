"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Circle, ClipboardList, Clock3, Pencil, Plus, Trash2, X } from "lucide-react";
import { stages, type Contact, type Loan, type Stage, type Submission, type Workspace } from "@/lib/model";
import { dateTime, initials, money } from "@/lib/utils";
import { Button } from "./ui/button";

export type Modal =
  | { kind: "details"; loanId: string }
  | { kind: "loan"; loanId?: string; stage?: Stage }
  | { kind: "contact"; contactId?: string }
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

function LoanFields({ loan, state, stage }: { loan?: Loan; state: Workspace; stage?: Stage }) {
  const [contactId, setContactId] = useState(loan?.contactId ?? "");
  return (
    <>
      <Field label="Borrower contact">
        <select name="contactId" value={contactId} onChange={(event) => setContactId(event.target.value)}>
          <option value="">Create a borrower</option>
          {state.contacts.filter((contact) => contact.role !== "Realtor").map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
        </select>
      </Field>
      {!contactId && <Field label="Borrower name"><input name="borrower" placeholder="e.g. Riley Smith" maxLength={160} required /></Field>}
      <Field label="Property address"><input name="address" defaultValue={loan?.address} placeholder="City, state or street address" maxLength={240} /></Field>
      <div className="form-grid">
        <Field label="Loan amount"><input name="amount" type="number" min="0" max="1000000000" step="1" placeholder="0" defaultValue={loan?.amount || ""} /></Field>
        <Field label="Loan purpose"><select name="purpose" defaultValue={loan?.purpose ?? "Purchase"}><option>Purchase</option><option>Refinance</option></select></Field>
        <Field label="Pipeline stage"><select name="stage" defaultValue={loan?.stage ?? stage ?? "Lead"}>{stages.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Loan officer"><input name="officer" list="loan-officers" maxLength={160} placeholder="Unassigned" defaultValue={loan ? loan.officer : "Alex Morgan"} /></Field>
      </div>
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

function SubmissionCard({ submission, onEdit }: { submission: Submission; onEdit: () => void }) {
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
        {[...open, ...cleared].map((item) => (
          <div className="condition" key={item.id}>
            {item.satisfiedAt ? <CheckCircle2 size={16} className="text-emerald-700" /> : <Circle size={16} className="text-amber-600" />}
            <div><strong>{item.category}{item.group && ` · ${item.group}`}</strong><p>{item.description}</p>
              <small>{item.satisfiedAt ? `Cleared ${dateTime(item.satisfiedAt)} ET` : item.uploaded ? "Document uploaded" : "Outstanding"}</small>
            </div>
          </div>
        ))}
      </>}
    </article>
  );
}

function LoanDetails({ loan, state, busy, save, show }: { loan: Loan; state: Workspace; busy: boolean; save: Save; show: (modal: Modal) => void }) {
  const borrower = state.contacts.find((contact) => contact.id === loan.contactId);
  const partner = state.contacts.find((contact) => contact.id === loan.partnerId);
  const submissions = state.submissions.filter((item) => item.loanId === loan.id);
  const notes = state.activity.filter((item) => item.loanId === loan.id);
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
      <Field label="CRM stage"><select value={loan.stage} disabled={busy} onChange={(event) => void save({ type: "move", id: loan.id, stage: event.target.value })}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></Field>
      <section className="details-section">
        <div className="section-heading"><h3>Lender submissions</h3><Button variant="outline" size="sm" onClick={() => show({ kind: "submission", loanId: loan.id })}><Plus /> Add lender</Button></div>
        {submissions.length === 0 && <p className="empty-inline">No lender submissions yet.</p>}
        {submissions.map((submission) => <SubmissionCard key={submission.id} submission={submission} onEdit={() => show({ kind: "submission", loanId: loan.id, submissionId: submission.id })} />)}
      </section>
      <section className="details-section">
        <div className="section-heading"><h3><ClipboardList size={17} /> Activity</h3></div>
        <form className="note-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void save({ type: "note", loanId: loan.id, text: text(new FormData(form), "note") }, () => form.reset());
        }}>
          <textarea name="note" aria-label="Activity note" placeholder="Write a note about this loan…" maxLength={2000} required />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>Add note</Button>
        </form>
        {notes.map((note) => <div className="note" key={note.id}><small>{dateTime(note.createdAt)} ET</small><p>{note.text}</p></div>)}
      </section>
    </div>
  );
}

export function RecordDialog({ modal, state, busy, error, save, show, close }: {
  modal: Modal; state: Workspace; busy: boolean; error: string; save: Save; show: (modal: Modal) => void; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const loan = "loanId" in modal ? state.loans.find((item) => item.id === modal.loanId) : undefined;
  const contact = modal.kind === "contact" ? state.contacts.find((item) => item.id === modal.contactId) : undefined;
  const submission = modal.kind === "submission" ? state.submissions.find((item) => item.id === modal.submissionId) : undefined;
  const title = {
    details: "Loan details", loan: loan ? "Edit loan" : "New loan",
    contact: contact ? "Edit contact" : "New contact", submission: submission ? "Edit lender submission" : "Add lender submission",
  }[modal.kind];
  const back = () => loan ? show({ kind: "details", loanId: loan.id }) : close();
  const key = `${modal.kind}-${loan?.id ?? contact?.id ?? "new"}-${submission?.id ?? ""}`;
  const remove = (input: unknown, question: string, after: () => void) => {
    if (window.confirm(question)) void save(input, after);
  };
  return (
    <dialog ref={dialog} className="record-dialog" aria-labelledby="record-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="dialog-head">
        {loan && modal.kind !== "details" && <Button variant="ghost" size="icon" aria-label="Back to loan details" onClick={back}><ArrowLeft /></Button>}
        <h2 id="record-title">{title}</h2>
        <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={close}><X /></Button>
      </div>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-content" key={key}>
        {modal.kind === "details" && loan && <LoanDetails loan={loan} state={state} busy={busy} save={save} show={show} />}
        {modal.kind === "loan" && <Form busy={busy} onCancel={back} done={(input) => void save(input, back)}
          remove={loan ? () => remove({ type: "deleteLoan", id: loan.id }, "Delete this loan, its submissions and activity?", close) : undefined}
          save={(data) => ({
            type: "loan", id: loan?.id, contactId: text(data, "contactId"), borrower: text(data, "borrower"),
            address: text(data, "address"), amount: Number(text(data, "amount")), purpose: text(data, "purpose"),
            stage: text(data, "stage"), officer: text(data, "officer"), partnerId: text(data, "partnerId") || null,
          })}>
          <LoanFields loan={loan} state={state} stage={modal.stage} />
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
