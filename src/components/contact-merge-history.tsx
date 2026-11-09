"use client";

import { useEffect, useRef, useState } from "react";
import { reviewContactMerge } from "@/app/actions";
import type { ContactMergeCursor, ContactMergeHistory as HistoryPage, ContactUndoPreview } from "@/lib/contact-merge-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function ContactMergeHistory({ brokerageId, refreshContacts, openContact }: {
  brokerageId: string; refreshContacts: () => void; openContact: (id: string) => void;
}) {
  const [after, setAfter] = useState<ContactMergeCursor>();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ after: typeof after; revision: number; page: HistoryPage | { error: string } }>();
  const [preview, setPreview] = useState<ContactUndoPreview>();
  const [restored, setRestored] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ mergeId: string; id: string } | null>(null);

  useEffect(() => {
    let active = true;
    const fallback = { error: "Could not load merge history. Try refreshing." };
    void reviewContactMerge({ type: "history", after }, brokerageId).then((response) => {
      if (active) setResult({ after, revision, page: "error" in response || response.kind === "history" ? response : fallback });
    }, () => { if (active) setResult({ after, revision, page: fallback }); });
    return () => { active = false; };
  }, [after, brokerageId, revision]);

  const current = result && result.after === after && result.revision === revision ? result.page : undefined;
  const page = current && "kind" in current ? current : undefined;
  async function review(mergeId: string, fingerprint?: string) {
    if (busy) return;
    if (attempt.current?.mergeId !== mergeId) attempt.current = { mergeId, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setRestored("");
    if (!fingerprint) setPreview(undefined);
    try {
      const response = await reviewContactMerge(fingerprint ? { type: "undo", mergeId, fingerprint, operationId: attempt.current.id } :
        { type: "previewUndo", mergeId }, brokerageId);
      if ("error" in response) setError(response.error);
      else if (response.kind === "undoPreview") setPreview(response);
      else if (response.kind === "undone") {
        setRestored(response.contactId);
        setPreview(undefined);
        setRevision((value) => value + 1);
        refreshContacts();
      }
    } catch { setError("Could not confirm the result. Try the same request again."); }
    finally { setBusy(false); }
  }

  return <section className="record-form" aria-label="Contact merge history">
    <p className="muted">Review who merged each contact and when. Undo is available when the primary and linked work still match the saved merge.</p>
    {restored && <div className="work-queue">
      <p role="status">Merge undone. Both contacts and their original links are restored.</p>
      <Button size="sm" variant="outline" onClick={() => openContact(restored)}>Open restored contact</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {preview && <section className="work-queue record-form" aria-label="Undo preview">
      <div className="section-heading"><h3>Undo preview</h3><Button size="sm" variant="ghost" disabled={busy} onClick={() => setPreview(undefined)}>Close preview</Button></div>
      <p>Restore <strong>{preview.sourceName}</strong> as a separate contact from <strong>{preview.targetName}</strong>.</p>
      {preview.links.length > 0 && <ul>{preview.links.map(({ label, count }) => <li key={label}>{label} · {count}</li>)}</ul>}
      {preview.blocker && <p>{preview.blocker}</p>}
      {preview.fingerprint && <div><Button size="sm" variant="outline" disabled={busy}
        onClick={() => void review(preview.mergeId, preview.fingerprint ?? undefined)}>Undo merge</Button></div>}
    </section>}
    {!current && <p role="status">Loading merge history…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {page && (page.rows.length ? <ul className="loan-task-list">{page.rows.map((row) => <li className="document-item record-form" key={row.mergeId}>
      <div className="document-item-head"><strong>{row.sourceName} → {row.targetName}</strong><span className="pill">{row.undoneAt ? "Undone" : "Merged"}</span></div>
      <p className="muted">Merged by {row.actor} · {dateTime(row.at)} ET</p>
      {row.undoneAt ? <p className="muted">Undone by {row.undoneBy} · {dateTime(row.undoneAt)} ET</p> :
        <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void review(row.mergeId)}>Review undo</Button></div>}
    </li>)}</ul> : <p className="empty-inline">No merges on this page.</p>)}
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Refresh history</Button>
      {after && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setAfter(undefined); setPreview(undefined); }}>Newest merges</Button>}
      {page?.next && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setAfter(page.next ?? undefined); setPreview(undefined); }}>Older merges</Button>}
    </div>
  </section>;
}
