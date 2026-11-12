"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { filingReceiptEntry, filingReceiptFields, filingReceiptHistory, filingReceiptLocation, filingReceiptStatuses, type ObligationReviewBasis } from "@/lib/compliance-obligations-model";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type History = z.infer<typeof filingReceiptHistory>;
type Entry = z.infer<typeof filingReceiptEntry>;

function receiptHistory(result: Awaited<ReturnType<typeof accessComplianceCases>>): History {
  if ("error" in result) throw new Error(result.error);
  const data = result.kind === "obligations" ? result.result : null;
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") throw new Error(data.error);
  const parsed = filingReceiptHistory.safeParse(data);
  if (!parsed.success) throw new Error("Orbit could not read the filing record. Try again.");
  return parsed.data;
}

export function ComplianceFilingReceipts({ brokerageId, entityId, entityName, basis, archiveView, initialVersion }: {
  brokerageId: string; entityId: string; entityName: string; basis: ObligationReviewBasis;
  archiveView?: boolean; initialVersion?: number;
}) {
  const [history, setHistory] = useState<History>();
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [addingTo, setAddingTo] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const attempt = useRef<{ request: string; id: string }>(null);
  const pending = useRef(false);
  const focusFeedback = useRef<HTMLParagraphElement>(null);
  const firstField = useRef<HTMLSelectElement>(null);
  const receiptField = useRef<HTMLTextAreaElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const referenceActionId = useId();
  const { obligationId: id, period, report } = basis;
  const latest = history?.items[0];
  const featured = initialVersion === undefined ? latest : history?.items.find(entry => entry.version === initialVersion);
  const otherEntries = history?.items.filter(entry => entry.version !== featured?.version) ?? [];

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void accessComplianceCases({ type: "obligations", input: { operation: "filingReceipts", entityId, id, period } }, brokerageId).then(result => {
      if (!active) return;
      const received = receiptHistory(result);
      setHistory(received);
      setAddingTo(current => received.items.some(entry => entry.version === current && !entry.documentReference && !entry.addedReceiptReference) ? current : undefined);
      setRefreshNeeded(false);
    }).catch(() => {
      if (active) {
        setRefreshNeeded(true);
        setFeedback({ text: "Could not load the filing record. Refresh to try again.", error: true });
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [brokerageId, entityId, id, period, revision]);
  useEffect(() => { if (editing) firstField.current?.focus(); }, [editing]);
  useEffect(() => { if (addingTo) receiptField.current?.focus(); }, [addingTo]);
  useEffect(() => { if (feedback) focusFeedback.current?.focus(); }, [feedback]);

  function loadAgain() {
    setLoading(true);
    setFeedback(undefined);
    refresh(value => value + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>, version?: number) {
    event.preventDefault();
    if (!history || pending.current || refreshNeeded || loading) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = filingReceiptFields.safeParse(form);
    const location = filingReceiptLocation.safeParse(form.location);
    if (version ? !location.success : !parsed.success) {
      setFeedback({ text: version ? "Enter a receipt location with at least 3 characters." : "Check the confirmation status, number and date.", error: true });
      return;
    }
    const input = version ? { operation: "addFilingReceiptReference", entityId, id, period, version, location: location.data } :
      { operation: "recordFilingReceipt", entityId, id, period, expectedVersion: latest?.version ?? 0, ...parsed.data };
    const request = JSON.stringify(input);
    if (attempt.current?.request !== request) attempt.current = { request, id: crypto.randomUUID() };
    pending.current = true;
    setSaving(true);
    setFeedback(undefined);
    try {
      const result = await accessComplianceCases({ type: "obligations", input: { ...input, requestId: attempt.current.id } }, brokerageId)
        .catch(() => { throw new Error("Save could not be confirmed. Retry the same entry."); });
      if (!mounted.current) return;
      setHistory(receiptHistory(result));
      setEditing(false);
      setAddingTo(undefined);
      attempt.current = null;
      setFeedback({ text: version ? "Receipt location added to this confirmation." : "Filing confirmation recorded." });
    } catch (error) {
      if (!mounted.current) return;
      const message = error instanceof Error ? error.message : "Save could not be confirmed. Retry the same entry.";
      setRefreshNeeded(message.startsWith("The filing record changed.") || message.startsWith("That filing confirmation is unavailable."));
      setFeedback({ text: message, error: true });
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function exportEntry(entry: Entry) {
    downloadSampleFile(JSON.stringify({
      recordType: "Staff-recorded external filing confirmation", entityId, entityName, obligationId: id,
      period, report, obligationVersion: basis.version, ...entry,
    }, null, 2), `orbit-filing-confirmation-${period}-v${entry.version}.json`, "application/json");
  }

  const entryDetails = (entry: Entry, opened = false) => <>
    <p className="break-words">{opened && <><strong>{entry.version === latest?.version ? "Latest confirmation" : "Opened confirmation"}</strong> · </>}
      {entry.status} · {entry.confirmation} · {dateLabel(entry.confirmedOn)}</p>
    {opened && latest && entry.version !== latest.version &&
      <p><strong>Latest recorded status</strong> · {latest.status} · {dateLabel(latest.confirmedOn)}</p>}
    <p className="break-words">{entry.documentReference || entry.addedReceiptReference ?
      `Original receipt location · ${entry.documentReference || entry.addedReceiptReference?.location}` : "Original receipt location is missing."}</p>
    {entry.addedReceiptReference && <p className="muted break-words">Location added by {entry.addedReceiptReference.recordedBy} · {dateTime(entry.addedReceiptReference.recordedAt)} ET</p>}
    {entry.note && <p className="break-words">{entry.note}</p>}
    <p className="muted break-words">Version {entry.version} · Recorded by {entry.recordedBy} · {dateTime(entry.recordedAt)} ET</p>
    {addingTo !== entry.version && <div className="loan-application-actions">
      {!entry.documentReference && !entry.addedReceiptReference && <Button id={`${referenceActionId}-${entry.version}`}
        size="sm" className="min-h-11" disabled={editing || addingTo !== undefined || loading || refreshNeeded}
        aria-label={`Add receipt location for ${entry.confirmation}`} onClick={() => {
          setFeedback(undefined);
          setAddingTo(entry.version);
        }}>Add receipt location</Button>}
      <Button size="sm" variant="outline" className="min-h-11" aria-label={`Download Orbit filing record version ${entry.version}`}
        onClick={() => exportEntry(entry)}>Download Orbit record</Button>
    </div>}
    {addingTo === entry.version && <form className="record-form" onSubmit={event => void save(event, entry.version)}>
      <fieldset className="record-form" disabled={saving}>
        <label className="field">Original receipt location<textarea ref={receiptField} name="location" rows={3} required minLength={3} maxLength={350}
          placeholder="For example, shared drive folder and filename" /></label>
        <div className="loan-application-actions">
          <Button size="sm" type="submit" className="min-h-11" disabled={loading || refreshNeeded}>{saving ? "Saving…" : "Save receipt location"}</Button>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => {
            setAddingTo(undefined);
            setFeedback(undefined);
            requestAnimationFrame(() => document.getElementById(`${referenceActionId}-${entry.version}`)?.focus());
          }}>Cancel</Button>
        </div>
      </fieldset>
    </form>}
  </>;

  return <section className="record-form document-item" aria-label="External filing">
    <h3>External filing</h3>
    <p className="muted">{archiveView ? "Your team recorded these confirmations after filing outside Orbit." :
      "After filing outside Orbit, enter the confirmation details and where your team can find the original receipt."}</p>
    {feedback && <p ref={focusFeedback} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {loading && <p role="status">Loading filing history…</p>}
    {history && !latest && <p>No filing confirmation recorded for this period.</p>}
    {latest && initialVersion !== undefined && !featured && <p role="alert">The confirmation you opened is unavailable. Return to filing results to search again.</p>}
    {featured && entryDetails(featured, archiveView)}
    {otherEntries.length > 0 && <details className="document-form">
      <summary className="min-h-11 content-center">{featured?.version === latest?.version ? "Earlier filing entries" : "Other filing entries"} ({otherEntries.length})</summary>
      <ul className="document-list">{otherEntries.map(entry => <li className="record-form" key={entry.version}>{entryDetails(entry)}</li>)}</ul>
    </details>}
    {refreshNeeded && <div><Button size="sm" variant="outline" disabled={loading || saving} onClick={loadAgain}>Refresh filing history</Button></div>}
    {editing ? <form className="record-form" onSubmit={save}>
      <fieldset className="record-form" disabled={saving}>
        <div className="form-grid">
          <label className="field">Status on confirmation<select ref={firstField} name="status" required defaultValue="">
            <option value="">Choose status</option>{filingReceiptStatuses.map(status => <option key={status}>{status}</option>)}
          </select></label>
          <label className="field">Confirmation or reference number<input name="confirmation" required minLength={3} maxLength={120} /></label>
          <label className="field">Date on confirmation<input type="date" name="confirmedOn" max={history?.today} required /></label>
        </div>
        <label className="field">Original receipt location (optional)<textarea name="documentReference" rows={2}
          maxLength={350} placeholder="For example, shared drive folder and filename" /></label>
        <label className="field">{latest ? "Reason for the new entry" : "Note (optional)"}<textarea name="note" required={!!latest} minLength={latest ? 5 : undefined} maxLength={500} rows={2} /></label>
        <div className="loan-application-actions">
          <Button size="sm" type="submit" disabled={loading || refreshNeeded}>{saving ? "Saving…" : "Save filing confirmation"}</Button>
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setFeedback(undefined); requestAnimationFrame(() => addButton.current?.focus()); }}>Cancel</Button>
        </div>
      </fieldset>
    </form> : !archiveView && history && !refreshNeeded && <div>
      <Button ref={addButton} size="sm" variant="outline" disabled={addingTo !== undefined} onClick={() => { setFeedback(undefined); setEditing(true); }}>
        {latest ? "Record another confirmation" : "Record filing confirmation"}
      </Button>
    </div>}
  </section>;
}
