"use client";

import { useState } from "react";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { mappedMigrationRows, migrationColumns, migrationExample, migrationFile, requiredMigrationColumns,
  type MigrationInput, type MigrationReport } from "@/lib/pipeline-migration-model";
import { mismoExample, mismoMapping, readMismo } from "@/lib/mismo-rehearsal-model";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce?: boolean) => Promise<void>;

function PipelineMigration({ busy, save }: { busy: boolean; save: Save }) {
  const [file, setFile] = useState<ReturnType<typeof migrationFile>>();
  const [mapping, setMapping] = useState<ReturnType<typeof migrationFile>["mapping"]>({});
  const [decisions, setDecisions] = useState<MigrationInput["decisions"]>({});
  const [report, setReport] = useState<MigrationReport>();
  const [applied, setApplied] = useState(false);
  const [stale, setStale] = useState(false);
  const [origin, setOrigin] = useState("crm-demo");
  const [error, setError] = useState("");

  function load(csv: string) {
    setError("");
    setReport(undefined);
    setDecisions({});
    setFile(undefined);
    try {
      const parsed = migrationFile(csv);
      setFile(parsed);
      setMapping(parsed.mapping);
    } catch (error) { setError((error as Error).message); }
  }

  function run(commit: boolean) {
    if (!file) return;
    setError("");
    try {
      const rows = mappedMigrationRows(file, mapping);
      void save({ type: "migratePipeline", origin, rows, decisions, preview: commit ? report?.fingerprint : undefined }, (result) => {
        setReport(result.migration);
        setApplied(commit);
        setStale(false);
      }, commit);
    } catch (error) { setError((error as Error).message); }
  }

  return <section className="integration record-form manager-panel" aria-label="CRM migration">
    <div><h2>CRM pipeline migration</h2><p>Load a fictional CRM export, map columns, and reconcile the results before importing.</p></div>
    <p className="muted">Use one CSV with Contact, Lead, Note, and Task records. A lead can reference its contact ID. Notes and tasks reference a lead ID. Use the same source key on later batches from that CRM. Blank owner emails go to the shared inbox.</p>
    <div className="loan-application-actions">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => load(migrationExample)}>Load sample CSV</Button>
      <Button variant="outline" size="sm" onClick={() => downloadSampleFile(migrationExample, "orbit-fictional-crm.csv", "text/csv")}>Download template</Button>
    </div>
    <div className="form-grid">
      <label className="field">Fictional CRM CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async (event) => {
        const selected = event.currentTarget.files?.[0];
        if (selected) load(selected.size <= 200_000 ? await selected.text() : " ".repeat(200_001));
      }} /></label>
      <label className="field">Source key<input maxLength={60} value={origin} disabled={busy} onChange={(event) => {
        setOrigin(event.target.value); setReport(undefined); setDecisions({});
      }} /></label>
    </div>
    {file && <details open={!report || undefined} className="document-form">
      <summary>Column mapping · {file.rows.length} records</summary>
      <div className="form-grid">
        {migrationColumns.map((column) => <label className="field" key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}{requiredMigrationColumns.includes(column) ? " (required)" : ""}
          <select disabled={busy} value={mapping[column] ?? ""} onChange={(event) => {
            const index = event.target.value;
            setMapping((previous) => ({ ...previous, [column]: index === "" ? undefined : Number(index) }));
            setReport(undefined);
            setDecisions({});
          }}>
            <option value="">Unmapped</option>
            {file.header.map((value, index) => <option key={index} value={index}>{value || `Column ${index + 1}`}</option>)}
          </select>
        </label>)}
      </div>
    </details>}
    {error && <p role="alert" className="application-error">{error}</p>}
    {file && <div><Button disabled={busy} variant="outline" onClick={() => run(false)}>Preview migration</Button></div>}
    {report && <div className="record-form">
      <h3>{applied ? "Import reconciliation" : "Preview reconciliation"}</h3>
      <p className="muted">{(["Create", "Reuse contact", "Previously imported", "Skipped", "Review"] as const)
        .map((status) => `${report.rows.filter((row) => row.status === status).length} ${status === "Create" && applied ? "created" : status.toLowerCase()}`).join(" · ")}</p>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Source record</th><th>Result</th><th>{applied ? "Orbit record" : "Resolution"}</th></tr></thead>
        <tbody>{report.rows.map((row) => <tr key={row.key}>
          <td>{row.label}<small>{row.key}</small></td><td>{applied && row.status === "Create" ? "Created" : row.status}<small>{row.detail}</small></td>
          <td>{applied ? row.targetId ?? "—" : (row.status === "Review" || row.status === "Skipped" || row.status === "Reuse contact") &&
            <select aria-label={`Resolve ${row.key}`} disabled={busy} value={decisions[row.key] ?? ""} onChange={(event) => {
              const choice = event.target.value;
              setDecisions((previous) => ({ ...previous, [row.key]: choice }));
              setStale(true);
            }}>
              <option value="">Review again</option><option value="skip">Skip record</option>
              {(row.matches ?? (row.status === "Reuse contact" && row.targetId ? [{ id: row.targetId, label: row.detail }] : []))
                .map((match) => <option key={match.id} value={match.id}>Reuse {match.label}</option>)}
            </select>}</td>
        </tr>)}</tbody></table></div>
      {!applied && <div>
        {stale && <p className="muted">Preview again to apply your choices and check related records.</p>}
        <Button disabled={busy || stale || report.rows.some((row) => row.status === "Review")} onClick={() => run(true)}>Import reviewed records</Button>
      </div>}
    </div>}
  </section>;
}

function LoanFileRehearsal({ busy, save, openLoan }: { busy: boolean; save: Save; openLoan: (id: string) => void }) {
  const [preview, setPreview] = useState<ReturnType<typeof readMismo>>();
  const [requestId, setRequestId] = useState("");
  const [fictional, setFictional] = useState(false);
  const [error, setError] = useState("");
  function load(xml: string) {
    setError("");
    setPreview(undefined);
    setFictional(false);
    try {
      setPreview(readMismo(xml));
      setRequestId(crypto.randomUUID());
    } catch (error) { setError((error as Error).message); }
  }
  return <section className="integration record-form manager-panel" aria-label="Synthetic loan file rehearsal">
    <div><h2>Synthetic MISMO 3.4 rehearsal</h2><p>Review selected XML fields, create a fictional 1003 draft, and export the original mapped values from the loan.</p></div>
    <p className="muted">This rehearsal covers a limited field set for one loan. Employment, finances, additional borrowers, identifiers, and lender extensions stay out of the draft and export. Use the 1003 to review and fill gaps. The rehearsal XML is for pilot review only.</p>
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => load(mismoExample)}>Load sample XML</Button>
      <Button size="sm" variant="outline" onClick={() => downloadSampleFile(mismoExample, "orbit-fictional-input.xml", "application/xml")}>Download sample XML</Button>
    </div>
    <label className="field">Fictional MISMO XML<input type="file" accept=".xml,text/xml,application/xml" disabled={busy} onChange={async (event) => {
      const selected = event.currentTarget.files?.[0];
      if (selected) load(selected.size <= 600_000 ? await selected.text() : " ".repeat(600_001));
    }} /></label>
    {error && <p role="alert" className="application-error">{error}</p>}
    {preview && <>
      {preview.extraBorrowers > 0 && <p className="application-message">{preview.extraBorrowers} additional borrower records will need manual entry.</p>}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>1003 field</th><th>XML location</th><th>Draft value</th></tr></thead>
        <tbody>{mismoMapping.map(([key, label, path]) => <tr key={key}><td>{label}</td><td>{path}</td><td>{preview.fields[key] || "Review in 1003"}</td></tr>)}</tbody>
      </table></div>
      <label><input type="checkbox" checked={fictional} onChange={(event) => setFictional(event.target.checked)} /> I confirmed the reviewed values are fictional.</label>
      <div><Button disabled={busy || !fictional} onClick={() => void save({
        type: "importMismo", requestId, fields: preview.fields, fictional,
      }, ({ applicationLoanId }) => {
        if (applicationLoanId) openLoan(applicationLoanId);
      })}>Create fictional 1003 draft</Button></div>
    </>}
  </section>;
}

export function MigrationWorkspace({ busy, save, openLoan }: { busy: boolean; save: Save; openLoan: (id: string) => void }) {
  return <div className="record-form"><PipelineMigration busy={busy} save={save} /><LoanFileRehearsal busy={busy} save={save} openLoan={openLoan} /></div>;
}
