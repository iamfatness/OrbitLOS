"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { dateLabel } from "@/lib/client-retention";
import { preapprovalAmount, preapprovalDemoLabel, preapprovalScopes, type PreapprovalAudience, type PreapprovalPage, type PreapprovalPreview,
  type PreapprovalScope, type PreapprovalShareState } from "@/lib/preapproval-model";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";
import { preapprovalRequest } from "./preapproval-client";

type LetterDraft = { amount: string; expiresOn: string; scope: PreapprovalScope; templateId: string };

export function PreapprovalLetters({ loanId, brokerageId, revision }: { loanId: string; brokerageId: string; revision?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [beforeVersion, setBeforeVersion] = useState<number>();
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ beforeVersion?: number; revision?: number; refresh: number; page?: PreapprovalPage; error?: string }>();
  const [draft, setDraft] = useState<LetterDraft>();
  const [preview, setPreview] = useState<{ key: string; letter: PreapprovalPreview }>();
  const [publishing, setPublishing] = useState<PreapprovalAudience>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  const saving = useRef(false);
  const attempt = useRef<{ key: string; id: string }>(null);
  const shareAttempt = useRef<{ key: string; id: string }>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void preapprovalRequest(brokerageId, { type: "read", loanId, beforeVersion }, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setResult({ beforeVersion, revision, refresh, ...("page" in value ? { page: value.page } :
        { error: "error" in value ? value.error : "Could not load letters." }) });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ beforeVersion, revision, refresh, error: "Could not load letters. Try refreshing." });
    });
    return () => controller.abort();
  }, [brokerageId, loanId, expanded, revision, beforeVersion, refresh]);
  useEffect(() => { if (preview) previewHeading.current?.focus(); }, [preview]);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);

  const current = result?.beforeVersion === beforeVersion && result?.revision === revision && result?.refresh === refresh ? result : undefined;
  const page = current?.page;
  const issue = page && !("blocked" in page.issue) ? page.issue : undefined;
  const template = page?.templates?.find(({ id }) => id === draft?.templateId);
  const canPreview = !draft?.templateId || Boolean(template);
  const terms = draft && page && issue && canPreview ? { loanId, previousVersion: page.latestVersion,
    applicationRevision: issue.applicationRevision, amountCents: Math.round(Number(draft.amount) * 100),
    scope: draft.scope, expiresOn: draft.expiresOn, ...(template ? { template: { id: template.id, revision: template.revision } } : {}) } : undefined;
  const previewKey = terms ? JSON.stringify(terms) : "";
  const letter = preview?.key === previewKey ? preview.letter : undefined;
  function editDraft(update: Partial<LetterDraft>) {
    setDraft((currentDraft) => currentDraft && { ...currentDraft, ...update });
    setPreview(undefined);
    setFeedback(undefined);
  }
  async function perform(input: object, requestedPreviewKey?: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const value = await preapprovalRequest(brokerageId, input);
      if ("error" in value) { setFeedback({ message: value.error, error: true }); return; }
      if ("pdf" in value) {
        downloadSampleFile(value.pdf, value.filename, "application/pdf");
      } else if ("preview" in value && requestedPreviewKey) {
        setPreview({ key: requestedPreviewKey, letter: value.preview });
      } else if ("page" in value) {
        setResult({ beforeVersion, revision, refresh, page: value.page });
        setDraft(undefined);
        setPreview(undefined);
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
    if (!terms || saving.current) return;
    if (!letter) { void perform({ type: "preview", ...terms }, previewKey); return; }
    if (!new FormData(event.currentTarget).has("confirmed")) return;
    const input = { type: "issue", ...terms, previewStamp: letter.stamp, confirmed: true };
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
      {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
      {page?.letters.length ? <ul className="loan-task-list">{page.letters.map((letter) => <li className="loan-task" key={letter.version}>
        <div className="loan-task-copy"><strong>Version {letter.version} · {preapprovalAmount(letter.amountCents)}</strong>
          <span>{letter.status} · {letter.scope} · Expires {dateLabel(letter.expiresOn)}</span>
          <span>{letter.issuer} · {dateTime(letter.issuedAt)} ET · 1003 revision {letter.applicationRevision}</span>
          {letter.template && <span>{letter.template.title} · Template v{letter.template.revision}</span>}
        </div>
        <Button size="sm" variant="outline" disabled={busy} aria-label={`Download sample letter v${letter.version} PDF`}
          onClick={() => void perform({ type: "download", loanId, version: letter.version })}><Download /> PDF</Button>
      </li>)}</ul> : page && <p className="empty-inline">No sample letters issued yet.</p>}
      <div className="loan-application-actions">
        {beforeVersion && <Button size="sm" variant="outline" disabled={busy} onClick={() => setBeforeVersion(undefined)}>Latest letters</Button>}
        {page?.beforeVersion && <Button size="sm" variant="outline" disabled={busy} onClick={() => setBeforeVersion(page.beforeVersion!)}>Older letters</Button>}
        {(page || current?.error) && <Button size="sm" variant="outline" disabled={busy} onClick={() => {
          setPreview(undefined); setPublishing(undefined); setFeedback(undefined); setBeforeVersion(undefined); setRefresh((value) => value + 1);
        }}>Refresh letters</Button>}
        {issue && !beforeVersion && !draft && <Button size="sm" disabled={busy} onClick={() => {
          setDraft({ amount: String(issue.amountCents / 100), expiresOn: issue.suggestedExpiry, scope: "Property search", templateId: "" });
        }}>
          {page?.latestVersion ? "Prepare a new version" : "Prepare sample letter"}
        </Button>}
      </div>
      {page && !beforeVersion && "blocked" in page.issue && <p className="muted">{page.issue.blocked}</p>}
      {page?.sharing && !draft && <section className="record-form" aria-label="Share current sample letter">
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
      {issue && draft && !beforeVersion && <form className="record-form preapproval-issue" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">Sample loan amount<input type="number" min="0.01" max={issue.amountCents / 100}
            step="0.01" value={draft.amount} onChange={(event) => editDraft({ amount: event.target.value })} required disabled={busy} /></label>
          <label className="field">Expires on (Eastern)<input type="date" min={issue.earliestExpiry}
            max={issue.latestExpiry} value={draft.expiresOn} onChange={(event) => editDraft({ expiresOn: event.target.value })} required disabled={busy} /></label>
          <label className="field">Property scope<select value={draft.scope} disabled={busy} onChange={(event) => editDraft({ scope: event.target.value as PreapprovalScope })}>
            {preapprovalScopes.map((scope) => <option key={scope} disabled={scope === "Subject property" && !issue.property}>{scope}</option>)}
          </select></label>
          {(!!page?.templates?.length || !!draft.templateId) && <label className="field">Sample letter template<select value={draft.templateId}
            disabled={busy} onChange={(event) => editDraft({ templateId: event.target.value })}>
            <option value="">Orbit sample letter</option>
            {page?.templates?.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.revision}</option>)}
            {!canPreview && <option value={draft.templateId}>Template unavailable</option>}
          </select></label>}
        </div>
        {issue.property && <p className="muted">Reviewed subject property · {issue.property}</p>}
        {!canPreview && <p className="muted">Choose an active template to preview this letter.</p>}
        {letter && <section className="document-item" aria-label="Sample letter preview">
          <h3 ref={previewHeading} tabIndex={-1}>Sample letter preview</h3>
          <p className="muted">{preapprovalDemoLabel}</p>
          <p><strong>{preapprovalAmount(letter.amountCents)}</strong> · Expires {dateLabel(letter.expiresOn)} ET</p>
          <p>{letter.names.join(", ")}</p>
          <p>{letter.property ?? "Property search · No address specified"}</p>
          <p>{letter.issuer} · {letter.brokerage}</p>
          <p className="muted">Letter v{letter.version} · {dateLabel(letter.issuedOn)}
            {letter.template && ` · ${letter.template.title} · Template v${letter.template.revision}`}</p>
          {letter.template?.note && <p>{letter.template.note}</p>}
          <label className="demo-confirm"><input name="confirmed" type="checkbox" required disabled={busy} />
            <span>I reviewed this fictional letter before issuing it.</span></label>
        </section>}
        <div className="loan-application-actions">
          <Button type="submit" size="sm" disabled={busy || !canPreview}>{letter ? "Issue sample letter" : "Preview sample letter"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(undefined); setPreview(undefined); setFeedback(undefined); }}>Cancel</Button>
        </div>
      </form>}
    </section>}
  </details>;
}
