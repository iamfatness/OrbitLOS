"use client";

import { useState } from "react";
import { contactDuplicate, exportContactCsv, parseContactCsv, type ContactImportRow } from "@/lib/contact-csv";
import type { Contact, Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function ContactImport({ contacts, busy, save }: {
  contacts: Contact[]; busy: boolean; save: (input: unknown, after?: () => void) => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ id: string; rows: ContactImportRow[] }>();
  const [error, setError] = useState("");

  function download() {
    const url = URL.createObjectURL(new Blob([exportContactCsv(contacts)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "orbit-contacts.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="work-queue">
    <div className="section-heading"><h3>Contact import and export</h3>
      <Button size="sm" variant="outline" disabled={!contacts.length} onClick={download}>Export accessible contacts</Button>
    </div>
    <label className="field">Preview contacts CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      setError("");
      setPreview(undefined);
      if (!file) return;
      try {
        if (file.size > 200_000) throw new Error("Choose a smaller CSV file.");
        setPreview({ id: crypto.randomUUID(), rows: parseContactCsv(await file.text()) });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "This CSV could not be read.");
      }
    }} /></label>
    <p className="muted">Use the columns name, email, phone, and role. Roles are Borrower, Co-borrower, and Realtor. Import fictional contacts in a pilot.</p>
    {error && <p role="alert">{error}</p>}
    {preview && <><p className="muted">Possible duplicates are skipped unless you mark them as separate contacts. Orbit checks again when saving.</p>
      <ul className="loan-task-list">{preview.rows.map((row, index) => {
        const duplicate = contactDuplicate(row, [...contacts, ...preview.rows.slice(0, index)]);
        return <li className="loan-task" key={index}><div className="loan-task-copy"><strong>{row.name}</strong>
          <span>{row.role} · {row.email || row.phone || "No contact method"}</span></div>
          {duplicate && <label><input type="checkbox" checked={!!row.separate} onChange={(event) => {
            const separate = event.target.checked;
            setPreview({ ...preview, id: crypto.randomUUID(), rows: preview.rows.map((item, i) => i === index ? { ...item, separate } : item) });
          }} /> Import as separate contact</label>}</li>;
      })}</ul>
      <Button size="sm" disabled={busy} onClick={() => void save({ type: "importContacts", batchId: preview.id, rows: preview.rows }, () => setPreview(undefined))}>Import reviewed contacts</Button>
    </>}
  </div>;
}

export function ContactHistory({ contact, state, open, repeat }: {
  contact: Contact; state: Workspace; open: (loanId: string) => void; repeat?: () => void;
}) {
  const loans = state.loans.filter((loan) => loan.contactId === contact.id || loan.partnerId === contact.id);
  const loanIds = new Set(loans.map((loan) => loan.id));
  const events = state.activity.filter((item) => loanIds.has(item.loanId) && item.kind !== "Note");
  return <section className="details-section" aria-label="Contact history">
    <div className="section-heading"><h3>{contact.name}</h3>{repeat && <Button size="sm" onClick={repeat}>Start lead for this contact</Button>}</div>
    <p>{contact.email || "No email"} · {contact.phone || "No phone"}</p>
    {loans.length ? <ul>{loans.map((loan) => <li key={loan.id}><button className="name-link" onClick={() => open(loan.id)}>
      {loan.purpose} · {loan.address || "Property pending"} · {loan.disposition === "Active" ? loan.stage : loan.disposition || loan.stage}
    </button></li>)}</ul> : <p className="empty-inline">No linked loans in this view.</p>}
    <h4>Communication history</h4>
    {events.length ? <ul className="loan-task-list">{events.slice(0, 30).map((item) => <li key={item.id}>
      <button className="name-link" onClick={() => open(item.loanId)}>{item.kind} · {dateTime(item.createdAt)} ET</button>
      <p>{item.text}</p>
    </li>)}</ul> : <p className="empty-inline">No communication activity in this view.</p>}
  </section>;
}
