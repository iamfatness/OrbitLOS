"use client";

import { useEffect, useRef, useState } from "react";
import { accessLoanRetention } from "@/app/actions";
import type { LoanRetentionResult } from "@/lib/loan-retention";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Inventory = Extract<LoanRetentionResult, { kind: "list" }>;
type LoanRow = Inventory["loans"][number];
type Selection = { heldOnly: boolean; search: string; offset: number };
type Review = { loan: LoanRow; action: "history" | "hold" | "release"; id: string };
const initial: Selection = { heldOnly: false, search: "", offset: 0 };

export function LoanRetention({ brokerageId, paused, openLoan }: {
  brokerageId: string; paused: boolean; openLoan: (id: string) => void;
}) {
  const [selection, select] = useState(initial);
  const [search, setSearch] = useState("");
  const [inventory, setInventory] = useState<Inventory & { selection: Selection }>();
  const [review, setReview] = useState<Review>();
  const [history, setHistory] = useState<Extract<LoanRetentionResult, { kind: "history" }>>();
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const receipt = useRef<HTMLParagraphElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (paused) return;
    let current = true;
    void accessLoanRetention({ type: "list", ...selection }, brokerageId).then(result => {
      if (!current) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "list") setInventory({ ...result, selection });
    }).catch(() => {
      if (current) setError("Could not load loan retention. Try again.");
    }).finally(() => {
      if (current) setPending(false);
    });
    return () => { current = false; };
  }, [brokerageId, paused, selection]);

  useEffect(() => {
    if (notice) receipt.current?.focus();
  }, [notice]);
  useEffect(() => {
    reviewHeading.current?.focus();
  }, [review?.loan.id, review?.action]);

  function load(next: Selection) {
    setPending(true);
    setError("");
    select(next);
  }

  async function inspect(loan: LoanRow, action: Review["action"], button: HTMLButtonElement) {
    origin.current = button;
    setError("");
    setNotice("");
    setReference("");
    setHistory(undefined);
    setExportStatus("");
    setReview({ loan, action, id: crypto.randomUUID() });
    if (action !== "history") return;
    setPending(true);
    try {
      const result = await accessLoanRetention({ type: "history", loanId: loan.id }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "history") setHistory(result);
    } catch {
      setError("Could not load hold history. Close it and try again.");
    } finally {
      setPending(false);
    }
  }

  async function exportHistory(loanId: string) {
    if (exporting) return;
    setExporting(true);
    setError("");
    setExportStatus("Preparing retention ZIP…");
    try {
      const params = new URLSearchParams({ brokerage: brokerageId, loan: loanId });
      const response = await fetch(`/api/loan-retention/export?${params}`, { method: "POST" });
      if (!response.ok || response.headers.get("content-type") !== "application/zip") {
        const problem = await response.json().catch(() => null);
        throw new Error(typeof problem?.error === "string" ? problem.error : "Could not prepare the retention export. Try again.");
      }
      downloadSampleFile(await response.blob(), "orbit-loan-retention.zip");
      setExportStatus("Retention ZIP sent to your downloads.");
    } catch (failure) {
      setExportStatus("");
      setError(failure instanceof Error ? failure.message : "Could not prepare the retention export. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function save() {
    if (!review || review.action === "history" || pending) return;
    const { loan, id, action } = review;
    setPending(true);
    setError("");
    try {
      const result = await accessLoanRetention({ type: action, id, loanId: loan.id, reference,
        ...(action === "release" ? { holdId: loan.holdId } : {}) }, brokerageId);
      if ("error" in result) {
        setError(result.error);
        setPending(false);
      } else if (result.kind === "saved") {
        setReview(undefined);
        setNotice(result.message);
        load({ ...selection, offset: selection.heldOnly ? 0 : selection.offset });
      }
    } catch {
      setError("Could not verify the save. Try again with the same reference.");
      setPending(false);
    }
  }

  if (paused) return <p className="muted">Loan retention is unavailable while the workspace is paused.</p>;

  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2>Loan retention</h2>
      {inventory && <Button variant="outline" aria-pressed={selection.heldOnly} disabled={pending || !!review}
        onClick={() => { setNotice(""); load({ ...selection, heldOnly: !selection.heldOnly, offset: 0 }); }}>
        {inventory.held} {inventory.held === 1 ? "active hold" : "active holds"}
      </Button>}
    </div>
    <p className="muted">Holds protect the loan and its checklist PDFs from deletion. Retention periods are pending policy review.</p>
    <form className="loan-application-actions retention-search" onSubmit={(event) => {
      event.preventDefault();
      setNotice("");
      load({ ...selection, search: search.trim(), offset: 0 });
    }}>
      <label className="field">Borrower name
        <input value={search} maxLength={100} disabled={pending || !!review} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <Button type="submit" variant="outline" disabled={pending || !!review}>Search</Button>
      <Button type="button" variant="outline" disabled={pending || !!review} onClick={() => load({ ...selection })}>Refresh</Button>
    </form>
    {notice && <p ref={receipt} role="status" tabIndex={-1}>{notice}</p>}
    {error && !review && <p role="alert">{error}</p>}
    {review && <section className="document-item record-form" aria-label={`${review.loan.borrower} retention review`}>
      <h3 ref={reviewHeading} tabIndex={-1}>
        {review.action === "history" ? "Hold history" : review.action === "hold" ? "Place retention hold" : "Release retention hold"}
      </h3>
      <strong>{review.loan.borrower}</strong>
      {review.action === "history" ? (pending ? <p role="status">Loading history…</p> : history && (history.holds.length ?
        <ol className="loan-task-list">{history.holds.map(hold => <li key={hold.id} className="document-item">
          <p><strong>Placed</strong> {dateTime(hold.placedAt)} ET · {hold.placedBy}</p>
          <p>{hold.reference}</p>
          {hold.releasedAt && <><p><strong>Released</strong> {dateTime(hold.releasedAt)} ET · {hold.releasedBy}</p>
            <p>{hold.releaseReference}</p></>}
        </li>)}</ol> : <p>No holds have been recorded for this loan.</p>)) :
        <form className="record-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <p className="muted">{review.action === "hold" ?
            "The loan stays in the pipeline and existing or replacement checklist PDFs are preserved." :
            "Releasing restores normal cleanup for replaced PDFs and removes the hold’s block on deleting this loan."}</p>
          <label className="field">{review.action === "hold" ? "Hold reference or reason" : "Release reference or reason"}
            <textarea value={reference} required minLength={4} maxLength={240} rows={2} disabled={pending}
              onChange={event => {
                setReference(event.target.value);
                setReview({ ...review, id: crypto.randomUUID() });
              }} />
          </label>
          <div><Button type="submit" disabled={pending || reference.trim().length < 4}>
            {pending ? "Saving…" : review.action === "hold" ? "Confirm hold" : "Confirm release"}
          </Button></div>
        </form>}
      {error && <p role="alert">{error}</p>}
      {exportStatus && <p role="status">{exportStatus}</p>}
      <div className="loan-application-actions">
        {review.action === "history" && history && <Button type="button" disabled={exporting}
          onClick={() => void exportHistory(review.loan.id)}>Download retention ZIP</Button>}
        <Button type="button" variant="outline" disabled={pending || exporting} onClick={() => {
        const previous = origin.current;
        setReview(undefined);
        setError("");
        // The originating action becomes enabled after this render.
        requestAnimationFrame(() => previous?.focus());
      }}>{review.action === "history" ? "Close history" : "Cancel"}</Button></div>
    </section>}
    {(!inventory || pending && !review) && !error && <p role="status">Loading loan inventory…</p>}
    {inventory && inventory.selection === selection && <section aria-label="Loans in retention inventory" aria-busy={pending && !review} className="record-form">
      <p className="muted">{inventory.total} {selection.heldOnly ? "held " : ""}{inventory.total === 1 ? "loan" : "loans"}{selection.search && ` matching “${selection.search}”`}</p>
      {inventory.loans.length === 0 && <p>{selection.heldOnly ? "No matching loans are on hold." : "No matching loans."}</p>}
      <ul className="loan-task-list">{inventory.loans.map(loan => <li key={loan.id} className="loan-task document-item record-form">
        <div className="section-heading"><strong>{loan.borrower}</strong>{loan.holdId && <span className="muted">On hold</span>}</div>
        <p className="muted">{loan.stage} · {loan.requests} {loan.requests === 1 ? "request" : "requests"} · {loan.pdfs} saved {loan.pdfs === 1 ? "PDF" : "PDFs"}</p>
        <div className="loan-application-actions">
          <Button variant="outline" disabled={pending || !!review} onClick={() => openLoan(loan.id)}>Open loan</Button>
          <Button variant="outline" disabled={pending || !!review} onClick={event => void inspect(loan, "history", event.currentTarget)}>Hold history</Button>
          <Button variant="outline" disabled={pending || !!review}
            onClick={event => void inspect(loan, loan.holdId ? "release" : "hold", event.currentTarget)}>
            {loan.holdId ? "Release hold" : "Place hold"}
          </Button>
        </div>
      </li>)}</ul>
      {(selection.offset > 0 || inventory.next !== null) && <div className="loan-application-actions">
        <Button variant="outline" disabled={pending || !!review || !selection.offset}
          onClick={() => load({ ...selection, offset: Math.max(0, selection.offset - 15) })}>Previous loans</Button>
        <Button variant="outline" disabled={pending || !!review || inventory.next === null}
          onClick={() => load({ ...selection, offset: inventory.next ?? 0 })}>Next loans</Button>
      </div>}
    </section>}
  </div>;
}
