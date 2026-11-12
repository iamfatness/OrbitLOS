"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { VersionedBrokerageMember } from "@/lib/brokerage-model";
import { pilotSupportAccessHours, type PilotSupportAccessInput, type PilotSupportAccessResult, type PilotSupportGrant,
  type PilotSupportGrantOffer, type PilotSupportSharedSummary } from "@/lib/pilot-support-access-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

async function accessRequest(endpoint: string, action: PilotSupportAccessInput, signal?: AbortSignal) {
  const path = endpoint + "&view=pilot-support-access";
  const options = { cache: "no-store" as const, signal };
  const request = action.type === "mine" ? fetch(path, options) :
    action.type === "manage" ? fetch(`${path}&requestId=${action.requestId}`, options) :
    fetch(path, { ...options, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const response = await request.catch(() => { throw new Error("Orbit could not confirm support access. Try again."); });
  const result = await response.json().catch(() => null) as PilotSupportAccessResult | null;
  if (!response.ok || !result || "error" in result) {
    throw new Error(result && "error" in result ? result.error : "Orbit could not confirm support access. Try again.");
  }
  return result;
}

export function PilotSupportGrantManager({ endpoint, requestId, members, refreshMembers }: {
  endpoint: string; requestId: string; members: VersionedBrokerageMember[]; refreshMembers: () => Promise<unknown>;
}) {
  const [grants, setGrants] = useState<PilotSupportGrant[]>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string>();
  const [load, setLoad] = useState(0);
  const attempt = useRef<{ key: string; grantId: string } | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const revokeButton = useRef<HTMLButtonElement | null>(null);
  const reviewers = members.filter(member => member.status === "Active" && member.role !== "Admin" && member.accessRevision !== undefined);

  useEffect(() => {
    const controller = new AbortController();
    accessRequest(endpoint, { type: "manage", requestId }, controller.signal).then(result => {
      if (!controller.signal.aborted && result.kind === "manage") setGrants(result.grants);
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load the access history. Refresh access to try again."); });
    return () => controller.abort();
  }, [endpoint, requestId, load]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (notice) feedback.current?.focus(); }, [notice]);

  async function save(action: PilotSupportAccessInput, reset?: () => void) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessRequest(endpoint, action);
      if (result.kind !== "saved") throw new Error("Refresh access to check the change.");
      reset?.();
      setRevoking(undefined);
      setNotice(result.message);
      setLoad(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Orbit could not confirm the change. Try again.");
    } finally { setBusy(false); }
  }

  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const reviewer = reviewers.find(member => member.email === fields.get("reviewer"));
    const hours = pilotSupportAccessHours.find(value => value === Number(fields.get("hours")));
    if (!reviewer || reviewer.accessRevision === undefined || hours === undefined) return;
    const approval = { type: "approve" as const, requestId, reviewer: reviewer.email, reviewerRevision: reviewer.accessRevision, hours };
    const key = JSON.stringify(approval);
    if (attempt.current?.key !== key) attempt.current = { key, grantId: crypto.randomUUID() };
    void save({ ...approval, grantId: attempt.current.grantId }, () => {
      attempt.current = null;
      form.reset();
    });
  }

  async function refresh() {
    setBusy(true);
    setError("");
    setNotice("");
    try { await refreshMembers(); }
    catch { setError("Could not refresh the reviewer list. Try again."); }
    finally { setLoad(value => value + 1); setBusy(false); }
  }

  return <div className="record-form pilot-support-access-body">
    <p className="muted">Share this request’s workflow step, status, priority and dates with one active pilot reviewer.</p>
    {error && <p ref={alert} tabIndex={-1} role="alert" className="application-message banner-error">{error}</p>}
    {notice && <p ref={feedback} tabIndex={-1} role="status" className="application-message">{notice}</p>}
    {!grants && !error && <p role="status" className="muted">Loading access history…</p>}
    <form className="record-form" aria-label="Approve temporary support access" onSubmit={approve}>
      <div className="form-grid pilot-support-access-fields">
        <label className="field">Reviewer<select name="reviewer" required defaultValue="" disabled={busy || !reviewers.length}>
          <option value="" disabled>Choose an active LO or processor</option>
          {reviewers.map(member => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
        </select></label>
        <label className="field">Access duration<select name="hours" defaultValue="4" disabled={busy}>
          {pilotSupportAccessHours.map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? "hour" : "hours"}</option>)}
        </select></label>
      </div>
      {!reviewers.length && <p className="muted">Invite an LO or processor and have them sign in to add a reviewer.</p>}
      <div className="loan-application-actions">
        <Button type="submit" size="sm" className="min-h-11" disabled={busy || !reviewers.length}>Approve access</Button>
        <Button type="button" size="sm" className="min-h-11" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh access</Button>
      </div>
    </form>
    {grants && (grants.length ? <ul className="document-list" aria-label="Support access history">
      {grants.map(grant => <li key={grant.id} className="document-item record-form">
        <div className="document-item-head"><strong>{grant.reviewer}</strong><span className="pill">{grant.status}</span></div>
        <p className="muted">Approved by {grant.approver} · {dateTime(grant.approvedAt)}</p>
        <p className="muted">Expires {dateTime(grant.expiresAt)} · {grant.openCount} {grant.openCount === 1 ? "view" : "views"}
          {grant.lastOpenedAt && ` · Last viewed ${dateTime(grant.lastOpenedAt)}`}</p>
        {grant.revokedAt && <p className="muted">Revoked by {grant.revokedBy} · {dateTime(grant.revokedAt)}</p>}
        {grant.status === "Active" && <div className="loan-application-actions">
          {revoking === grant.id ? <>
            <p>End access for {grant.reviewer}?</p>
            <Button type="button" size="sm" className="min-h-11" autoFocus disabled={busy}
              onClick={() => void save({ type: "revoke", requestId, grantId: grant.id })}>Confirm revocation</Button>
            <Button type="button" size="sm" className="min-h-11" variant="outline" disabled={busy} onClick={() => {
              setRevoking(undefined);
              requestAnimationFrame(() => revokeButton.current?.focus());
            }}>Keep access</Button>
          </> : <Button type="button" size="sm" className="min-h-11" variant="outline" disabled={busy}
            ref={button => { if (button && (revokeButton.current?.dataset.grant === grant.id || !revokeButton.current)) revokeButton.current = button; }}
            data-grant={grant.id} onClick={event => { revokeButton.current = event.currentTarget; setRevoking(grant.id); }}>Revoke access</Button>}
        </div>}
      </li>)}
    </ul> : <p className="muted">No access approvals for this request yet.</p>)}
  </div>;
}

export function PilotSupportShared({ endpoint }: { endpoint: string }) {
  const [offers, setOffers] = useState<PilotSupportGrantOffer[]>();
  const [selection, setSelection] = useState<{ grantId: string; summary: PilotSupportSharedSummary }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ grantId: string; openId: string } | null>(null);
  const readOffers = useCallback(async (signal?: AbortSignal) => {
    const result = await accessRequest(endpoint, { type: "mine" }, signal);
    if (signal?.aborted || result.kind !== "mine") return;
    setOffers(result.offers);
    setSelection(current => current && result.offers.some(offer => offer.id === current.grantId) ? current : undefined);
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    accessRequest(endpoint, { type: "mine" }, controller.signal).then(result => {
      if (!controller.signal.aborted && result.kind === "mine") setOffers(result.offers);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load shared requests. Refresh to try again.");
    });
    return () => controller.abort();
  }, [endpoint]);
  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    const recheck = () => void readOffers(controller.signal).catch(() => {
      if (!controller.signal.aborted) {
        setSelection(undefined);
        setError("Could not verify access. Refresh shared requests to try again.");
      }
    });
    const expires = window.setTimeout(() => {
      setSelection(undefined);
      recheck();
    }, Math.max(0, new Date(selection.summary.expiresAt).getTime() - Date.now()));
    const interval = window.setInterval(recheck, 30_000);
    window.addEventListener("focus", recheck);
    return () => { controller.abort(); window.clearTimeout(expires); window.clearInterval(interval); window.removeEventListener("focus", recheck); };
  }, [selection, readOffers]);
  useEffect(() => { if (selection) heading.current?.focus(); }, [selection]);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);

  async function open(grantId: string, button: HTMLButtonElement) {
    if (attempt.current?.grantId !== grantId) attempt.current = { grantId, openId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setSelection(undefined);
    opener.current = button;
    try {
      const result = await accessRequest(endpoint, { type: "open", ...attempt.current });
      if (result.kind !== "summary") throw new Error("Refresh shared requests before opening this summary.");
      setSelection({ grantId, summary: result.summary });
      attempt.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not open this summary."); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    setSelection(undefined);
    try { await readOffers(); }
    catch { setError("Could not load shared requests. Try again."); }
    finally { setBusy(false); }
  }

  return <div className="record-form pilot-support-access-body">
    <div className="loan-application-actions"><Button ref={refreshButton} type="button" size="sm" className="min-h-11"
      variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh shared requests</Button></div>
    {error && <p ref={errorMessage} tabIndex={-1} role="alert" className="application-message banner-error">{error}</p>}
    {!offers && !error && <p role="status" className="muted">Loading shared requests…</p>}
    {offers?.length === 0 && <p className="muted">No support summaries are currently shared with you.</p>}
    {selection && <section className="document-item record-form" aria-labelledby="shared-support-summary">
      <div className="document-item-head"><h4 id="shared-support-summary" ref={heading} tabIndex={-1}>{selection.summary.step}</h4>
        <span className="pill">{selection.summary.status}</span></div>
      <p>{selection.summary.priority} priority · Updated {dateTime(selection.summary.updatedAt)}</p>
      <p className="muted">Submitted {dateTime(selection.summary.createdAt)} · Access expires {dateTime(selection.summary.expiresAt)}</p>
      <p className="muted">Access recorded {dateTime(selection.summary.openedAt)}</p>
      <div className="loan-application-actions"><Button type="button" size="sm" className="min-h-11" variant="outline" onClick={() => {
        setSelection(undefined);
        if (opener.current?.isConnected) opener.current.focus();
        else refreshButton.current?.focus();
      }}>Back to shared requests</Button></div>
    </section>}
    {!!offers?.length && <ul className="document-list" aria-label="Shared support summaries">
      {offers.map(offer => <li key={offer.id} className="document-item record-form">
        <div className="document-item-head"><strong>{offer.step}</strong><span className="muted">Expires {dateTime(offer.expiresAt)}</span></div>
        <div className="loan-application-actions"><Button type="button" size="sm" className="min-h-11" variant="outline" disabled={busy}
          onClick={event => void open(offer.id, event.currentTarget)}>Open summary</Button></div>
      </li>)}
    </ul>}
  </div>;
}
