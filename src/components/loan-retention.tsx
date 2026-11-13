"use client";

import { useEffect, useRef, useState } from "react";
import { accessLoanRetention } from "@/app/actions";
import type { LoanRetentionResult } from "@/lib/loan-retention";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { ColoradoRecordkeeping } from "./colorado-recordkeeping";
import { CaliforniaDreRecordkeeping } from "./california-dre-recordkeeping";
import { CaliforniaDfpiRecordkeeping } from "./california-dfpi-recordkeeping";
import { FloridaRecordkeeping } from "./florida-recordkeeping";
import { FloridaJournal } from "./florida-journal";
import { TexasRecordkeeping } from "./texas-recordkeeping";
import { TexasLoanLog } from "./texas-loan-log";
import { CrmlaRegister } from "./crmla-register";
import { MichiganBusinessRetention, MichiganRetention } from "./michigan-retention";
import { RetentionDisposition } from "./retention-disposition";
import { Button } from "./ui/button";

type Inventory = Extract<LoanRetentionResult, { kind: "list" }>;
type LoanRow = Inventory["loans"][number];
type Selection = { heldOnly: boolean; search: string; offset: number };
type Review = { loan: LoanRow; action: "history" | "hold" | "release"; id: string };
const initial: Selection = { heldOnly: false, search: "", offset: 0 };

export function LoanRetention({ brokerageId, paused, openLoan, openEvidence }: {
  brokerageId: string; paused: boolean; openLoan: (id: string) => void; openEvidence: (id: string) => void;
}) {
  const [disposition, setDisposition] = useState(false);
  const [michigan, setMichigan] = useState<LoanRow | "business">();
  const [recordkeeping, setRecordkeeping] = useState<{loan: LoanRow; authority: "DRE" | "DFPI" | "Colorado" | "Florida" | "Texas"} | "register" | "floridaJournal" | "texasLog">();
  const recordkeepingLinks = useRef(new Map<string, HTMLButtonElement>());
  const returnRecordkeeping = useRef<string>(null);
  const dispositionLink = useRef<HTMLButtonElement>(null);
  const michiganLinks = useRef(new Map<string, HTMLButtonElement>());
  const returnMichiganId = useRef<string>(null);
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
  useEffect(() => {
    if (michigan || !returnMichiganId.current) return;
    const link = michiganLinks.current.get(returnMichiganId.current);
    if (link && !link.disabled) {
      link.focus();
      returnMichiganId.current = null;
    }
  }, [michigan, inventory, pending]);
  useEffect(() => {
    if (recordkeeping || !returnRecordkeeping.current) return;
    const link = recordkeepingLinks.current.get(returnRecordkeeping.current);
    if (link && !link.disabled) {
      link.focus();
      returnRecordkeeping.current = null;
    }
  }, [recordkeeping, inventory, pending]);

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
        const problem: unknown = await response.json().catch(() => null);
        throw new Error(problem && typeof problem === "object" && "error" in problem && typeof problem.error === "string" ? problem.error : "Could not prepare the retention export. Try again.");
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

  if (paused && (!inventory || disposition)) return <p className="muted">Loan retention is unavailable while the workspace is paused.</p>;

  if (recordkeeping && !paused) {
    const back = () => {
      returnRecordkeeping.current = typeof recordkeeping === "string" ? recordkeeping : recordkeeping.authority + "/" + recordkeeping.loan.id;
      setRecordkeeping(undefined);
    };
    if (recordkeeping === "register") return <CrmlaRegister brokerageId={brokerageId} onBack={back} />;
    if (recordkeeping === "floridaJournal") return <FloridaJournal brokerageId={brokerageId} onBack={back} />;
    if (recordkeeping === "texasLog") return <TexasLoanLog brokerageId={brokerageId} onBack={back} />;
    const Review = { DRE: CaliforniaDreRecordkeeping, DFPI: CaliforniaDfpiRecordkeeping, Colorado: ColoradoRecordkeeping, Florida: FloridaRecordkeeping, Texas: TexasRecordkeeping }[recordkeeping.authority];
    return <Review brokerageId={brokerageId} loan={{id: recordkeeping.loan.id, label: recordkeeping.loan.borrower}} onBack={back} />;
  }
  if (michigan && !paused) {
    function back() {
      returnMichiganId.current = michigan === "business" ? "business" : michigan?.id ?? null;
      setMichigan(undefined);
    }
    return michigan === "business" ? <MichiganBusinessRetention brokerageId={brokerageId} onBack={back} /> :
      <MichiganRetention brokerageId={brokerageId} target={{ kind: "loan", id: michigan.id, label: michigan.borrower }} onBack={back} />;
  }

  if (disposition) return <RetentionDisposition brokerageId={brokerageId} openLoan={openLoan} onBack={()=>{
    setDisposition(false);
    requestAnimationFrame(()=>dispositionLink.current?.focus());
  }} />;

  const locked = pending || paused;
  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2>Loan evidence &amp; retention</h2>
      <div className="loan-application-actions">
        <Button ref={dispositionLink} type="button" variant="outline" disabled={locked || !!review}
          onClick={()=>setDisposition(true)}>Disposition review</Button>
        <Button ref={node => { if (node) michiganLinks.current.set("business", node); else michiganLinks.current.delete("business"); }}
          type="button" variant="outline" disabled={locked || !!review} onClick={() => setMichigan("business")}>Michigan business records</Button>
        <Button ref={node => { if (node) recordkeepingLinks.current.set("register", node); else recordkeepingLinks.current.delete("register"); }}
          type="button" variant="outline" className="min-h-11" disabled={locked || !!review} onClick={() => setRecordkeeping("register")}>
          CRMLA application register
        </Button>
        <Button ref={node => { if (node) recordkeepingLinks.current.set("floridaJournal", node); else recordkeepingLinks.current.delete("floridaJournal"); }}
          type="button" variant="outline" className="min-h-11" disabled={locked || !!review} onClick={() => setRecordkeeping("floridaJournal")}>
          Florida transaction journal
        </Button>
        <Button ref={node => { if (node) recordkeepingLinks.current.set("texasLog", node); else recordkeepingLinks.current.delete("texasLog"); }}
          type="button" variant="outline" className="min-h-11" disabled={locked || !!review} onClick={() => setRecordkeeping("texasLog")}>
          Texas examination logs
        </Button>
        {inventory && <Button variant="outline" aria-pressed={selection.heldOnly} disabled={locked || !!review}
          onClick={() => { setNotice(""); load({ ...selection, heldOnly: !selection.heldOnly, offset: 0 }); }}>
          {inventory.held} {inventory.held === 1 ? "active hold" : "active holds"}
        </Button>}
      </div>
    </div>
    <p className="muted">Holds protect the loan and its checklist PDFs from deletion.</p>
    <form className="loan-application-actions retention-search" onSubmit={(event) => {
      event.preventDefault();
      setNotice("");
      load({ ...selection, search: search.trim(), offset: 0 });
    }}>
      <label className="field">Borrower name or file ID
        <input value={search} maxLength={100} disabled={locked || !!review} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <Button type="submit" variant="outline" disabled={locked || !!review}>Search</Button>
      <Button type="button" variant="outline" disabled={locked || !!review} onClick={() => load({ ...selection })}>Refresh</Button>
    </form>
    {notice && <p ref={receipt} role="status" tabIndex={-1}>{notice}</p>}
    {error && !review && <p role="alert">{error}</p>}
    {review && <section className="document-item record-form" aria-label={`${review.loan.borrower} retention review`}>
      <h3 ref={reviewHeading} tabIndex={-1}>
        {review.action === "history" ? "Hold history" : review.action === "hold" ? "Place retention hold" : "Release retention hold"}
      </h3>
      <strong>{review.loan.borrower}</strong>
      <p className="muted">File ID {review.loan.id}</p>
      {review.action !== "history" &&
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
        {review.action === "history" && history && <Button type="button" aria-disabled={exporting}
          onClick={() => void exportHistory(review.loan.id)}>Download retention ZIP</Button>}
        <Button type="button" variant="outline" disabled={pending || exporting} onClick={() => {
        const previous = origin.current;
        setReview(undefined);
        setError("");
        // The originating action becomes enabled after this render.
        requestAnimationFrame(() => previous?.focus());
      }}>{review.action === "history" ? "Close history" : "Cancel"}</Button></div>
      {review.action === "history" && (pending ? <p role="status">Loading history…</p> : history && (history.holds.length ?
        <ol className="loan-task-list">{history.holds.map(hold => <li key={hold.id} className="document-item">
          <p><strong>Placed</strong> {dateTime(hold.placedAt)} ET · {hold.placedBy}</p>
          <p>{hold.reference}</p>
          {hold.releasedAt && <><p><strong>Released</strong> {dateTime(hold.releasedAt)} ET · {hold.releasedBy}</p>
            <p>{hold.releaseReference}</p></>}
        </li>)}</ol> : <p>No holds have been recorded for this loan.</p>))}
    </section>}
    {(!inventory || pending && !review) && !error && <p role="status">Loading loan inventory…</p>}
    {inventory && inventory.selection === selection && <section aria-label="Loans in retention inventory" aria-busy={pending && !review} className="record-form">
      <p className="muted">{inventory.total} {selection.heldOnly ? "held " : ""}{inventory.total === 1 ? "loan" : "loans"}{selection.search && ` matching “${selection.search}”`}</p>
      {inventory.loans.length === 0 && <p>{selection.heldOnly ? "No matching loans are on hold." : "No matching loans."}</p>}
      <ul className="loan-task-list">{inventory.loans.map(loan => <li key={loan.id} className="loan-task document-item record-form">
        <div className="section-heading"><strong>{loan.borrower}</strong>{loan.holdId && <span className="muted">On hold</span>}</div>
        {loan.address && <p>{loan.address}</p>}
        <p className="muted">File ID {loan.id}</p>
        <p className="muted">{loan.purpose} · {loan.stage} · {loan.requests} {loan.requests === 1 ? "request" : "requests"} · {loan.pdfs} saved {loan.pdfs === 1 ? "PDF" : "PDFs"}</p>
        <div className="loan-application-actions">
          <Button variant="outline" disabled={locked || !!review} onClick={() => openEvidence(loan.id)}>Open disclosure evidence</Button>
          <Button variant="outline" disabled={locked || !!review} onClick={event => void inspect(loan, "history", event.currentTarget)}>Hold history</Button>
          <Button variant="outline" disabled={locked || !!review}
            onClick={event => void inspect(loan, loan.holdId ? "release" : "hold", event.currentTarget)}>
            {loan.holdId ? "Release hold" : "Place hold"}
          </Button>
          {(["DRE", "DFPI", "Colorado", "Florida", "Texas"] as const).map(authority =>
            ({ DRE: loan.canReviewCaliforniaDre, DFPI: loan.canReviewCaliforniaDfpi, Colorado: loan.canReviewColorado, Florida: loan.canReviewFlorida, Texas: loan.canReviewTexas }[authority]) &&
            <Button key={authority} type="button" variant="outline" className="min-h-11"
              ref={node => {
                const key = authority + "/" + loan.id;
                if (node) recordkeepingLinks.current.set(key, node);
                else recordkeepingLinks.current.delete(key);
              }} disabled={locked || !!review} onClick={() => setRecordkeeping({loan, authority})}>
              {{ DRE: "California DRE", DFPI: "California DFPI", Colorado: "Colorado", Florida: "Florida", Texas: "Texas" }[authority]} borrower-file review
            </Button>)}
          {(!loan.propertyState || loan.propertyState === "MI") && <Button type="button" variant="outline"
            ref={node => { if (node) michiganLinks.current.set(loan.id, node); else michiganLinks.current.delete(loan.id); }}
            disabled={locked || !!review} onClick={() => setMichigan(loan)}>Michigan retention evidence</Button>}
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
