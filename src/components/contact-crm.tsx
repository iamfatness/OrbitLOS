"use client";

import { useRef, useState } from "react";
import { readContactsWork } from "@/app/actions";
import type { BrokerageMember } from "@/lib/brokerage-model";
import { contactUnavailable, type ContactRecord } from "@/lib/contact-directory-model";
import { parseContactCsv, type ContactImportRow } from "@/lib/contact-csv";
import { activityKinds, contactOutcomes, followUpOutcomes, prospectingBlocked, type ActivityKind, type Contact, type ContactActivity, type Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { earliestCallbackDate, easternDate } from "@/lib/client-retention";
import { Button } from "./ui/button";
import { FollowUpPurposeField } from "./loan-task";
import { ActivityPages } from "./activity-pages";

export function ContactImport({ brokerageId, busy, save }: {
  brokerageId: string; busy: boolean; save: (input: unknown, after?: () => void) => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ id: string; rows: ContactImportRow[]; duplicates: boolean[] }>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState<"preview" | "export">();

  async function download() {
    setReading("export");
    setError("");
    try {
      const result = await readContactsWork({ type: "exportCsv" }, brokerageId);
      if ("error" in result) { setError(result.error); return; }
      if (result.kind !== "exportCsv") throw new Error();
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "orbit-contacts.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not export contacts. Try again.");
    } finally {
      setReading(undefined);
    }
  }

  async function previewFile(file: File) {
    setError("");
    setPreview(undefined);
    setReading("preview");
    try {
      if (file.size > 200_000) throw new Error("Choose a smaller CSV file.");
      const rows = parseContactCsv(await file.text());
      const result = await readContactsWork({ type: "previewCsv", rows }, brokerageId)
        .catch(() => ({ error: "Could not check the CSV for duplicates. Try again." }));
      if ("error" in result) { setError(result.error); return; }
      if (result.kind !== "previewCsv") throw new Error("Could not check the CSV for duplicates. Try again.");
      setPreview({ id: crypto.randomUUID(), rows, duplicates: result.duplicates });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This CSV could not be read.");
    } finally {
      setReading(undefined);
    }
  }

  return <div className="work-queue">
    <div className="section-heading"><h3>Contact import and export</h3>
      <Button size="sm" variant="outline" disabled={busy || !!reading} onClick={() => void download()}>
        {reading === "export" ? "Preparing export…" : "Export accessible contacts"}
      </Button>
    </div>
    <label className="field">Preview contacts CSV<input type="file" accept=".csv,text/csv" disabled={busy || !!reading} onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void previewFile(file);
    }} /></label>
    <p className="muted">Use the columns name, email, phone, and role. Roles are Borrower, Co-borrower, and Realtor. Import fictional contacts in a pilot.</p>
    {reading === "preview" && <p role="status">Checking contacts for duplicates…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <><p className="muted">Possible duplicates are skipped unless you mark them as separate contacts. Orbit checks again when saving.</p>
      <ul className="loan-task-list">{preview.rows.map((row, index) => {
        return <li className="loan-task" key={index}><div className="loan-task-copy"><strong>{row.name}</strong>
          <span>{row.role} · {row.email || row.phone || "No contact method"}</span></div>
          {preview.duplicates[index] && <label><input type="checkbox" disabled={busy} checked={!!row.separate} onChange={(event) => {
            const separate = event.target.checked;
            setPreview({ ...preview, id: crypto.randomUUID(), rows: preview.rows.map((item, i) => i === index ? { ...item, separate } : item) });
          }} /> Import as separate contact</label>}</li>;
      })}</ul>
      <Button size="sm" disabled={busy || !!reading} onClick={() => void save({ type: "importContacts", batchId: preview.id, rows: preview.rows }, () => setPreview(undefined))}>Import reviewed contacts</Button>
    </>}
  </div>;
}

export function ContactFollowUpAssignment({ item, members, busy, save }: {
  item: ContactActivity; members: BrokerageMember[]; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const available = members.filter((member) => member.email !== item.followUpOwnerEmail);
  if (!available.length) return null;
  return <details className="loan-task-create">
    <summary>Reassign follow-up</summary>
    <form className="record-form" key={item.revision} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void save({ type: "assignContactFollowUp", contactId: item.contactId, eventId: item.id, revision: item.revision, email: data.get("assignee") });
    }}>
      <label className="field">Assign to<select name="assignee" required defaultValue="">
        <option value="" disabled>Choose a team member</option>
        {available.map((member) => <option key={member.email} value={member.email}>{member.name || member.email} · {member.role}</option>)}
      </select></label>
      <div><Button size="sm" variant="outline" type="submit" disabled={busy}>Assign follow-up</Button></div>
    </form>
  </details>;
}

export function ContactFollowUpCompletion({ item, busy, save }: {
  item: Pick<ContactActivity, "id" | "contactId" | "revision">; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  return <details className="loan-task-create">
    <summary>Complete follow-up</summary>
    <form className="record-form" key={item.revision} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void save({ type: "completeContactFollowUp", contactId: item.contactId, eventId: item.id, revision: item.revision,
        completed: true, resolution: { outcome: data.get("outcome"), note: data.get("note") } });
    }}>
      <label className="field">Follow-up outcome<select name="outcome" required defaultValue="">
        <option value="" disabled>Choose an outcome</option>
        {followUpOutcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}
      </select></label>
      <label className="field">Outcome note (optional)<textarea name="note" maxLength={500} rows={2} /></label>
      <div><Button size="sm" type="submit" disabled={busy}>Save outcome and complete</Button></div>
    </form>
  </details>;
}

export function BorrowerCallbackReschedule({ item, busy, save }: {
  item: Pick<ContactActivity, "id" | "contactId" | "revision" | "dueAt" | "completedAt" | "outcome" | "postFundingCheckIn">;
  busy: boolean; save: (input: unknown, after?: () => void) => Promise<void>;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  if (!item.postFundingCheckIn || item.outcome !== "Requested callback" || !item.dueAt || item.completedAt) return null;
  return <details className="loan-task-create" ref={details}>
    <summary>Reschedule callback</summary>
    <form className="record-form" key={item.revision} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void save({ type: "rescheduleBorrowerCallback", contactId: item.contactId, eventId: item.id, revision: item.revision,
        date: data.get("date"), reason: data.get("reason") }, () => { if (details.current) details.current.open = false; });
    }}>
      <label className="field">New callback date<input name="date" type="date" min={earliestCallbackDate()} required /></label>
      <label className="field">Reason for rescheduling<textarea name="reason" maxLength={500} rows={2} required /></label>
      <div><Button size="sm" variant="outline" type="submit" disabled={busy}>Save callback date</Button></div>
    </form>
  </details>;
}

export function ContactFollowUpResult({ completion, current, showNote = false }: {
  completion: ContactActivity["latestCompletion"]; current: boolean; showNote?: boolean;
}) {
  if (!completion) return null;
  return <div className="muted">
    <p>{current ? "Completion" : "Previous completion"} · {completion.outcome || "Marked complete"} · {completion.actor}
      {showNote && ` · ${dateTime(completion.at)} ET`}</p>
    {showNote && completion.note && <p>{completion.note}</p>}
  </div>;
}

export function FundingCheckInForm({ loanId, borrower, fundingRevision, busy, save, close, startRepeat }: {
  loanId: string; borrower?: Contact; fundingRevision: number; busy: boolean;
  save: (input: unknown, after?: () => void) => Promise<void>; close: () => void; startRepeat?: () => void;
}) {
  const [outcome, setOutcome] = useState("");
  const attempt = useRef<{ fields: string; id: string } | null>(null);
  return <form className="record-form funding-check-in" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    const input = { type: "recordFundingCheckIn", loanId, fundingRevision, kind: form.get("kind"), outcome,
      note: form.get("note"), followUp: form.get("followUp") || null, purpose: form.get("purpose") };
    const fields = JSON.stringify(input);
    if (attempt.current?.fields !== fields) attempt.current = { fields, id: crypto.randomUUID() };
    void save({ ...input, eventId: attempt.current.id }, form.has("startRepeat") && startRepeat ? startRepeat : close);
  }}>
    <p><strong>{borrower?.name ?? "Borrower"}</strong></p>
    <div className="form-grid">
      <label className="field">Contact method<select name="kind" id="funding-check-in-channel" defaultValue="Call">
        {activityKinds.filter((kind) => kind !== "Note").map((kind) => <option key={kind}>{kind}</option>)}
      </select></label>
      <label className="field">Check-in outcome<select name="outcome" required value={outcome} onChange={(event) => setOutcome(event.target.value)}>
        <option value="" disabled>Choose an outcome</option>
        {contactOutcomes.map((item) => <option key={item}>{item}</option>)}
      </select></label>
    </div>
    <label className="field">Check-in note (optional)<textarea name="note" rows={2} maxLength={500} /></label>
    <div className="form-grid">
      <FollowUpPurposeField optedOut={borrower?.outreachSuppressed} />
      <label className="field">{outcome === "Requested callback" ? "Next follow-up date" : "Next follow-up date (optional)"}
        <input type="date" name="followUp" min={easternDate()} required={outcome === "Requested callback"} /></label>
    </div>
    <div className="dialog-footer"><div className="spacer" />
      <Button variant="outline" onClick={close}>Cancel</Button>
      <Button type="submit" disabled={busy}>Save check-in</Button>
      {startRepeat && (outcome === "Connected" || outcome === "Requested callback") &&
        <Button type="submit" name="startRepeat" value="yes" variant="outline" disabled={busy}>Save &amp; start repeat 1003</Button>}
    </div>
  </form>;
}

export function ContactHistory({ contact, state, brokerageId, open, openLead, openThread, repeat, conversation, reviewDuplicates, optOut, busy, save, assignedOnly, linkedLoans }: {
  contact: Contact; state: Workspace; open: (loanId: string) => void; openLead: (leadId: string) => void; repeat?: () => void;
  conversation?: () => void; optOut?: () => void; busy: boolean; save?: (input: unknown, after?: () => void) => Promise<void>; assignedOnly?: boolean; brokerageId: string;
  openThread: (id: string) => void;
  reviewDuplicates?: () => void;
  linkedLoans?: ContactRecord;
}) {
  const [kind, setKind] = useState<ActivityKind>("Note");
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  const [extraLoans, setExtraLoans] = useState<{ base: ContactRecord; page: ContactRecord }>();
  const [moreError, setMoreError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const current = extraLoans?.base === linkedLoans ? extraLoans?.page ?? linkedLoans : linkedLoans;
  const loans = current?.loans ?? (assignedOnly ? [] : state.loans.filter((loan) => loan.contactId === contact.id || loan.partnerId === contact.id));
  async function loadMoreLoans() {
    if (!linkedLoans || !current?.nextLoan || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const result = await readContactsWork({ type: "open", id: contact.id, after: current.nextLoan }, brokerageId);
      if ("error" in result || result.kind !== "contact" || result.contact.id !== contact.id) throw new Error(contactUnavailable);
      const rows = new Map(current.loans.map((loan) => [loan.id, loan]));
      for (const loan of result.loans) rows.set(loan.id, loan);
      setExtraLoans({ base: linkedLoans, page: { ...result, loans: [...rows.values()] } });
    } catch {
      setMoreError("Could not load more linked loans. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }
  return <section className="details-section" aria-label="Contact history">
    <div className="section-heading"><h3>{contact.name}</h3><div className="loan-application-actions">
      {conversation && <Button size="sm" variant="outline" onClick={conversation}>Open contact conversation</Button>}
      {reviewDuplicates && <Button size="sm" variant="outline" onClick={reviewDuplicates}>Review duplicates</Button>}
      {repeat && <Button size="sm" onClick={repeat}>Start lead for this contact</Button>}
    </div></div>
    <p>{contact.email || "No email"} · {contact.phone || "No phone"}</p>
    {assignedOnly && <p className="muted">This view shows the contact and activity for your assigned follow-up.</p>}
    {contact.role !== "Realtor" && <div className="work-queue">
      <h4>Outreach preference</h4>
      {contact.outreachSuppressed ? <p className="muted"><span className="open-chip">Opted out</span> Orbit blocks prospecting across this brokerage, including new campaign imports.</p> :
        <p className="muted">No outreach opt-out is recorded for this contact.</p>}
      {optOut && !contact.outreachSuppressed && <div><Button size="sm" variant="outline" disabled={busy} onClick={optOut}>Record outreach opt-out</Button></div>}
    </div>}
    {loans.length ? <ul>{loans.map((loan) => <li key={loan.id}><button className="name-link" onClick={() => open(loan.id)}>
      {loan.purpose} · {loan.address || "Property pending"} · {loan.disposition === "Active" ? loan.stage : loan.disposition || loan.stage}
    </button></li>)}</ul> : !assignedOnly && <p className="empty-inline">No linked loans in this view.</p>}
    {current?.nextLoan && <Button size="sm" variant="outline" disabled={busy || loadingMore} onClick={() => void loadMoreLoans()}>
      {loadingMore ? "Loading linked loans…" : "Load more linked loans"}
    </Button>}
    {moreError && <p role="alert">{moreError}</p>}
    {save && <details className="document-form">
      <summary>Log contact activity</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const fields = { contactId: contact.id, kind, outcome: data.get("outcome") || null,
          text: data.get("summary"), followUp: data.get("followUp") || null, purpose: data.get("purpose") ?? undefined };
        const key = JSON.stringify(fields);
        if (attempt.current?.fields !== key) attempt.current = { id: crypto.randomUUID(), fields: key };
        void save({ type: "logContactActivity", eventId: attempt.current.id, ...fields }, () => {
          attempt.current = null;
          form.reset();
          setKind("Note");
        });
      }}>
        <div className="form-grid">
          <label className="field">Activity type<select value={kind} onChange={(event) => setKind(event.target.value as ActivityKind)}>
            {activityKinds.map((item) => <option key={item}>{item}</option>)}
          </select></label>
          {kind !== "Note" && <label className="field">Outcome<select name="outcome" required>
            <option value="">Choose an outcome</option>{contactOutcomes.map((item) => <option key={item}>{item}</option>)}
          </select></label>}
        </div>
        <label className="field">Activity summary<textarea name="summary" rows={2} required maxLength={2000} /></label>
        {kind !== "Note" && <div className="form-grid">
          <FollowUpPurposeField defaultPurpose="Prospecting" optedOut={contact.outreachSuppressed} />
          <label className="field">Follow-up date (optional)<input type="date" name="followUp" /></label>
        </div>}
        <p className="muted">Record an interaction that already happened. A follow-up date adds a reminder to My Tasks.</p>
        <div><Button size="sm" type="submit" disabled={busy}>Save activity</Button></div>
      </form>
    </details>}
    <h4>Communication history</h4>
    <ActivityPages key={contact.id} record="contact" id={contact.id} brokerageId={brokerageId} version={state}
      render={(events) => events.length ? <ul className="loan-task-list">{events.map((item) => {
        if (item.source === "conversation" && item.targetId) {
          const threadId = item.targetId;
          return <li key={`${item.source}:${item.id}`}>
            <button className="name-link" onClick={() => openThread(threadId)}>{item.direction} {item.kind.toLowerCase()} · {item.conversationType} conversation</button>
            <p className="muted">{item.origin} · {item.author} · {dateTime(item.createdAt)} ET</p>
            <p className="whitespace-pre-wrap break-words">{item.text}</p>
          </li>;
        }
        if (item.source === "reschedule" && item.previousDueAt && item.dueAt) {
          return <li key={`${item.source}:${item.id}`}>
            <strong>Callback rescheduled · {dateTime(item.createdAt)} ET</strong>
            <p>{item.author} moved it from {dateTime(item.previousDueAt)} ET to {dateTime(item.dueAt)} ET.</p>
            <p>{item.text}</p>
          </li>;
        }
        const label = `${item.kind} · ${dateTime(item.createdAt)} ET`;
        const { targetId } = item;
        const target = item.source === "loan" ? open : openLead;
        const followUp = item.dueAt && item.purpose && `${item.purpose} · ${item.followUpOwner || "Unassigned"} · ${item.completedAt ?
          `Follow-up completed ${dateTime(item.completedAt)} ET` : prospectingBlocked(item.purpose, contact.outreachSuppressed) ?
            "Follow-up blocked by outreach opt-out" : `Follow-up due ${dateTime(item.dueAt)} ET`}`;
        return <li key={`${item.source}:${item.id}`}>
          {targetId ? <button className="name-link" onClick={() => target(targetId)}>{label}</button> : <strong>{label}</strong>}
          <p>{item.source === "contact" ? [item.outcome, item.text, item.author].filter(Boolean).join(" · ") : item.text}</p>
          {followUp && <p className="muted">{followUp}</p>}
          <ContactFollowUpResult completion={item.latestCompletion} current={!!item.completedAt} showNote />
        </li>;
      })}</ul> : <p className="empty-inline">No communication activity in this view.</p>} />
  </section>;
}
