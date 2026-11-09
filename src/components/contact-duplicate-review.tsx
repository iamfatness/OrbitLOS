"use client";

import { useRef, useState } from "react";
import { reviewContactMerge } from "@/app/actions";
import { contactMatchFields, type ContactMergePreview } from "@/lib/contact-merge-model";
import type { Contact } from "@/lib/model";
import { Button } from "./ui/button";

export function ContactDuplicateReview({ contact, contacts, brokerageId, onMerged, onSaved }: {
  contact: Contact; contacts: Contact[]; brokerageId: string; onMerged: (contactId: string) => void; onSaved?: () => void;
}) {
  const candidates = contacts.filter((candidate) => candidate.id !== contact.id &&
    Object.values(contactMatchFields(contact, candidate)).some(Boolean));
  const [candidate, setCandidate] = useState(candidates.length === 1 ? candidates[0].id : "");
  const [keepSelected, setKeepSelected] = useState(true);
  const [preview, setPreview] = useState<ContactMergePreview>();
  const [merged, setMerged] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);

  function reset() {
    setPreview(undefined);
    setConfirmed(false);
    setError("");
  }

  async function review(commit = false) {
    if (!candidate || busy || (commit && (!preview || !confirmed || preview.blockers.length))) return;
    const pair = keepSelected ? { sourceId: candidate, targetId: contact.id } : { sourceId: contact.id, targetId: candidate };
    if (commit && preview && operation.current?.fingerprint !== preview.fingerprint) {
      operation.current = { fingerprint: preview.fingerprint, id: crypto.randomUUID() };
    }
    setBusy(true);
    setError("");
    try {
      const result = await reviewContactMerge(commit && preview && operation.current ?
        { type: "merge", ...pair, fingerprint: preview.fingerprint, operationId: operation.current.id } : { type: "preview", ...pair }, brokerageId);
      if ("error" in result) { setError(result.error); setConfirmed(false); }
      else if (result.kind === "merged") { setMerged(result.contactId); onSaved?.(); }
      else if (result.kind === "preview") { setPreview(result); setConfirmed(false); }
    } catch { setError("Could not reach Orbit. Review the result before trying again."); }
    finally { setBusy(false); }
  }

  if (merged) return <section className="record-form">
    <p role="status">Contacts merged. The primary record now holds the linked work.</p>
    <div><Button size="sm" onClick={() => onMerged(merged)}>Open primary contact</Button></div>
  </section>;
  const other = candidates.find((entry) => entry.id === candidate);
  return <section className="record-form">
    <p>Compare records that share an email address or phone number with <strong>{contact.name}</strong>.</p>
    {candidates.length === 0 ? <p className="empty-inline">No contacts share this email address or phone number.</p> : <>
      <form className="record-form" onSubmit={(event) => { event.preventDefault(); void review(); }}>
        <label className="field">Possible duplicate<select value={candidate} required disabled={busy} onChange={(event) => {
          setCandidate(event.target.value); setKeepSelected(true); reset();
        }}>
          <option value="">Choose a record</option>
          {candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.role} · {entry.email || entry.phone}</option>)}
        </select></label>
        {other && <label className="field">Keep as primary<select value={keepSelected ? contact.id : other.id} disabled={busy} onChange={(event) => {
          setKeepSelected(event.target.value === contact.id); reset();
        }}>
          <option value={contact.id}>{contact.name} · Opened record</option>
          <option value={other.id}>{other.name} · Matched record</option>
        </select></label>}
        <div><Button size="sm" type="submit" variant="outline" disabled={busy}>Preview merge</Button></div>
      </form>
      {error && <p role="alert">{error}</p>}
      {preview && <>
        <div className="form-grid">
          {([[preview.target, "Primary contact"], [preview.source, "Duplicate contact"]] as const).map(([record, label]) =>
            <section className="work-queue" key={record.id}>
              <h3>{label}</h3><strong>{record.name}</strong>
              <p>{record.role} · {record.email || "No email"} · {record.phone || "No phone"}</p>
            </section>)}
        </div>
        <p className="muted">Matching fields · {preview.matches.join(" and ") || "No current match"}</p>
        <div className="work-queue">
          <h3>Result after merge</h3>
          <p>{preview.kept.name} · {preview.kept.email || "No email"} · {preview.kept.phone || "No phone"}</p>
          {preview.links.length ? <ul>{preview.links.map(({ label, count }) => <li key={label}>{label} · {count}</li>)}</ul> :
            <p className="muted">The duplicate has no linked work to move.</p>}
          {preview.optedOut && <p>Outreach opt-out carries over to the primary record.</p>}
        </div>
        {preview.blockers.length ? <div className="work-queue"><h3>Review required</h3>
          <ul>{preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div> : <>
          <label className="demo-confirm"><input type="checkbox" checked={confirmed} disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)} />I reviewed both records and their linked work.</label>
          <div><Button size="sm" disabled={!confirmed || busy} onClick={() => void review(true)}>Merge contacts</Button></div>
        </>}
      </>}
    </>}
  </section>;
}
