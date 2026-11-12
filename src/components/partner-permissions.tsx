"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { partnerCheckMessages, partnerPermissions, type PartnerCheckResult, type PartnerGrant, type PartnerGrantDetail,
  type PartnerGrantPage, type PartnerPermission } from "@/lib/partner-access-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Response = PartnerGrantPage | PartnerGrantDetail | PartnerCheckResult;
const sampleLabels: Record<string, string> = {
  eventId: "Event ID", eventType: "Event type", source: "Source", leadId: "Lead ID", status: "Status",
  loanId: "Loan ID", stage: "Stage", nextAction: "Next action",
};

async function partnerRequest(endpoint: string, signal?: AbortSignal, action?: object): Promise<Response> {
  const response = await fetch(endpoint, { cache: "no-store", signal, ...(action ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
  } : {}) }).catch(() => { throw new Error("Could not confirm the request. Try again or refresh the grant list."); });
  const result = await response.json().catch(() => null) as Response | { error: string } | null;
  if (!response.ok || !result || !("kind" in result)) {
    throw new Error(result && "error" in result ? result.error : "Could not confirm the request. Refresh and try again.");
  }
  return result;
}

export function PartnerPermissions({ brokerageId }: { brokerageId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="uwm-deliveries automation-deliveries" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ShieldCheck size={19} aria-hidden="true" />
      <span><strong>Partner permissions</strong><small>Sandbox only</small></span>
      <ChevronDown className="uwm-disclosure-icon" size={17} aria-hidden="true" />
    </summary>
    {open && <PartnerGrantList brokerageId={brokerageId} />}
  </details>;
}

function PartnerGrantList({ brokerageId }: { brokerageId: string }) {
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=partner-permissions`;
  const [page, setPage] = useState<PartnerGrantPage>();
  const [read, setRead] = useState({ before: null as number | null, generation: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [approvedId, setApprovedId] = useState<string>();
  const opener = useRef<HTMLButtonElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    partnerRequest(endpoint + (read.before ? `&before=${read.before}` : ""), controller.signal).then(result => {
      if (controller.signal.aborted || result.kind !== "grants") return;
      setPage(previous => read.before && previous ? { ...result, grants: [...previous.grants, ...result.grants] } : result);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, read]);

  function refresh(before: number | null = null) {
    setError("");
    setLoading(true);
    setRead(previous => ({ before, generation: previous.generation + 1 }));
  }

  function close() {
    setCreating(false);
    setSelected(undefined);
    setApprovedId(undefined);
    if (activeButton.current?.isConnected) activeButton.current.focus();
    else opener.current?.focus();
  }

  return <div className="uwm-delivery-body record-form">
    <div className="document-item-head">
      <h3>Sandbox grants</h3>
      <div className="loan-application-actions">
        <Button type="button" size="sm" ref={opener} onClick={event => {
          activeButton.current = event.currentTarget;
          setSelected(undefined);
          setCreating(true);
        }}>New grant</Button>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => refresh()}>Refresh grants</Button>
      </div>
    </div>
    <p className="muted">Approve read permissions for a sandbox client. Checks return fictional records.</p>
    {creating && <GrantForm endpoint={endpoint} onClose={close} onSaved={grant => {
      setCreating(false);
      setSelected(grant.id);
      setApprovedId(grant.id);
      refresh();
    }} />}
    {selected && <GrantDetails key={selected} endpoint={endpoint} id={selected} recentlyApproved={approvedId === selected}
      onClose={close} onChanged={() => { setApprovedId(undefined); refresh(); }} />}
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {loading && <p className="muted" role="status">Loading grants…</p>}
    {!loading && !error && page?.grants.length === 0 && <p className="muted">Create a grant to rehearse partner access.</p>}
    {!!page?.grants.length && <ul className="document-list" aria-label="Partner grants">
      {page.grants.map(grant => <li key={grant.id} className="document-item">
        <div className="document-item-head"><strong>{grant.name}</strong><span className="pill">{grant.state}</span></div>
        <p className="muted">{grant.scopes.map(scope => partnerPermissions[scope].label).join(" · ")} · Expires {dateTime(grant.expiresAt)}</p>
        <div className="loan-application-actions"><Button type="button" size="sm" variant="outline" onClick={event => {
          activeButton.current = event.currentTarget;
          setCreating(false);
          if (selected === grant.id) document.getElementById("partner-grant-heading")?.focus();
          else setSelected(grant.id);
        }}>Open grant</Button></div>
      </li>)}
    </ul>}
    {page?.next != null && <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => refresh(page.next)}>Load older grants</Button>
    </div>}
  </div>;
}

function GrantForm({ endpoint, onClose, onSaved }: { endpoint: string; onClose: () => void; onSaved: (grant: PartnerGrant) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ id: string; key: string } | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const scopes = form.getAll("scope");
    if (!scopes.length) { setError("Choose at least one permission."); return; }
    const approval = { type: "approve", name: String(form.get("name")).trim(), scopes, expiresAt: `${form.get("expires")}T23:59:59.999Z` };
    const key = JSON.stringify(approval);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    setSaving(true);
    setError("");
    try {
      const result = await partnerRequest(endpoint, undefined, { ...approval, id: pending.current.id });
      if (result.kind !== "grant") throw new Error("Refresh the grant list to check the approval.");
      onSaved(result.grant);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not approve the grant."); }
    finally { setSaving(false); }
  }

  return <section className="document-item record-form" aria-labelledby="partner-grant-form">
    <h3 ref={heading} id="partner-grant-form" tabIndex={-1}>Approve sandbox permissions</h3>
    {error && <p ref={alert} tabIndex={-1} role="alert" className="application-message banner-error">{error}</p>}
    <form className="record-form" onSubmit={submit}>
      <label className="field automation-destination-name">Partner name<input name="name" required maxLength={80} disabled={saving} /></label>
      <label className="field partner-grant-date">Expiration date (UTC)<input type="date" name="expires" required
        min={new Date().toISOString().slice(0, 10)} disabled={saving} /></label>
      <fieldset className="automation-subscriptions" disabled={saving}>
        <legend>Read permissions</legend>
        {Object.entries(partnerPermissions).map(([scope, permission]) => <label className="automation-subscription" key={scope}>
          <input type="checkbox" name="scope" value={scope} /><span>{permission.label}</span>
        </label>)}
      </fieldset>
      <div className="loan-application-actions">
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Approving…" : "Approve grant"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onClose}>Cancel approval</Button>
      </div>
    </form>
  </section>;
}

function GrantDetails({ endpoint, id, recentlyApproved, onClose, onChanged }: {
  endpoint: string; id: string; recentlyApproved: boolean; onClose: () => void; onChanged: () => void;
}) {
  const target = `${endpoint}&id=${encodeURIComponent(id)}`;
  const [detail, setDetail] = useState<PartnerGrantDetail>();
  const [result, setResult] = useState<PartnerCheckResult>();
  const [scope, setScope] = useState<PartnerPermission>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [revoked, setRevoked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLButtonElement>(null);
  const pending = useRef<{ id: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    heading.current?.focus();
    partnerRequest(target, controller.signal).then(value => {
      if (!controller.signal.aborted && value.kind === "grant") setDetail(value);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [target]);
  useEffect(() => { if (error || revoked || result) feedback.current?.focus(); }, [error, revoked, result]);
  useEffect(() => { if (confirming) confirmation.current?.focus(); }, [confirming]);

  async function refresh(before: number | null = null) {
    setLoading(true);
    setError("");
    if (!before) setResult(undefined);
    try {
      const value = await partnerRequest(target + (before ? `&before=${before}` : ""));
      if (value.kind !== "grant") throw new Error("Could not open the grant history.");
      setDetail(previous => before && previous ? { ...value, checks: [...previous.checks, ...value.checks] } : value);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not refresh the grant."); }
    finally { setLoading(false); }
  }

  async function change(action: object) {
    if (saving || loading) return;
    const key = JSON.stringify(action);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    setSaving(true);
    setError("");
    setResult(undefined);
    setRevoked(false);
    try {
      const value = await partnerRequest(endpoint, undefined, { ...action, id, operationId: pending.current.id });
      if (value.kind === "check") {
        setResult(value);
        if (detail?.grant.state !== value.grant.state) onChanged();
        setDetail(previous => previous ? { ...previous, grant: value.grant,
          checks: [value.check, ...previous.checks.filter(check => check.id !== value.check.id)] } : previous);
      } else if (value.kind === "grant") {
        setDetail(value);
        setConfirming(false);
        setRevoked(true);
        onChanged();
      }
      pending.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save the permission decision."); }
    finally { setSaving(false); }
  }

  const grant = detail?.grant;
  const selectedScope = scope ?? grant?.scopes[0] ?? "events.read";
  return <section className="document-item record-form" aria-labelledby="partner-grant-heading">
    <div className="document-item-head">
      <h3 ref={heading} id="partner-grant-heading" tabIndex={-1}>{grant?.name ?? "Sandbox grant"}</h3>
      {grant && <span className="pill">{grant.state}</span>}
    </div>
    {error && <p ref={feedback} tabIndex={-1} role="alert" className="application-message banner-error">{error}</p>}
    {loading && <p className="muted" role="status">Loading grant…</p>}
    {recentlyApproved && !revoked && !result && !error && <p role="status" className="application-message">Sandbox grant approved.</p>}
    {revoked && <p ref={feedback} tabIndex={-1} role="status" className="application-message">Grant revoked. Prior checks remain available.</p>}
    {grant && <>
      <p><strong>{grant.scopes.map(value => partnerPermissions[value].label).join(" · ")}</strong></p>
      <p className="muted">Approved by {grant.approvedBy} · {dateTime(grant.approvedAt)} · Expires {dateTime(grant.expiresAt)}</p>
      {grant.revokedAt && <p className="muted">Revoked by {grant.revokedBy} · {dateTime(grant.revokedAt)}</p>}
      <div className="record-form">
        <label className="field automation-destination-name">Permission to check<select value={selectedScope} disabled={saving || loading}
          onChange={event => { setScope(event.target.value as PartnerPermission); setResult(undefined); }}>
          {Object.entries(partnerPermissions).map(([key, permission]) => <option key={key} value={key}>{permission.label}</option>)}
        </select></label>
        <div className="loan-application-actions">
          <Button type="button" size="sm" disabled={saving || loading || confirming} onClick={() =>
            void change({ type: "check", clientId: grant.clientId, scope: selectedScope })}>{saving ? "Checking…" : "Run sandbox check"}</Button>
        </div>
        {result && <div className="record-form">
          <p ref={feedback} tabIndex={-1} role="status" className="application-message">
            <strong>{result.check.decision === "Allowed" ? "Allowed" : "Denied"} · </strong>{partnerCheckMessages[result.check.decision]}
          </p>
          {result.sample && <dl className="details-grid partner-sandbox-sample">
            {Object.entries(result.sample).map(([field, value]) => <div key={field}><dt>{sampleLabels[field] ?? field}</dt><dd>{value}</dd></div>)}
          </dl>}
        </div>}
      </div>
      {grant.revision === 1 && (confirming ? <div className="record-form">
        <p>Revoke this grant? Future sandbox checks will be denied and prior checks will remain available.</p>
        <div className="loan-application-actions">
          <Button ref={confirmation} type="button" size="sm" variant="danger" disabled={saving}
            onClick={() => void change({ type: "revoke", revision: grant.revision })}>Confirm revocation</Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => {
            setConfirming(false);
            requestAnimationFrame(() => revokeButton.current?.focus());
          }}>Cancel revocation</Button>
        </div>
      </div> : <div className="loan-application-actions"><Button ref={revokeButton} type="button" size="sm" variant="outline"
        disabled={saving || loading} onClick={() => setConfirming(true)}>Revoke grant</Button></div>)}
      <h4>Check history</h4>
      {!!detail.checks.length ? <ul className="automation-attempts">{detail.checks.map(check => <li key={check.id}>
        <strong>{partnerPermissions[check.scope].label} · {check.decision}</strong>
        <span className="muted">{dateTime(check.at)} · {check.actor}</span>
      </li>)}</ul> : <p className="muted">Run a sandbox check to record its decision.</p>}
      {detail.next != null && <div className="loan-application-actions">
        <Button type="button" size="sm" variant="outline" disabled={saving || loading} onClick={() => void refresh(detail.next)}>Load older checks</Button>
      </div>}
    </>}
    <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={saving || loading} onClick={() => void refresh()}>Refresh grant</Button>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onClose}>Back to grants</Button>
    </div>
  </section>;
}
