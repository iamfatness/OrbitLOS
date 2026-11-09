"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { dateLabel } from "@/lib/client-retention";
import { preapprovalAmount, preapprovalScopes, type PreapprovalPage, type PreapprovalResult } from "@/lib/preapproval-model";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

async function preapprovalRequest(endpoint: string, data: object, signal?: AbortSignal): Promise<PreapprovalResult> {
  const result = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data), signal });
  if (!result.headers.get("Content-Type")?.includes("application/json")) return { error: "Refresh the workspace and try again." };
  return result.json() as Promise<PreapprovalResult>;
}

export function PreapprovalLetters({ loanId, brokerageId, revision }: { loanId: string; brokerageId: string; revision?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [beforeVersion, setBeforeVersion] = useState<number>();
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ beforeVersion?: number; revision?: number; refresh: number; page?: PreapprovalPage; error?: string }>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  const saving = useRef(false);
  const attempt = useRef<{ key: string; id: string }>(null);
  const endpoint = `/api/preapproval-letters?brokerage=${encodeURIComponent(brokerageId)}`;
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void preapprovalRequest(endpoint, { type: "read", loanId, beforeVersion }, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setResult({ beforeVersion, revision, refresh, ...("page" in value ? { page: value.page } :
        { error: "error" in value ? value.error : "Could not load letters." }) });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ beforeVersion, revision, refresh, error: "Could not load letters. Try refreshing." });
    });
    return () => controller.abort();
  }, [endpoint, loanId, expanded, revision, beforeVersion, refresh]);

  const current = result?.beforeVersion === beforeVersion && result?.revision === revision && result?.refresh === refresh ? result : undefined;
  const page = current?.page;
  const issue = page && !("blocked" in page.issue) ? page.issue : undefined;
  async function perform(input: object) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const value = await preapprovalRequest(endpoint, input);
      if ("error" in value) { setFeedback({ message: value.error, error: true }); return; }
      if ("pdf" in value) {
        downloadSampleFile(value.pdf, value.filename, "application/pdf");
      } else {
        setResult({ beforeVersion, revision, refresh, page: value.page });
        setEditing(false);
        attempt.current = null;
        setFeedback({ message: `Sample letter v${value.issuedVersion} issued. The PDF is ready to download.` });
      }
    } catch {
      setFeedback({ message: "Could not confirm the request. Try again.", error: true });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issue || !page || saving.current) return;
    const fields = new FormData(event.currentTarget);
    const input = { type: "issue", loanId, previousVersion: page.latestVersion, applicationRevision: issue.applicationRevision,
      amountCents: Math.round(Number(fields.get("amount")) * 100), scope: fields.get("scope"),
      expiresOn: fields.get("expiresOn"), confirmed: fields.has("confirmed") };
    const key = JSON.stringify(input);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    void perform({ ...input, requestId: attempt.current.id });
  }

  return <details className="loan-task-create" onToggle={(event) => {
    const open = event.currentTarget.open;
    if (open) setRefresh((value) => value + 1);
    setExpanded(open);
  }}>
    <summary>Sample preapproval letters</summary>
    {expanded && <section className="record-form" aria-label="Sample preapproval letters">
      <p className="muted">Fictional demo PDFs for staff review. Each issued version records the reviewed 1003, expiry date, and issuer.</p>
      {!current && <p className="muted" role="status">Loading sample letters…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
      {page?.letters.length ? <ul className="loan-task-list">{page.letters.map((letter) => <li className="loan-task" key={letter.version}>
        <div className="loan-task-copy"><strong>Version {letter.version} · {preapprovalAmount(letter.amountCents)}</strong>
          <span>{letter.status} · {letter.scope} · Expires {dateLabel(letter.expiresOn)}</span>
          <span>{letter.issuer} · {dateTime(letter.issuedAt)} ET · 1003 revision {letter.applicationRevision}</span>
        </div>
        <Button size="sm" variant="outline" disabled={busy} aria-label={`Download sample letter v${letter.version} PDF`}
          onClick={() => void perform({ type: "download", loanId, version: letter.version })}><Download /> PDF</Button>
      </li>)}</ul> : page && <p className="empty-inline">No sample letters issued yet.</p>}
      <div className="loan-application-actions">
        {beforeVersion && <Button size="sm" variant="outline" disabled={busy} onClick={() => setBeforeVersion(undefined)}>Latest letters</Button>}
        {page?.beforeVersion && <Button size="sm" variant="outline" disabled={busy} onClick={() => setBeforeVersion(page.beforeVersion!)}>Older letters</Button>}
        {(page || current?.error) && <Button size="sm" variant="outline" disabled={busy} onClick={() => {
          setEditing(false); setFeedback(undefined); setBeforeVersion(undefined); setRefresh((value) => value + 1);
        }}>Refresh letters</Button>}
        {issue && !beforeVersion && !editing && <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
          {page?.latestVersion ? "Prepare a new version" : "Prepare sample letter"}
        </Button>}
      </div>
      {page && !beforeVersion && "blocked" in page.issue && <p className="muted">{page.issue.blocked}</p>}
      {issue && editing && !beforeVersion && <form className="record-form" onSubmit={submit} key={`${issue.applicationRevision}:${page?.latestVersion}`}>
        <div className="form-grid">
          <label className="field">Sample loan amount<input name="amount" type="number" min="0.01" max={issue.amountCents / 100}
            step="0.01" defaultValue={issue.amountCents / 100} required disabled={busy} /></label>
          <label className="field">Expires on (Eastern)<input name="expiresOn" type="date" min={issue.earliestExpiry}
            max={issue.latestExpiry} defaultValue={issue.suggestedExpiry} required disabled={busy} /></label>
          <label className="field">Property scope<select name="scope" disabled={busy}>
            {preapprovalScopes.map((scope) => <option key={scope} disabled={scope === "Subject property" && !issue.property}>{scope}</option>)}
          </select></label>
        </div>
        {issue.property && <p className="muted">Reviewed subject property · {issue.property}</p>}
        <label className="demo-confirm"><input name="confirmed" type="checkbox" required disabled={busy} />
          <span>I reviewed the amount and expiry for this fictional sample.</span></label>
        <div className="loan-application-actions">
          <Button type="submit" size="sm" disabled={busy}>Issue sample letter</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(false); setFeedback(undefined); }}>Cancel</Button>
        </div>
      </form>}
    </section>}
  </details>;
}
