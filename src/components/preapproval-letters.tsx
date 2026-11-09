"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { dateLabel } from "@/lib/client-retention";
import { preapprovalAmount, preapprovalScopes, type PreapprovalAudience, type PreapprovalPage, type PreapprovalResult,
  type PreapprovalShareState } from "@/lib/preapproval-model";
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
  const [publishing, setPublishing] = useState<PreapprovalAudience>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  const saving = useRef(false);
  const attempt = useRef<{ key: string; id: string }>(null);
  const shareAttempt = useRef<{ key: string; id: string }>(null);
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
        setPublishing(undefined);
        attempt.current = null;
        shareAttempt.current = null;
        setFeedback({ message: value.shareMessage ?? `Sample letter v${value.issuedVersion} issued. The PDF is ready to download.` });
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
  function publish(event: FormEvent<HTMLFormElement>, target: PreapprovalShareState, version: number) {
    event.preventDefault();
    if (!target.recipient || saving.current || !new FormData(event.currentTarget).has("permission")) return;
    const input = { type: "publish", loanId, version, audience: target.audience, previousGrantId: target.grantId,
      recipientStamp: target.recipient.stamp, confirmed: true };
    const key = JSON.stringify(input);
    if (shareAttempt.current?.key !== key) shareAttempt.current = { key, id: crypto.randomUUID() };
    void perform({ ...input, grantId: shareAttempt.current.id });
  }

  return <details className="loan-task-create" onToggle={(event) => {
    const open = event.currentTarget.open;
    if (open) setRefresh((value) => value + 1);
    setExpanded(open);
  }}>
    <summary>Sample preapproval letters</summary>
    {expanded && <section className="record-form" aria-label="Sample preapproval letters">
      <p className="muted">Each fictional PDF records the reviewed 1003, expiry date, and issuer. Choose who can see the current version.</p>
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
          setEditing(false); setPublishing(undefined); setFeedback(undefined); setBeforeVersion(undefined); setRefresh((value) => value + 1);
        }}>Refresh letters</Button>}
        {issue && !beforeVersion && !editing && <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
          {page?.latestVersion ? "Prepare a new version" : "Prepare sample letter"}
        </Button>}
      </div>
      {page && !beforeVersion && "blocked" in page.issue && <p className="muted">{page.issue.blocked}</p>}
      {page?.sharing && !editing && <section className="record-form" aria-label="Share current sample letter">
        <div><strong>Share version {page.sharing.version}</strong>
          <p className="muted">Publication adds the PDF to the selected private portal. A replacement needs a new publication.</p></div>
        {!page.sharing.canPublish && <p className="muted">Only a current sample letter can be shared.</p>}
        {page.sharing.audiences.map((target) => {
          const version = page.sharing!.version;
          const audience = target.audience.toLowerCase();
          return <div className="document-item" key={target.audience}>
            <div className="document-item-head"><strong>{target.audience}</strong>
              <span className="pill">{target.visible ? "Shared" : target.grantId ? "Access ended" : "Private"}</span></div>
            <p className="muted">{target.recipient?.name ?? `An active ${audience} portal link is needed.`}</p>
            {target.firstDownloadedAt && <p className="muted">First PDF request {dateTime(target.firstDownloadedAt)} ET</p>}
            <div className="loan-application-actions">
              {page.sharing!.canPublish && target.recipient && !target.visible && publishing !== target.audience &&
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFeedback(undefined); setPublishing(target.audience); }}>
                  Share with {audience}
                </Button>}
              {target.grantId && <Button size="sm" variant="outline" disabled={busy}
                onClick={() => void perform({ type: "withdraw", loanId, version, audience: target.audience, grantId: target.grantId })}>
                Withdraw {audience} access
              </Button>}
            </div>
            {page.sharing!.canPublish && target.recipient && publishing === target.audience &&
              <form className="record-form" onSubmit={(event) => publish(event, target, version)}>
                <label className="demo-confirm"><input type="checkbox" name="permission" required disabled={busy} />
                  <span>I have permission to share this fictional letter with {target.recipient.name}.</span></label>
                <div className="loan-application-actions">
                  <Button type="submit" size="sm" disabled={busy}>Publish to {audience} portal</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setPublishing(undefined)}>Cancel</Button>
                </div>
              </form>}
          </div>;
        })}
      </section>}
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
