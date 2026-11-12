"use client";

import { useEffect, useRef, useState } from "react";
import type { BrokerageMember } from "@/lib/brokerage-model";
import { departureKinds, type DepartureItem, type DeparturePage, type OffboardingInput } from "@/lib/offboarding-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Preview = Extract<OffboardingInput, { type: "offboardingPreview" }>;

async function request<T>(endpoint: string, input: OffboardingInput, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Orbit could not load or save offboarding work.");
  return result;
}

function WorkRow({ row, teammates, busy, transfer, open }: {
  row: DepartureItem; teammates: BrokerageMember[]; busy: boolean; transfer: (row: DepartureItem, email: string | null) => void; open: () => void;
}) {
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const review = row.kind === "Reviewer" || row.kind === "Review requester";
  const branchDefault = row.kind === "Branch default";
  const intake = branchDefault || row.kind === "Realtor link" || row.kind === "Intake route";
  const removeLabel = review ? "Cancel review" : "Unassign processor";
  const removeExplanation = review ? "The review history will remain on the loan." :
    "The loan remains in the brokerage and the handoff history stays on the file.";
  const options = teammates.filter((member) => {
    if (row.kind === "Coverage") return false;
    if (branchDefault) return member.role !== "Processor" && row.branchStaffEmails?.includes(member.email);
    if (row.kind === "Processing") return member.role === "Processor" && member.email !== row.loanOfficer;
    if (review) return member.email !== row.otherReviewer && (member.role === "Admin" ||
      (member.role === "LO" && member.email === row.loanOfficer) || (member.role === "Processor" && member.email === row.processor));
    return member.role !== "Processor" && (row.kind !== "Loan" || member.email !== row.processor);
  });
  return <li className="document-item">
    <div className="document-item-head"><strong>{row.title}</strong><span className="pill">{row.kind}</span></div>
    <p className="muted">{row.detail}{row.due && ` · ${row.dueLabel} ${row.due.length === 10 ? row.due : `${dateTime(row.due)} ET`}`}</p>
    {!intake && row.kind !== "Coverage" && <button type="button" className="name-link" onClick={open}>
      Open {row.kind === "Lead" ? "lead" : row.kind === "Contact follow-up" ? "contact" :
        row.kind === "Contact conversation" ? "conversation" : review ? "review" : "loan"}
    </button>}
    {(intake || options.length > 0) && <form className="brokerage-form" onSubmit={(event) => {
      event.preventDefault();
      const destination = String(new FormData(event.currentTarget).get("replacement"));
      transfer(row, destination === "shared" ? null : destination);
    }}>
      <label className="field">{branchDefault ? "Route new branch leads to" : intake ? "Route future leads to" : "Hand off to"}<select name="replacement" defaultValue="" required>
        <option value="" disabled>{intake ? "Choose a destination" : "Choose a teammate"}</option>
        {intake && <option value="shared">Shared inbox</option>}
        {options.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
      </select></label>
      <Button type="submit" size="sm" disabled={busy}>{intake ? "Save route" : "Hand off"}</Button>
    </form>}
    {branchDefault && !options.length && <p className="muted">Add an active loan officer to this branch in Team, or choose the shared inbox.</p>}
    {!intake && !options.length && row.kind !== "Coverage" && <p className="muted">No eligible teammate for this assignment.</p>}
    {(review || row.kind === "Processing") && (confirmRemoval ? <div className="document-item">
      <p>{removeExplanation}</p><div className="loan-application-actions">
        <Button size="sm" variant="danger" disabled={busy} onClick={() => transfer(row, null)}>Confirm {removeLabel.toLowerCase()}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemoval(false)}>Go back</Button>
      </div>
    </div> : <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRemoval(true)}>{removeLabel}</Button>)}
    {row.kind === "Coverage" && <Button size="sm" variant="outline" disabled={busy} onClick={() => transfer(row, null)}>End coverage</Button>}
  </li>;
}

export function StaffOffboarding({ endpoint, email, viewer, members, onRevoke, onClose, open }: {
  endpoint: string; email: string; viewer: string; members: BrokerageMember[]; onRevoke: () => Promise<void>;
  onClose: () => void; open: (item: DepartureItem) => void;
}) {
  const [filter, setFilter] = useState<Preview["filter"]>("All work");
  const [page, setPage] = useState<DeparturePage>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [removal, setRemoval] = useState<"after handoff" | "immediate" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request<DeparturePage>(endpoint, { type: "offboardingPreview", email, filter }, controller.signal)
      .then(setPage).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [email, endpoint, filter, refresh]);

  useEffect(() => { heading.current?.focus(); }, []);

  useEffect(() => {
    if (message || error) feedback.current?.focus();
  }, [message, error]);

  async function act(input: OffboardingInput) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (input.type === "offboardingPreview") {
        const next = await request<DeparturePage>(endpoint, input);
        setPage((previous) => previous ? { ...next, items: [...previous.items, ...next.items] } : next);
        return;
      }
      const result = await request<{ message: string }>(endpoint, input);
      if (input.type === "offboardingRevoke" && email === viewer) {
        // Reload through the server so it resolves the current brokerage membership again.
        window.location.assign(new URL("/workspace", window.location.href));
        return;
      }
      setMessage(result.message);
      setRemoval(null);
      setPage(undefined);
      setRefresh((value) => value + 1);
      if (input.type === "offboardingRevoke") await onRevoke();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Orbit could not save this change.");
    } finally {
      setBusy(false);
    }
  }

  const teammates = members.filter((member) => member.email !== email && member.status === "Active");
  return <section className="staff-offboarding" aria-label="Staff offboarding">
    <div className="document-item-head"><h3 ref={heading} tabIndex={-1}>{page?.member.status === "Revoked" ? "Recover open assignments" : "Offboarding preview"}</h3>
      <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close preview</Button></div>
    <p className="muted">Hand off open work and redirect future leads before removing brokerage access. Routing changes keep existing links and earlier lead assignments.</p>
    {message && !error && <p ref={feedback} tabIndex={-1} className="application-message" role="status">{message}</p>}
    {error && <p ref={feedback} tabIndex={-1} className="application-message banner-error" role="alert">{error}</p>}
    <div className="brokerage-form">
      <label className="field">Work type<select value={filter} disabled={busy} onChange={(event) => {
        setError(""); setMessage(""); setRemoval(null); setPage(undefined); setFilter(event.target.value as Preview["filter"]);
      }}><option>All work</option>{departureKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => {
        setError(""); setMessage(""); setRemoval(null); setPage(undefined); setRefresh((value) => value + 1);
      }}>Refresh work</Button>
    </div>
    {!page && !error && <p className="muted" role="status">Checking open work…</p>}
    {page && <>
      {page.member.ownsFinancials && page.member.status === "Active" &&
        <p className="application-message">Financials are tied to this pilot creator’s admin access. Removing access leaves the ledger without an active owner.</p>}
      {page.items.length ? <ul className="document-list">{page.items.map((row) => <WorkRow key={`${row.kind}:${row.id}`} row={row}
        teammates={teammates} busy={busy} open={() => open(row)} transfer={(item, replacement) => {
          void act({ type: "offboardingTransfer", email, kind: item.kind, id: item.id, revision: item.revision,
            memberRevision: page.member.accessRevision, replacement, operationId: crypto.randomUUID(), routeKey: item.routeKey });
        }} />)}</ul> : <p className="muted">{page.remaining ? "No open work in this category." : "No open work remains for this staff member."}</p>}
      {page.next && <Button size="sm" variant="outline" disabled={busy} onClick={() =>
        void act({ type: "offboardingPreview", email, filter, after: page.next ?? undefined })}>Load more work</Button>}
      {page.member.status === "Active" && (page.canRevoke ?
        removal ? <div className="document-item">
          <strong>Remove {page.member.name} from this brokerage?</strong>
          <p>{removal === "immediate" ? "Open assignments and intake routes will stay in the recovery list." : "This staff member will lose access to this brokerage."}</p>
          <div className="loan-application-actions">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void act({ type: "offboardingRevoke", email,
              memberRevision: page.member.accessRevision, immediate: removal === "immediate" })}>Confirm access removal</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoval(null)}>Keep access</Button>
          </div>
        </div> : <div className="loan-application-actions">
          {!page.remaining && <Button size="sm" variant="danger" disabled={busy} onClick={() => setRemoval("after handoff")}>Revoke access</Button>}
          {page.remaining && <Button size="sm" variant="danger" disabled={busy} onClick={() => setRemoval("immediate")}>Revoke now and recover later</Button>}
        </div> : <p className="muted">Keep at least one active admin in this brokerage.</p>)}
    </>}
  </section>;
}
