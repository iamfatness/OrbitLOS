"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { pilotFeedbackStatuses, pilotPriorities, pilotSteps, type VersionedBrokerageMember } from "@/lib/brokerage-model";
import type { PilotSupportRequest, PilotSupportRequestPage } from "@/lib/pilot-support-request-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { PilotSupportGrantManager, PilotSupportShared } from "./pilot-support-access";

type StatusFilter = "" | PilotSupportRequest["status"];
type Cursor = PilotSupportRequestPage["next"];

async function requestPage(endpoint: string, query: URLSearchParams, signal?: AbortSignal): Promise<PilotSupportRequestPage> {
  query.set("view", "pilot-support-requests");
  const response = await fetch(`${endpoint}&${query}`, { signal, cache: "no-store" });
  const result = await response.json().catch(() => null) as PilotSupportRequestPage | { error: string } | null;
  if (!response.ok || !result || !("kind" in result) || result.kind !== "pilotSupportRequests") {
    throw new Error(result && "error" in result ? result.error : "Could not load support requests. Try again.");
  }
  return result;
}

async function saveRequest(endpoint: string, input: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok || !result?.message) throw new Error(result?.error ?? "Could not confirm the save. Try again.");
}

function ownerLabel(item: PilotSupportRequest) {
  return item.ownerName ?? (item.needsOwner ? "Needs assignment" : "Unassigned");
}

export function PilotSupportRequests({ endpoint, admin, members, refreshMembers }: {
  endpoint: string; admin: boolean; members: VersionedBrokerageMember[]; refreshMembers: () => Promise<unknown>;
}) {
  const [filter, setFilter] = useState<StatusFilter>("");
  const [page, setPage] = useState<PilotSupportRequestPage>();
  const [load, setLoad] = useState({ generation: 0, after: null as Cursor });
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [intakeError, setIntakeError] = useState("");
  const [notice, setNotice] = useState("");
  const [shared, setShared] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const filterControl = useRef<HTMLSelectElement>(null);
  const intakeAlert = useRef<HTMLParagraphElement>(null);
  const returnControl = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (filter) query.set("status", filter);
    if (load.after) {
      query.set("afterId", load.after.id);
      query.set("afterCreatedAt", load.after.createdAt);
    }
    requestPage(endpoint, query, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setPage(previous => load.after && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
      setListError("");
    }).catch((failure: Error) => { if (!controller.signal.aborted) setListError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [endpoint, filter, load]);

  useEffect(() => { if (intakeError) intakeAlert.current?.focus(); }, [intakeError]);

  function refreshList(after: Cursor = null) {
    setListError("");
    setListLoading(true);
    setLoad(previous => ({ generation: previous.generation + 1, after }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const step = data.get("step");
    const message = String(data.get("message") ?? "").trim();
    if (!message) { setIntakeError("Describe what happened."); return; }
    const key = JSON.stringify([step, message]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    const { id } = attempt.current;
    setSaving(true);
    setIntakeError("");
    setNotice("");
    try {
      await saveRequest(endpoint, { type: "pilotFeedback", id, step, message });
      attempt.current = null;
      form.reset();
      returnControl.current = null;
      setNotice("Support request saved.");
      setSelected(id);
      refreshList();
    } catch (failure) { setIntakeError(failure instanceof Error ? failure.message : "Could not save this request."); }
    finally { setSaving(false); }
  }

  return <section className="pipeline relationship-panel pilot-support-requests" aria-labelledby="pilot-support-title">
    <div className="section-heading"><h2 id="pilot-support-title">{admin ? "Support requests" : "My support requests"}</h2></div>
    <form className="record-form" aria-label="New support request" onSubmit={submit}>
      <h3>Report a pilot issue</h3>
      <p className="muted">Use fictional examples. Keep borrower details, links, and documents out of requests.</p>
      <label className="field">Workflow step<select name="step" defaultValue="" required disabled={saving}>
        <option value="" disabled>Choose a step</option>
        {pilotSteps.map(step => <option key={step}>{step}</option>)}
      </select></label>
      <label className="field">What happened<textarea name="message" rows={3} maxLength={1000} required disabled={saving} /></label>
      <div className="loan-application-actions"><Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Submit request"}</Button></div>
      {intakeError && <p ref={intakeAlert} tabIndex={-1} className="application-message banner-error" role="alert">{intakeError}</p>}
      {notice && <p className="application-message" role="status">{notice}</p>}
    </form>
    {selected && <RequestDetails key={selected} id={selected} endpoint={endpoint} members={members} refreshMembers={refreshMembers} onSaved={refreshList}
      onClose={() => {
        setSelected(undefined);
        const target = returnControl.current;
        if (target?.isConnected) target.focus();
        else filterControl.current?.focus();
      }} />}
    {!admin && <details className="pilot-support-access" onToggle={event => setShared(event.currentTarget.open)}>
      <summary>Shared with me</summary>
      {shared && <PilotSupportShared endpoint={endpoint} />}
    </details>}
    <div className="record-form">
      <div className="document-item-head"><h3>{admin ? "Brokerage requests" : "Your requests"}</h3>
        <Button type="button" size="sm" variant="outline" disabled={listLoading} onClick={() => refreshList()}>Refresh list</Button>
      </div>
      <label className="field">Request status<select ref={filterControl} value={filter} onChange={event => {
        setPage(undefined);
        setFilter(event.target.value as StatusFilter);
        refreshList();
      }}>
        <option value="">All statuses</option>
        {pilotFeedbackStatuses.map(status => <option key={status}>{status}</option>)}
      </select></label>
      {listError && <p className="application-message banner-error" role="alert">{listError}</p>}
      {listLoading && <p role="status" className="muted">Loading requests…</p>}
      {page?.items.length === 0 && <p className="muted">{filter ? "No requests match this status." : "No support requests yet."}</p>}
      {!!page?.items.length && <ul className="document-list" aria-label="Support request results">
        {page.items.map(item => <li className="document-item" key={item.id}>
          <div className="document-item-head"><strong>{item.step}</strong><span className="pill">{item.status}</span></div>
          <p style={{ overflowWrap: "anywhere" }}>{item.message.length > 160 ? `${item.message.slice(0, 160)}…` : item.message}</p>
          <p className="muted">{ownerLabel(item)} · {dateTime(item.updatedAt)}</p>
          <div className="loan-application-actions">
            <Button type="button" size="sm" variant="outline" aria-expanded={selected === item.id}
              aria-label={`View request for ${item.step}`} onClick={event => {
                returnControl.current = event.currentTarget;
                if (selected === item.id) document.getElementById("pilot-support-detail")?.focus();
                else setSelected(item.id);
              }}>View request</Button>
          </div>
        </li>)}
      </ul>}
      {page?.next && <div className="loan-application-actions">
        <Button type="button" size="sm" variant="outline" disabled={listLoading} onClick={() => refreshList(page.next)}>Load more requests</Button>
      </div>}
    </div>
  </section>;
}

function RequestDetails({ id, endpoint, members, refreshMembers, onSaved, onClose }: {
  id: string; endpoint: string; members: VersionedBrokerageMember[]; refreshMembers: () => Promise<unknown>;
  onSaved: () => void; onClose: () => void;
}) {
  const [item, setItem] = useState<PilotSupportRequest>();
  const [editRevision, setEditRevision] = useState<number>();
  const [formVersion, setFormVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [grantControls, setGrantControls] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailAlert = useRef<HTMLParagraphElement>(null);
  const detailNotice = useRef<HTMLParagraphElement>(null);
  const staleChoice = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    heading.current?.focus();
    requestPage(endpoint, new URLSearchParams({ id }), controller.signal).then(page => {
      if (controller.signal.aborted) return;
      const request = page.items[0];
      setItem(request);
      setEditRevision(request?.triage?.revision);
      if (!request) setError("This request is unavailable in this workspace.");
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, id]);

  useEffect(() => { if (error) detailAlert.current?.focus(); }, [error]);
  useEffect(() => { if (notice && !loading && !saving && !error) detailNotice.current?.focus(); }, [notice, loading, saving, error]);

  async function refresh(resetForm: boolean) {
    setLoading(true);
    setError("");
    try {
      const page = await requestPage(endpoint, new URLSearchParams({ id }));
      const latest = page.items[0];
      if (!latest) { setItem(undefined); throw new Error("This request is unavailable in this workspace."); }
      setItem(latest);
      if (resetForm || !item) {
        setEditRevision(latest.triage?.revision);
        setFormVersion(previous => previous + 1);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not refresh this request."); }
    finally { setLoading(false); }
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveRequest(endpoint, {
        type: "triagePilotFeedback", id, revision: editRevision, owner: fields.get("owner") || null,
        status: fields.get("status"), priority: fields.get("priority"), retest: fields.get("retest"),
        requesterUpdate: fields.get("requesterUpdate"),
      });
      setNotice("Support request updated.");
      onSaved();
      await refresh(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update this request."); }
    finally { setSaving(false); }
  }

  const triage = item?.triage;
  const changed = Boolean(triage && triage.revision !== editRevision);
  useEffect(() => { if (changed && !loading) staleChoice.current?.focus(); }, [changed, loading]);
  return <section className="document-item record-form" aria-labelledby="pilot-support-detail">
    <div className="document-item-head"><h3 ref={heading} id="pilot-support-detail" tabIndex={-1}>{item?.step ?? "Support request details"}</h3>
      {item && <span className="pill">{item.status}</span>}
    </div>
    {loading && <p className="muted" role="status">Loading request…</p>}
    {error && <p ref={detailAlert} tabIndex={-1} className="application-message banner-error" role="alert">{error}</p>}
    {notice && <p ref={detailNotice} tabIndex={-1} className="application-message" role="status">{notice}</p>}
    {item && <>
      <p style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{item.message}</p>
      <p className="muted">Owner {ownerLabel(item)} · {item.priority} priority · Updated {dateTime(item.updatedAt)}</p>
      {triage && <p className="muted" style={{ overflowWrap: "anywhere" }}>Submitted by {triage.author}</p>}
      {item.requesterUpdate && <div><strong>Update for requester</strong>
        <p style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{item.requesterUpdate}</p></div>}
    </>}
    <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={saving || loading} onClick={() => void refresh(false)}>Refresh request</Button>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onClose}>Back to requests</Button>
    </div>
    {item && triage && <details className="pilot-support-access" onToggle={event => setGrantControls(event.currentTarget.open)}>
      <summary>Temporary support access</summary>
      {grantControls && <PilotSupportGrantManager endpoint={endpoint} requestId={id} members={members} refreshMembers={refreshMembers} />}
    </details>}
    {item && triage && <form key={formVersion} className="record-form" aria-label="Update support request" onSubmit={event => {
      if (changed) event.preventDefault();
      else void update(event);
    }}>
      <div className="form-grid pilot-support-assignment">
        <label className="field">Request owner<select name="owner" defaultValue={item.ownerName ? triage.owner ?? "" : ""} disabled={saving || loading}>
          <option value="">Unassigned</option>
          {members.map(member => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
        </select></label>
        <label className="field">Priority<select name="priority" defaultValue={item.priority} disabled={saving || loading}>
          {pilotPriorities.map(priority => <option key={priority}>{priority}</option>)}
        </select></label>
        <label className="field">Status<select name="status" defaultValue={item.status} disabled={saving || loading}>
          {pilotFeedbackStatuses.map(status => <option key={status}>{status}</option>)}
        </select></label>
      </div>
      <div className="form-grid pilot-support-notes">
        <label className="field">Update visible to requester<textarea name="requesterUpdate" rows={3} maxLength={500}
          defaultValue={item.requesterUpdate} disabled={saving || loading} /></label>
        <div>
          <label className="field">Internal retest result<textarea name="retest" rows={3} maxLength={500} defaultValue={triage.retest}
            aria-describedby="pilot-support-retest-hint" disabled={saving || loading} /></label>
          <p id="pilot-support-retest-hint" className="muted">Visible to admins. Required when closing a request.</p>
        </div>
      </div>
      {changed && <>
        <p className="muted" role="status">The saved request changed. Review the current status above before keeping your draft.</p>
        {triage.retest && <p style={{ overflowWrap: "anywhere" }}>Saved internal retest result: {triage.retest}</p>}
      </>}
      <div className="loan-application-actions">
        {changed ? <>
          <Button ref={staleChoice} type="button" size="sm" onClick={() => {
            setEditRevision(triage.revision);
            heading.current?.focus();
          }}>Keep my draft</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => {
            setEditRevision(triage.revision);
            setFormVersion(previous => previous + 1);
            heading.current?.focus();
          }}>Use saved version</Button>
        </> : <Button type="submit" size="sm" disabled={saving || loading}>{saving ? "Saving…" : "Save update"}</Button>}
      </div>
    </form>}
  </section>;
}
