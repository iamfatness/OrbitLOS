"use client";

import { useRef, useState, type Ref } from "react";
import { cutoverFileSource, cutoverFileSourceMaxBytes, type CutoverFileComparison, type CutoverFileSource } from "@/lib/cutover-file-model";
import type { CutoverFileInventory, CutoverOpenWork } from "@/lib/migration-cutover-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

const sample: CutoverFileSource = {
  version: 1,
  documents: [{ kind: "Photo ID", instructions: "Provide the fictional sample identification.", status: "Requested", dueOn: null }],
  lenderFiles: [{ lender: "Example Wholesale", reference: "SAMPLE-1003", status: "Acknowledged",
    conditions: [{ category: "Income", description: "Review the fictional pay statement.", status: "Open" }] }],
  funding: { closingDate: "2026-06-12", fundingDate: "2026-06-15", fundedPrincipalCents: 28_000_000,
    borrowerFollowUp: { dueOn: "2026-06-22", status: "Open" }, realtorFollowUp: null, borrowerCallback: null },
};

function summary(source: CutoverFileSource) {
  const documents = source.documents;
  const files = source.lenderFiles;
  const conditions = files?.reduce((total, file) => total + file.conditions.length, 0) ?? 0;
  const count = (value: number, label: string) => `${value} ${label}${value === 1 ? "" : "s"}`;
  return [documents ? count(documents.length, "document request") : "Documents omitted",
    files ? `${count(files.length, "lender file")} · ${count(conditions, "condition")}` : "Lender files omitted",
    source.funding ? "Closing and funding included" : "Closing and funding omitted"].join(" · ");
}

export function FileInventoryUpload({ inventory, disabled, save }: {
  inventory?: CutoverFileInventory | { error: string }; disabled: boolean;
  save: (source: CutoverFileSource, revision: number) => void;
}) {
  const [preview, setPreview] = useState<{ source: CutoverFileSource; filename: string }>();
  const [fictional, setFictional] = useState(false);
  const [error, setError] = useState<string>();
  const selection = useRef(0);
  if (!inventory) return <p role="status">Loading source inventory…</p>;
  if ("error" in inventory) return <p role="alert">{inventory.error}</p>;

  async function load(file?: File) {
    const attempt = ++selection.current;
    setPreview(undefined);
    setFictional(false);
    setError(undefined);
    if (!file) return;
    if (file.size > cutoverFileSourceMaxBytes) {
      setError("Choose a fictional inventory JSON file up to 64 KiB.");
      return;
    }
    try {
      const parsed = cutoverFileSource.safeParse(JSON.parse(await file.text()));
      if (attempt !== selection.current) return;
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setError(issue.path.length ? `Check ${issue.path.join(".")} against the sample inventory.` : "Use the sample inventory format and include at least one section.");
        return;
      }
      setPreview({ source: parsed.data, filename: file.name });
    } catch {
      if (attempt === selection.current) setError("Could not read that JSON file. Check the file against the sample inventory.");
    }
  }

  return <section className="document-item record-form" aria-label="Source file inventory">
    <h3>Source file inventory</h3>
    <p className="muted">Compare fictional document requests, lender conditions, and closing and funding records with this loan. Upload metadata only.</p>
    <p className={inventory.source ? "muted" : "empty-inline"}>{inventory.source ? `Saved inventory · ${summary(inventory.source)}` : "No source inventory saved for this draft."}</p>
    <details className="document-form">
      <summary>{inventory.source ? "Replace source inventory" : "Add source inventory"}</summary>
      <div className="record-form">
        <p className="muted">Use empty lists for no documents or lender files, and null values for no closing, funding, or follow-up records. Omit a category when its inventory is unavailable. Each upload replaces the prior inventory for this draft.</p>
        <div><Button size="sm" variant="outline" onClick={() => downloadSampleFile(JSON.stringify(sample, null, 2), "orbit-fictional-file-inventory.json", "application/json")}>Download sample inventory</Button></div>
        <label className="field">Fictional inventory JSON<input type="file" accept=".json,application/json" disabled={disabled} onChange={(event) => void load(event.target.files?.[0])} /></label>
        {error && <p role="alert">{error}</p>}
        {preview && <>
          <p role="status">{preview.filename} · {summary(preview.source)}</p>
          <label><input type="checkbox" checked={fictional} disabled={disabled} onChange={(event) => setFictional(event.target.checked)} /> I confirmed this inventory contains fictional metadata.</label>
          <div><Button size="sm" disabled={disabled || !fictional} onClick={() => save(preview.source, inventory.revision)}>Save source inventory</Button></div>
        </>}
      </div>
    </details>
  </section>;
}

function ComparisonRows({ rows }: { rows: CutoverFileComparison["rows"] }) {
  return <ul className="document-list">{rows.map(({ label, source, destination, status }, index) => <li className="document-item" key={`${label}:${index}`}>
    <div className="document-item-head"><strong>{label}</strong><span className={status === "Changed" || status === "Missing" ? "open-chip" : "pill"}>{status}</span></div>
    <dl className="details-grid cutover-file-values">
      <div><dt>Source</dt><dd>{source ?? "No record"}</dd></div>
      <div><dt>Orbit</dt><dd>{destination ?? "No record"}</dd></div>
    </dl>
  </li>)}</ul>;
}

export function CutoverOpenWorkPreview({ work, receipt, receiptRef, disabled, restore, openAssignment, openRestoredWork }: {
  work: CutoverOpenWork; receipt?: string; receiptRef: Ref<HTMLParagraphElement>; disabled: boolean;
  restore: () => void; openAssignment: () => void; openRestoredWork: () => void;
}) {
  const hasWork = Boolean(work.documents || work.conditions);
  const newWork = [work.documents ? `${work.documents} pending document ${work.documents === 1 ? "request" : "requests"}` : "",
    work.conditions ? `${work.conditions} manual lender ${work.conditions === 1 ? "condition" : "conditions"}` : ""].filter(Boolean).join(" and ");
  return <section className="record-form cutover-open-work" aria-label="Open work from source">
    <div className="document-item-head"><h3 className="font-semibold">Open work from source</h3>
      {work.review > 0 && <span className="open-chip">{work.review} to review</span>}
    </div>
    <dl className="cutover-file-values grid grid-cols-2 gap-3">
      <div><dt>Loan owner</dt><dd>{work.owner ?? "Unassigned"}</dd></div>
      <div><dt>Processor</dt><dd>{work.processor ?? "Unassigned"}</dd></div>
    </dl>
    {receipt ? <p role="status" ref={receiptRef} tabIndex={-1} className="application-message">{receipt}</p> :
      <p className={hasWork ? "muted" : "empty-inline"}>{hasWork ? `Add ${newWork} to this fictional file. The restore is internal to Orbit.` :
        "No new work is eligible to restore."}</p>}
    {work.review > 0 && <p className="muted">Check the remaining records in the document and lender comparisons below.</p>}
    <div className="loan-application-actions">
      {hasWork && <Button className="min-h-11" size="sm" disabled={disabled} onClick={restore}>Restore open work</Button>}
      {receipt && !hasWork && <Button className="min-h-11" size="sm" disabled={disabled} onClick={openRestoredWork}>Open restored work</Button>}
      <Button className="min-h-11" size="sm" variant="outline" disabled={disabled} onClick={openAssignment}>Review staff assignment</Button>
    </div>
  </section>;
}

export function FileInventoryComparison({ comparison, supplied, category }: {
  comparison: CutoverFileComparison | null; supplied: boolean; category: string;
}) {
  if (!comparison) return <p className="muted">{supplied ? "This inventory cannot be compared. Review the loan evidence and refresh the checklist." : "Include this category in the source inventory to compare it."}</p>;
  const differences = comparison.rows.filter(({ status }) => status !== "Matched");
  const matches = comparison.rows.filter(({ status }) => status === "Matched");
  const missing = differences.filter(({ status }) => status === "Missing").length;
  return <section className="record-form" aria-label={`${category} comparison`}>
    <div className="loan-application-actions">
      <span className="pill">{matches.length} matched</span>
      <span className="pill">{differences.length - missing} changed or added</span>
      <span className={missing ? "open-chip" : "pill"}>{missing} missing in Orbit</span>
    </div>
    {missing > 0 && <p className="muted">Restore the missing source records on this loan before reconciling.</p>}
    {differences.length > 0 && <ComparisonRows rows={differences} />}
    {!comparison.rows.length && <p className="empty-inline">The source and this loan have no records in this category.</p>}
    {matches.length > 0 && <details className="document-form">
      <summary>View matched records</summary>
      <ComparisonRows rows={matches} />
    </details>}
  </section>;
}
