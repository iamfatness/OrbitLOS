"use client";

import { useEffect, useRef, useState } from "react";
import type { BrokerageMember } from "@/lib/brokerage-model";
import type { AssignmentDetail, AssignmentLoan, AssignmentPage } from "@/lib/loan-assignments";
import type { ManualReturnAssignment } from "@/lib/lender-export-model";
import type { ProcessorAssignmentReceipt } from "@/lib/loan-processing";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Assignment = AssignmentDetail & { members: BrokerageMember[] };
type Change = { type: "assign"; loanId: string; previousEmail: string | null; email: string; manualReturn?: ManualReturnAssignment } |
  { type: "assignProcessor"; loanId: string; revision: number; email: string | null };
const loadError = "Could not load loan assignment. Try again.";
const endpoint = (brokerageId: string) => `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}`;

function pendingProcessorSave(key: string) {
  try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}

async function read<T>(brokerageId: string, input: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(`${endpoint(brokerageId)}&${new URLSearchParams(input)}`, { signal });
  if (!response.ok) throw new Error(loadError);
  return await response.json() as T;
}

function ProcessorForm({ detail, busy, save }: {
  detail: Assignment; busy: boolean; save: (action: Change) => void;
}) {
  const { loan, processing, members } = detail;
  const current = processing?.processorEmail ?? "";
  const [processor, setProcessor] = useState(current);
  const options = members.filter(({ role, email }) => role === "Processor" && email !== loan.officerEmail);
  return <form className="brokerage-form processor-access-form" onSubmit={(event) => {
    event.preventDefault();
    if (processor !== current) save({ type: "assignProcessor", loanId: loan.id, revision: processing?.revision ?? 0, email: processor || null });
  }}>
    <label className="field">Shared processor<select value={processor} onChange={(event) => setProcessor(event.target.value)} disabled={busy}>
      <option value="">No shared processor</option>
      {current && !options.some(({ email }) => email === current) && <option value={current} disabled>{current} · Unavailable</option>}
      {options.map(({ name, email }) => <option key={email} value={email}>
        {options.some((other) => other.email !== email && other.name === name) ? `${name} · ${email}` : name}
      </option>)}
    </select></label>
    <Button type="submit" size="sm" disabled={busy || processor === current}>Save processor access</Button>
    <p className="muted">The loan owner keeps access. A replacement processor can continue the handoff.</p>
  </form>;
}

export function LoanAssignmentEditor({ brokerageId, loanId, version, onChanged, openLoan, manualReturn }: {
  brokerageId: string; loanId: string; version?: object; onChanged: () => void; openLoan?: (id: string) => void;
  manualReturn?: ManualReturnAssignment;
}) {
  const [generation, setGeneration] = useState(0);
  const [data, setData] = useState<{ brokerageId: string; loanId: string; generation: number; version?: object;
    detail?: Assignment; error?: string }>();
  const [activity, setActivity] = useState<"save" | "check" | null>(null);
  const saving = activity !== null;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const receiptKey = `orbit:processor-save:${brokerageId}:${loanId}`;
  const [requestId, setRequestId] = useState(() => manualReturn ? "" : pendingProcessorSave(receiptKey));
  const [receiptMissing, setReceiptMissing] = useState(false);
  const receiptFeedback = useRef<HTMLParagraphElement>(null);
  const focusFeedback = useRef(false);
  const current = data?.brokerageId === brokerageId && data.loanId === loanId && data.generation === generation && data.version === version ? data : undefined;
  const detail = current?.detail;
  useEffect(() => {
    const controller = new AbortController();
    void read<Assignment>(brokerageId, { view: "loan-assignment", loanId }, controller.signal).then((detail) => {
      if (!controller.signal.aborted) setData({ brokerageId, loanId, generation, version, detail });
    }).catch(() => {
      if (!controller.signal.aborted) setData({ brokerageId, loanId, generation, version, error: loadError });
    });
    return () => controller.abort();
  }, [brokerageId, loanId, generation, version]);
  useEffect(() => {
    if (saving || !focusFeedback.current || !receiptFeedback.current) return;
    focusFeedback.current = false;
    receiptFeedback.current.focus();
  }, [saving, error, message, requestId, receiptMissing]);

  function trackProcessorSave(id: string) {
    setRequestId(id);
    setReceiptMissing(false);
    try {
      if (id) sessionStorage.setItem(receiptKey, id);
      else sessionStorage.removeItem(receiptKey);
    } catch {
      // The editor can still check this request while the tab remains open.
    }
  }

  function refreshAssignment() {
    setGeneration((value) => value + 1);
    onChanged();
  }

  async function save(input: Change) {
    if (saving) return;
    const id = input.type === "assignProcessor" ? crypto.randomUUID() : "";
    if (id) {
      trackProcessorSave(id);
      focusFeedback.current = true;
    }
    setActivity("save");
    setMessage("");
    setError("");
    try {
      const response = await fetch(endpoint(brokerageId), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { ...input, requestId: id } : input) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        if (id && response.status >= 500) return;
        if (id) trackProcessorSave("");
        if (response.status === 409 || response.status === 403) setGeneration((value) => value + 1);
        setError(result.error ?? "Orbit could not save the assignment.");
        return;
      }
      if (id && !result.message) return;
      if (id) trackProcessorSave("");
      setMessage(result.message ?? "Assignment saved.");
      refreshAssignment();
    } catch (failure) {
      if (!id) setError(failure instanceof Error ? failure.message : "Orbit could not save the assignment.");
    }
    finally { setActivity(null); }
  }

  async function checkProcessorSave() {
    if (!requestId || saving) return;
    focusFeedback.current = true;
    setActivity("check");
    setError("");
    setMessage("");
    setReceiptMissing(false);
    try {
      const result = await read<ProcessorAssignmentReceipt>(brokerageId, { view: "processor-assignment-receipt", loanId, requestId });
      if (result.outcome === "missing") setReceiptMissing(true);
      else if (result.outcome === "saved" || result.outcome === "newer") {
        trackProcessorSave("");
        setMessage(result.outcome === "saved" ? "Processor change saved." : "This change was saved. A newer processing update is shown below.");
        refreshAssignment();
      } else throw new Error(loadError);
    } catch {
      setError("Orbit couldn’t check this save. Try checking again.");
    } finally {
      setActivity(null);
    }
  }

  const owners = detail?.members.filter(({ role, email }) => role !== "Processor" &&
    email !== detail.loan.officerEmail && email !== detail.processing?.processorEmail) ?? [];
  return <div className="record-form assignment-editor">
    {error && <p ref={receiptFeedback} tabIndex={-1} role="alert" className="application-error">{error}</p>}
    {message && <p ref={receiptFeedback} tabIndex={-1} role="status" className="application-message">{message}</p>}
    {requestId && <div>
      <p ref={!error ? receiptFeedback : undefined} tabIndex={-1} role="status" className="application-message">
        {activity === "save" ? "Saving processor access…" : activity === "check" ? "Checking processor access…" :
          receiptMissing ? "No confirmation found yet. You can check again or review the current processor." :
          "Orbit couldn’t confirm the processor change."}</p>
      <div className="loan-application-actions">
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void checkProcessorSave()}>Check processor change</Button>
        {receiptMissing && <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => {
          trackProcessorSave("");
          focusFeedback.current = true;
          setMessage("Review the current processor before making another change.");
          setGeneration((value) => value + 1);
        }}>Review current access</Button>}
      </div>
    </div>}
    {!current && <p className="muted" role="status">Loading assignment…</p>}
    {current?.error && <div><p role="alert">{current.error}</p><Button size="sm" variant="outline" onClick={() => setGeneration((value) => value + 1)}>Retry assignment</Button></div>}
    {detail && <>
      <div className="section-heading">
        <div><h3>{detail.loan.name}</h3><p className="muted">{detail.loan.address || detail.loan.stage}</p></div>
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={saving} onClick={() => setGeneration((value) => value + 1)}>Refresh assignment</Button>
          {openLoan && <Button size="sm" variant="outline" disabled={saving} onClick={() => openLoan(loanId)}>Open loan</Button>}
        </div>
      </div>
      <p>Loan owner <strong>{detail.loan.officer || detail.loan.officerEmail || "Unassigned"}</strong>
        {" · "}Processor <strong>{detail.processing?.processorName || detail.processing?.processorEmail || "Unassigned"}</strong></p>
      {detail.processing?.processorEmail && <p className="muted">{detail.processing.status} · Updated {dateTime(detail.processing.updatedAt)} ET</p>}
      <form className="brokerage-form" key={`${loanId}:${detail.loan.officerEmail ?? ""}:${detail.processing?.revision ?? 0}`}
        onSubmit={(event) => {
          event.preventDefault();
          const email = String(new FormData(event.currentTarget).get("owner") ?? "");
          if (email) void save({ type: "assign", loanId, previousEmail: detail.loan.officerEmail, email, manualReturn });
        }}>
        <label className="field">New owner<select name="owner" defaultValue="" required disabled={saving || !owners.length}>
          <option value="">Choose a loan officer or admin</option>
          {owners.map(({ name, email }) => <option value={email} key={email}>{name} · {email}</option>)}</select></label>
        <Button type="submit" size="sm" disabled={saving || !owners.length}>Reassign loan</Button>
        <p className="muted">{manualReturn ? "The loan and lender-return work move to the new officer’s Today queue." :
          "Open tasks follow the new owner at their existing deadlines."}</p>
      </form>
      {!manualReturn && <ProcessorForm key={`${loanId}:${detail.processing?.revision ?? 0}:${detail.processing?.processorEmail ?? ""}`} detail={detail}
        busy={saving || Boolean(requestId)} save={(input) => void save(input)} />}
    </>}
  </div>;
}

export function TeamLoanAssignment({ brokerageId, version, onChanged, openLoan }: {
  brokerageId: string; version: object; onChanged: () => void; openLoan: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AssignmentLoan>();
  const [data, setData] = useState<{ brokerageId: string; search: string; version: object; generation: number; page?: AssignmentPage; error?: string }>();
  const [generation, setGeneration] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const search = query.trim();
  const current = data?.brokerageId === brokerageId && data.search === search && data.version === version && data.generation === generation ? data : undefined;
  const page = current?.page;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void read<AssignmentPage>(brokerageId, { view: "assignment-loans", search }, controller.signal).then((page) => {
        if (!controller.signal.aborted) setData({ brokerageId, search, version, generation, page });
      }).catch(() => {
        if (!controller.signal.aborted) setData({ brokerageId, search, version, generation, error: "Could not load loans. Try again." });
      });
    }, search ? 180 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [brokerageId, search, version, generation]);

  async function loadMore() {
    if (!current || !page?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await read<AssignmentPage>(brokerageId, { view: "assignment-loans", search, afterId: page.next.id, afterStageSince: page.next.stageSince });
      setData((latest) => {
        if (latest !== current) return latest;
        const loans = new Map(page.loans.map((loan) => [loan.id, loan]));
        for (const loan of result.loans) loans.set(loan.id, loan);
        return { ...latest, page: { ...result, loans: [...loans.values()] }, error: undefined };
      });
    } catch {
      setData((latest) => latest === current ? { ...current, error: "Could not load more loans. Try again." } : latest);
    } finally { setLoadingMore(false); }
  }

  const choices = page?.loans ?? [];
  return <section className="pipeline relationship-panel" aria-label="Loan reassignment">
    <h2>Loan reassignment</h2>
    <div className="loan-application-actions">
      <label className="field">Find a loan<input type="search" maxLength={160} placeholder="Borrower, address, or officer"
        value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field">Loan<select value={selected?.id ?? ""} onChange={(event) => setSelected(choices.find(({ id }) => id === event.target.value))}>
        <option value="">Choose a loan</option>
        {selected && !choices.some(({ id }) => id === selected.id) && <option value={selected.id}>{selected.name} · {selected.address || selected.stage}</option>}
        {choices.map((loan) => <option key={loan.id} value={loan.id}>{loan.name} · {loan.address || loan.stage}</option>)}
      </select></label>
      {page?.next && <Button size="sm" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>Load more loans</Button>}
    </div>
    {!current && <p className="muted" role="status">Loading loans…</p>}
    {page && !choices.length && <p className="empty-inline">{search ? "No loans match your search." : "No loans are available to assign."}</p>}
    {current?.error && <div><p role="alert">{current.error}</p><Button size="sm" variant="outline" onClick={() => setGeneration((value) => value + 1)}>Retry loans</Button></div>}
    {selected && <LoanAssignmentEditor key={selected.id} brokerageId={brokerageId} loanId={selected.id} version={version} onChanged={onChanged} openLoan={openLoan} />}
  </section>;
}
