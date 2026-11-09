"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { newPortalAccessCode, portalToken } from "@/lib/brokerage-model";
import { documentKinds } from "@/lib/document-model";
import { leadDocumentsUnavailable, leadDocumentTarget, type LeadDocumentPage } from "@/lib/lead-document-model";
import { dateLabel } from "@/lib/client-retention";
import { dateTime } from "@/lib/utils";
import { DocumentStatusPill } from "./sample-document";
import { Button } from "./ui/button";

export function LeadDocumentChecklist({ brokerageId, leadId, busy, focusRequestId }: {
  brokerageId: string; leadId: string; busy: boolean; focusRequestId?: string;
}) {
  const [page, setPage] = useState<LeadDocumentPage>();
  const [open, setOpen] = useState(Boolean(focusRequestId));
  const [working, setWorking] = useState(Boolean(focusRequestId));
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [credentials, setCredentials] = useState<{ linkId: string; token: string; code: string }>();
  const [revoking, setRevoking] = useState(false);
  const pending = useRef(false);
  const focused = useRef(false);
  const requestAttempt = useRef<{ key: string; id: string } | null>(null);
  const linkAttempt = useRef<{ hours: number; linkId: string; token: string; code: string } | null>(null);
  const disabled = working || busy;

  function load(input: object) {
    if (pending.current) return;
    pending.current = true;
    return fetch(`/api/lead-documents?brokerage=${encodeURIComponent(brokerageId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, ...input }),
    }).then(async (response) => {
      if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error(leadDocumentsUnavailable);
      const result = await response.json() as LeadDocumentPage | { error: string };
      if ("error" in result) throw new Error(result.error);
      if (!response.ok) throw new Error(leadDocumentsUnavailable);
      setPage(result);
      if (result.message) setFeedback({ text: result.message });
      return result;
    }).catch((error: unknown) => {
      setFeedback({ text: error instanceof Error ? error.message : leadDocumentsUnavailable, error: true });
    }).finally(() => {
      pending.current = false;
      setWorking(false);
    });
  }
  async function run(input: object) {
    if (pending.current) return;
    setWorking(true);
    setFeedback(undefined);
    return load(input);
  }
  const loadFocusedRequest = useEffectEvent(() => { void load({ type: "read" }); });
  useEffect(() => { if (focusRequestId) loadFocusedRequest(); }, [focusRequestId]);
  useEffect(() => {
    if (!focusRequestId || !page || !open || focused.current) return;
    const item = document.getElementById(leadDocumentTarget(focusRequestId));
    if (!item) return;
    focused.current = true;
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: "center" });
  }, [focusRequestId, open, page]);
  const link = credentials && page?.link?.id === credentials.linkId ? `${window.location.origin}/lead-documents#${credentials.token}` : undefined;
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ text: `${label} copied.` });
    } catch {
      setFeedback({ text: "Could not copy. Select the value and copy it manually.", error: true });
    }
  }
  const remainingKinds = documentKinds.filter((kind) => !page?.requests.some((request) => request.kind === kind));

  return <details className="document-form" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary onClick={() => { if (!page) void run({ type: "read" }); }}>Lead document checklist</summary>
    <div className="record-form" aria-label="Lead document checklist">
      <p className="muted">Request built-in sample PDFs before the 1003. When this lead converts, the files and their review status move to the loan checklist and this link closes.</p>
      {feedback && <p className="application-message" role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      <div><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void run({ type: "read" })}>
        {working ? "Loading lead documents…" : "Refresh lead documents"}
      </Button></div>
      {page && <>
        {!page.canRequest && <p className="muted">Reactivate this lead to request or review sample documents.</p>}
        {!page.requests.length && <p className="muted">No documents have been requested yet.</p>}
        {page.requests.length > 0 && <ul className="document-list">{page.requests.map((item) =>
          <li className="document-item" id={leadDocumentTarget(item.id)} tabIndex={-1} key={item.id}>
          <div className="document-item-head"><strong>{item.kind}</strong><DocumentStatusPill status={item.status} /></div>
          <p>{item.instructions}{item.dueOn && ` · Due ${dateLabel(item.dueOn)}`}</p>
          {item.replacementNote && <p className="muted">Replacement note · {item.replacementNote}</p>}
          {item.pdfStatus === "Processing" && <p className="muted">Mock scan in progress.</p>}
          {item.pdfUploadedAt && <a href={`/api/documents/download?brokerage=${encodeURIComponent(brokerageId)}&request=${item.id}`}>Download sample PDF</a>}
          {page.canRequest && item.status === "Received" && <>
            <div><Button type="button" size="sm" disabled={disabled} onClick={() => void run({
              type: "review", requestId: item.id, revision: item.revision, decision: "Accepted", replacementNote: "",
            })}>Accept sample PDF</Button></div>
            <details className="document-form"><summary>Request sample replacement</summary>
              <form method="post" className="record-form" onSubmit={(event) => {
                event.preventDefault();
                void run({ type: "review", requestId: item.id, revision: item.revision, decision: "Needs replacement",
                  replacementNote: new FormData(event.currentTarget).get("note") });
              }}>
                <label className="field">Replacement instructions<textarea name="note" maxLength={500} rows={2} required /></label>
                <div><Button size="sm" type="submit" disabled={disabled}>Request replacement</Button></div>
              </form>
            </details>
          </>}
        </li>)}</ul>}
        {page.canRequest && remainingKinds.length > 0 && <form method="post" className="record-form" aria-label="Request a sample lead document" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const input = { type: "request", kind: data.get("kind"), instructions: data.get("instructions"), dueOn: data.get("dueOn") || null };
          const key = JSON.stringify(input);
          if (requestAttempt.current?.key !== key) requestAttempt.current = { key, id: crypto.randomUUID() };
          void run({ ...input, requestId: requestAttempt.current.id }).then((result) => {
            if (result) { requestAttempt.current = null; form.reset(); }
          });
        }}>
          <div className="form-grid">
            <label className="field">Sample document type<select name="kind" required>{remainingKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
            <label className="field">Due date (optional)<input name="dueOn" type="date" /></label>
          </div>
          <label className="field">Borrower instructions<textarea name="instructions" required maxLength={500} rows={2} /></label>
          <div><Button size="sm" type="submit" disabled={disabled}>Request sample document</Button></div>
        </form>}
        {page.link ? <div className="document-item record-form">
          <p><strong>Sample document link</strong> · Expires {dateTime(page.link.expiresAt)} ET</p>
          {link && credentials ? <>
            <label className="field">Lead document link<input value={link} readOnly /></label>
            <label className="field">Lead document access code<input value={credentials.code} readOnly /></label>
            <p className="muted">Copy the link and give the code separately. The credentials are displayed when the link is issued.</p>
            <div className="loan-application-actions">
              <Button size="sm" type="button" variant="outline" onClick={() => void copy(link, "Lead document link")}>Copy lead document link</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => void copy(credentials.code, "Access code")}>Copy access code</Button>
            </div>
          </> : <p className="muted">To issue new credentials, revoke this link and create another.</p>}
          <div className="loan-application-actions">
            {revoking ? <>
              <Button size="sm" type="button" disabled={disabled} onClick={() => {
                void run({ type: "revoke", linkId: page.link?.id }).then((result) => {
                  if (result) { setCredentials(undefined); setRevoking(false); }
                });
              }}>Confirm lead link revocation</Button>
              <Button size="sm" type="button" variant="ghost" disabled={disabled} onClick={() => setRevoking(false)}>Cancel</Button>
            </> : <Button size="sm" type="button" variant="outline" disabled={disabled} onClick={() => setRevoking(true)}>Revoke lead document link</Button>}
          </div>
        </div> : page.canIssue ? <form method="post" className="record-form" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const hours = Number(values.get("hours"));
          if (linkAttempt.current?.hours !== hours) linkAttempt.current = {
            hours, linkId: crypto.randomUUID(), token: portalToken(brokerageId), code: newPortalAccessCode(),
          };
          const attempt = linkAttempt.current;
          void run({ type: "issue", ...attempt, confirmedFictional: values.has("fictional") }).then((result) => {
            if (result?.createdId === attempt.linkId) {
              setCredentials(attempt);
              linkAttempt.current = null;
            }
          });
        }}>
          <label className="field">Lead document link expires after<select name="hours" defaultValue="24">
            <option value="1">1 hour</option><option value="24">24 hours</option><option value="72">72 hours</option>
          </select></label>
          <label className="demo-confirm"><input type="checkbox" name="fictional" required /> This lead and its documents are fictional.</label>
          <div><Button size="sm" type="submit" disabled={disabled}>Create lead document link</Button></div>
        </form> : page.canRequest && page.requests.length > 0 && <p className="muted">Borrower uploads require the hosted mock PDF workspace.</p>}
      </>}
    </div>
  </details>;
}
