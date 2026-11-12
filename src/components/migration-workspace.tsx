"use client";

import { Activity, useEffect, useRef, useState } from "react";
import { readMigrationRecovery, readPipelineExport } from "@/app/actions";
import { borrowerChannelBlocked, borrowerChannels } from "@/lib/borrower-channel-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";
import { MigrationCutoverChecklist } from "./migration-cutover";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { MigrationDestination } from "@/lib/migration-record-model";
import { mappedMigrationRows, migrationColumns, migrationExample, migrationFile, migrationFileByteLimit, requiredMigrationColumns,
  type MigrationInput, type MigrationRecoveryReview, type MigrationReport } from "@/lib/pipeline-migration-model";
import { mismoBorrowerName, mismoExample, mismoMapping, readMismo } from "@/lib/mismo-rehearsal-model";
import { LoanContactPicker } from "./loan-contact-picker";
import { MigrationRecordLink } from "./migration-record-link";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce?: boolean) => Promise<void>;

function ChannelEvidence({ requested, blocked, projected }: { requested: number; blocked: number | null; projected?: boolean }) {
  const labels = (mask: number) => borrowerChannels.filter((channel) => borrowerChannelBlocked(mask, channel)).join(", ") || "None";
  return <>
    <small>Source blocks · {labels(requested)}</small>
    <small>{projected ? "Record blocks after import" : "Blocked in Orbit"} · {blocked === null ? "Destination unavailable" : labels(blocked)}</small>
    {!projected && (blocked === null || (blocked & requested) !== requested) && <small>Review current preferences</small>}
  </>;
}

function PipelineMigration({ busy, save, brokerageId, openRecord, reviewCutover }: {
  busy: boolean; save: Save; brokerageId: string; openRecord: (destination: MigrationDestination) => void;
  reviewCutover: (origin: string) => void;
}) {
  const [file, setFile] = useState<ReturnType<typeof migrationFile>>();
  const [mapping, setMapping] = useState<ReturnType<typeof migrationFile>["mapping"]>({});
  const [decisions, setDecisions] = useState<MigrationInput["decisions"]>({});
  const [ownerMappings, setOwnerMappings] = useState<NonNullable<MigrationInput["ownerMappings"]>>({});
  const [correctionKeys, setCorrectionKeys] = useState<string[]>();
  const [report, setReport] = useState<MigrationReport>();
  const [reportOrigin, setReportOrigin] = useState("");
  const [applied, setApplied] = useState(false);
  const [stale, setStale] = useState(false);
  const [origin, setOrigin] = useState("crm-demo");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [prepared, setPrepared] = useState<{ origin: string; snapshot: string; batches: { part: number; csv: string }[] }>();
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const ownership = report?.ownership;
  const undoRows = report?.rows.filter((row) => row.status === "Undone" || row.correction) ?? [];
  const preferenceRows = report?.rows.filter((row) => row.channelBlocks).length ?? 0;

  useEffect(() => { if (report) resultHeading.current?.focus(); }, [report]);

  async function downloadExport() {
    setExporting(true);
    setExportMessage("");
    setExportError("");
    setCopyMessage("");
    setPrepared(undefined);
    try {
      const result = await readPipelineExport(brokerageId);
      if (typeof result.error === "string") setExportError(result.error);
      else if (result.batches) {
        setPrepared(result);
        if (result.batches.length === 1) {
          downloadSampleFile(result.batches[0].csv, `${result.origin}-crm.csv`, "text/csv;charset=utf-8");
          setExportMessage(`Downloaded ${result.total} CRM records.`);
        } else {
          setExportMessage(`Prepared ${result.batches.length} batches for ${result.total} CRM records.`);
        }
      }
    } catch {
      setExportError("Could not prepare the CRM export. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function copyBatch(csv: string, part: number) {
    setCopyMessage("");
    try {
      await navigator.clipboard.writeText(csv);
      setCopyMessage(`Batch ${part} copied. Paste it into Migration in the destination workspace.`);
    } catch {
      setCopyMessage("Could not copy the CSV. Use the downloaded file instead.");
    }
  }

  function load(csv: string) {
    setError("");
    setReport(undefined);
    setDecisions({});
    setOwnerMappings({});
    setCorrectionKeys(undefined);
    setFile(undefined);
    try {
      if (new TextEncoder().encode(csv).byteLength > migrationFileByteLimit) throw new Error("Choose a smaller CSV file.");
      const parsed = migrationFile(csv);
      setFile(parsed);
      setMapping(parsed.mapping);
      if (parsed.orbitSource || file?.orbitSource) setOrigin(parsed.orbitSource ?? "crm-demo");
    } catch (error) { setError((error as Error).message); }
  }

  function run(commit: boolean) {
    if (!file) return;
    setError("");
    try {
      const rows = mappedMigrationRows(file, mapping);
      void save({ type: "migratePipeline", origin, rows, decisions, ownerMappings, correctionKeys, batch: file.batch, preview: commit ? report?.fingerprint : undefined }, (result) => {
        setReport(result.migration);
        setReportOrigin(origin.trim().toLowerCase());
        setApplied(commit || result.migration?.batch?.completed === true);
        setStale(false);
      }, commit);
    } catch (error) { setError((error as Error).message); }
  }

  return <section className="integration record-form manager-panel" aria-label="CRM migration">
    <h2>CRM import and export</h2>
    <div className="record-form">
      <h3>Export CRM records</h3>
      <p className="muted">Contacts, open leads, follow-ups, callback promises, and contact restrictions. Up to 1,000 records and 2 MB.</p>
      <div><Button variant="outline" size="sm" disabled={busy || exporting} onClick={() => void downloadExport()}>
        {exporting ? "Preparing export…" : "Download CRM export"}</Button></div>
      {exportMessage && <p role="status" className="muted">{exportMessage}</p>}
      {prepared && <>
        {prepared.batches.length > 1 && <p className="muted">Import every batch in order. The destination saves your progress.</p>}
        <div className="loan-application-actions">{prepared.batches.map(({ part, csv }) =>
          <div className="loan-application-actions" key={part}>
            {prepared.batches.length > 1 && <Button variant="outline" size="sm" onClick={() => {
              const number = String(part).padStart(3, "0");
              downloadSampleFile(csv, `${prepared.origin}-${prepared.snapshot.slice(0, 8)}-part-${number}.csv`, "text/csv;charset=utf-8");
            }}>Download batch {part}</Button>}
            <Button variant="outline" size="sm" onClick={() => void copyBatch(csv, part)}>
              {prepared.batches.length > 1 ? `Copy batch ${part}` : "Copy CRM CSV"}
            </Button>
          </div>)}</div>
      </>}
      {copyMessage && <p role="status" className="muted">{copyMessage}</p>}
      {exportError && <p role="alert" className="application-error">{exportError}</p>}
    </div>
    <h3>Import CRM records</h3>
    <div className="loan-application-actions">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => load(migrationExample)}>Load sample CSV</Button>
      <Button variant="outline" size="sm" onClick={() => downloadSampleFile(migrationExample, "orbit-fictional-crm.csv", "text/csv")}>Download template</Button>
    </div>
    <div className="form-grid">
      <label className="field">Fictional CRM CSV<input type="file" accept=".csv,text/csv" aria-describedby="crm-import-limits" disabled={busy} onChange={async (event) => {
        const input = event.currentTarget;
        const selected = input.files?.[0];
        if (selected) load(selected.size <= migrationFileByteLimit ? await selected.text() : " ".repeat(migrationFileByteLimit + 1));
        input.value = "";
      }} /></label>
      <label className="field">Source key<input maxLength={60} value={origin} disabled={busy} readOnly={Boolean(file?.batch)} onChange={(event) => {
        setOrigin(event.target.value); setReport(undefined); setDecisions({}); setOwnerMappings({});
        setCorrectionKeys((current) => current && []);
      }} /></label>
    </div>
    <p className="muted" id="crm-import-limits">Up to 100 records per CSV, with a 200 kB file limit. Orbit exports can include tracked callback promises and their call evidence.</p>
    <details className="document-form"><summary>Source keys and staff ownership</summary>
      <p className="muted">Orbit exports include the source key. Active staff keep their records. Reassign missing owners in the preview or leave their work unassigned.</p>
    </details>
    <details className="document-form"><summary>Import contact restrictions</summary>
      <p className="muted">Map Do Not Call, Email Opt Out, or Text Opt Out to the matching channel. An affirmative value adds a block. Blank and negative values leave existing preferences in place. Use Opted Out for a brokerage-wide opt-out.</p>
    </details>
    <details className="document-form">
      <summary>Paste CRM CSV</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const csv = new FormData(form).get("csv");
        if (typeof csv === "string") load(csv);
        form.closest("details")?.removeAttribute("open");
      }}>
        <label className="field">CRM CSV text<textarea name="csv" rows={4} required disabled={busy} spellCheck={false} /></label>
        <div><Button size="sm" type="submit" disabled={busy}>Load pasted CSV</Button></div>
      </form>
    </details>
    {file?.batch && <p className="muted">Batch {file.batch.part} of {file.batch.partCount}</p>}
    {file && <details open={requiredMigrationColumns.some((column) => file.mapping[column] === undefined) || undefined} className="document-form">
      <summary>Column mapping · {file.rows.length} {file.rows.length === 1 ? "record" : "records"}</summary>
      <div className="form-grid">
        {migrationColumns.map((column) => <label className="field" key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}{requiredMigrationColumns.includes(column) ? " (required)" : ""}
          <select disabled={busy} value={mapping[column] ?? ""} onChange={(event) => {
            const index = event.target.value;
            setMapping((previous) => ({ ...previous, [column]: index === "" ? undefined : Number(index) }));
            setReport(undefined);
            setDecisions({});
            setOwnerMappings({});
            setCorrectionKeys((current) => current && []);
          }}>
            <option value="">Unmapped</option>
            {file.header.map((value, index) => <option key={index} value={index}>{value || `Column ${index + 1}`}</option>)}
          </select>
        </label>)}
      </div>
    </details>}
    {file && <div className="record-form">
      <label><input type="checkbox" disabled={busy} checked={Boolean(correctionKeys)} onChange={(event) => {
        setCorrectionKeys(event.target.checked ? [] : undefined);
        setReport(undefined); setDecisions({}); setOwnerMappings({});
      }} /> Reimport selected undone rows</label>
      {correctionKeys && <p className="muted">Use the same source key and external IDs. Select the undone rows you want to reimport after previewing the corrected file.</p>}
    </div>}
    {error && <p role="alert" className="application-error">{error}</p>}
    {file && <div><Button disabled={busy} variant="outline" onClick={() => run(false)}>{correctionKeys ? "Preview corrections" : "Preview migration"}</Button></div>}
    {report && <div className="record-form">
      <div className="section-heading"><h3 ref={resultHeading} tabIndex={-1}>{correctionKeys ? applied ? "Correction reconciliation" : "Correction preview" : applied ? "Import reconciliation" : "Preview reconciliation"}</h3></div>
      {report.batch?.completed && <p role="status" className="muted">{report.batch.nextPart === null
        ? "All numbered batches received. Check source links and undone rows in the cutover checklist."
        : `Next, load batch ${report.batch.nextPart}.`}</p>}
      <p className="muted">{(["Create", "Reuse contact", "Previously imported", "Skipped", "Suppressed", "Undone", "Review"] as const)
        .flatMap((status) => {
          const count = report.rows.filter((row) => row.status === status).length;
          return count ? [`${count} ${status === "Create" ? applied ? "created" : "to create" : status.toLowerCase()}`] : [];
        }).join(" · ")}</p>
      {preferenceRows > 0 && <p className="muted">{preferenceRows} {preferenceRows === 1 ? "record has" : "records have"} channel restrictions from the source.</p>}
      {!applied && ownership && <fieldset className="record-form">
        <legend>Owner mapping</legend>
        <p className="muted">Choose one destination for each missing staff email. Unassigned leads go to the shared inbox. Admins can assign unassigned contact follow-ups later.{file?.batch && " Orbit remembers these choices for later batches in this export."}</p>
        <div className="form-grid">{ownership.missing.map(({ email, count, target }) => {
          const eligible = ownership.eligible;
          const selection = ownerMappings[email] ?? target;
          const valid = selection === "unassigned" || eligible.some((owner) => owner.email === selection);
          return <label className="field" key={email}>
            {email} · {count} {count === 1 ? "record" : "records"}
            <select disabled={busy} value={valid ? selection : ""} onChange={(event) => {
              const choice = event.target.value;
              setOwnerMappings((previous) => ({ ...previous, [email]: choice }));
              setStale(true);
            }}>
              <option value="" disabled>Choose a destination</option>
              <option value="unassigned">Leave unassigned</option>
              {eligible.map((owner) => <option key={owner.email} value={owner.email}>{owner.name} · {owner.email}</option>)}
            </select>
          </label>;
        })}</div>
      </fieldset>}
      {correctionKeys && !applied && undoRows.length > 0 && <div className="loan-application-actions" aria-label="Undo row selection" role="group">
        <span className="muted">{correctionKeys.length} of {undoRows.length} undo rows selected</span>
        <Button variant="outline" size="sm" disabled={busy || correctionKeys.length === undoRows.length} onClick={() => {
          setCorrectionKeys(undoRows.map(({ key }) => key));
          setStale(true);
        }}>Select all undo rows</Button>
        <Button variant="ghost" size="sm" disabled={busy || correctionKeys.length === 0} onClick={() => {
          setCorrectionKeys([]);
          setStale(true);
        }}>Clear selection</Button>
      </div>}
      <div className="table-scroll migration-evidence" tabIndex={0} role="region" aria-label="CRM reconciliation records"><table className="data-table" role="table"><thead><tr role="row">
        <th role="columnheader" scope="col">Source record</th><th role="columnheader" scope="col">Result</th><th role="columnheader" scope="col">{applied ? "Orbit record" : "Resolution"}</th></tr></thead>
        <tbody role="rowgroup">{report.rows.map((row) => <tr key={row.key} role="row">
          <td role="cell"><strong>{row.label}</strong>{row.propertyState && <small className="muted">CSV property state · {row.propertyState}</small>}<small>{row.key}</small></td><td role="cell">{row.status === "Previously imported" && row.channelBlocks?.added ?
            applied ? "Preferences updated" : "Update preferences" : applied && row.correction && (row.status === "Create" || row.status === "Reuse contact")
            ? "Reimported" : applied && row.status === "Create" ? "Created" : row.status}<small>{row.detail}</small>
            {row.channelBlocks && <ChannelEvidence {...row.channelBlocks} projected={!applied} />}</td>
          <td role="cell">{applied ? row.targetId && reportOrigin ? <MigrationRecordLink key={`${reportOrigin}:${row.targetId}`} brokerageId={brokerageId}
            query={{ type: "result", origin: reportOrigin, key: row.key, targetId: row.targetId }} busy={busy} open={openRecord}
            label={row.key.startsWith("Note:") || row.key.startsWith("Task:") ? "Open evidence" : "Open record"} /> : "—" : <div className="record-form">
            {correctionKeys && (row.status === "Undone" || row.correction) && <label>
              <input type="checkbox" aria-label={`Reimport ${row.key}`} disabled={busy} checked={correctionKeys.includes(row.key)} onChange={(event) => {
                const selected = event.target.checked;
                setCorrectionKeys((current) => selected ? [...current ?? [], row.key] : current?.filter((key) => key !== row.key));
                setStale(true);
              }} /> Reimport this row
            </label>}
            {(!correctionKeys || row.correction) && (row.status === "Review" || row.status === "Skipped" || row.status === "Reuse contact") &&
            <select aria-label={`Resolve ${row.key}`} disabled={busy} value={decisions[row.key] ?? ""} onChange={(event) => {
              const choice = event.target.value;
              setDecisions((previous) => ({ ...previous, [row.key]: choice }));
              setStale(true);
            }}>
              <option value="">Review again</option><option value="skip">Skip record</option>
              {(row.matches ?? (row.status === "Reuse contact" && row.targetId ? [{ id: row.targetId, label: row.detail }] : []))
                .map((match) => <option key={match.id} value={match.id}>Reuse {match.label}</option>)}
            </select>}
          </div>}</td>
        </tr>)}</tbody></table></div>
      {applied && reportOrigin && <div><Button variant="outline" disabled={busy}
        aria-label={`Review cutover checklist for ${reportOrigin}`} onClick={() => reviewCutover(reportOrigin)}>Review cutover checklist</Button></div>}
      {!applied && <div className="record-form">
        {stale ? <p className="muted">Preview again to apply your choices and check related records.</p>
          : report.rows.some((row) => row.status === "Review") && <p className="muted">Resolve or skip the {report.rows.filter((row) => row.status === "Review").length} records marked Review, then preview again before importing.</p>}
        {(stale || report.rows.some((row) => row.status === "Review")) && <div><Button variant="outline" disabled={busy} onClick={() => run(false)}>Preview updated choices</Button></div>}
        <Button disabled={busy || stale || report.rows.some((row) => row.status === "Review") ||
          Boolean(correctionKeys && !report.rows.some((row) => row.correction && (row.status === "Create" || row.status === "Reuse contact")))}
          onClick={() => run(true)}>{correctionKeys ? "Import reviewed corrections" : "Import reviewed records"}</Button>
      </div>}
    </div>}
  </section>;
}

function MigrationRecovery({ brokerageId, busy, save, openRecord }: {
  brokerageId: string; busy: boolean; save: Save; openRecord: (destination: MigrationDestination) => void;
}) {
  const [review, setReview] = useState<MigrationRecoveryReview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const preview = review?.preview;
  const candidates = preview?.rows.filter((row) => row.result === "Candidate").length ?? 0;

  async function load(importId?: string) {
    setLoading(true);
    setError("");
    setConfirmed(false);
    try {
      const result = await readMigrationRecovery(brokerageId, importId);
      if ("error" in result) setError(result.error);
      else setReview(result);
    } catch {
      setError("Could not load CRM import recovery. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function undo() {
    if (!preview || !candidates || !confirmed) return;
    setConfirmed(false);
    void save({ type: "undoMigration", importId: preview.receipt.id, fingerprint: preview.fingerprint, confirmed: true },
      () => { void load(preview.receipt.id); });
  }

  return <section className="integration record-form manager-panel" aria-label="CRM import recovery">
    <div><h2>CRM import recovery</h2><p>Preview changes and undo eligible records from a fictional CRM import. For numbered exports, review later batches first.</p></div>
    <div><Button size="sm" variant="outline" disabled={busy || loading} onClick={() => void load()}>Load recent CRM imports</Button></div>
    {loading && <p role="status" className="muted">Checking import history…</p>}
    {error && <p role="alert" className="application-error">{error}</p>}
    {review && (review.imports.length ? <label className="field">Import receipt
      <select value={preview?.receipt.id ?? ""} disabled={busy || loading} onChange={(event) => void load(event.target.value)}>
        <option value="" disabled>Choose an import to review</option>
        {review.imports.map((receipt) => <option key={receipt.id} value={receipt.id}>
          {receipt.origin}{receipt.part ? ` · Batch ${receipt.part} of ${receipt.partCount}` : ""}{receipt.correctedCount ? ` · ${receipt.correctedCount} corrected` : ""} · {receipt.recordCount} rows · {new Date(receipt.importedAt).toLocaleString()}
        </option>)}
      </select>
    </label> : <p className="muted">Recovery receipts appear here after an import creates or reuses records, or adds contact restrictions.</p>)}
    {preview && <div className="record-form">
      <h3>Recovery preview</h3>
      <p className="muted">Imported by {preview.receipt.importedBy}. Check the current record state before any correction.</p>
      <p role="status" className="muted">{candidates} undo candidates · {preview.rows.filter((row) => row.result === "Keep").length} to keep · {preview.rows.filter((row) => row.result === "No change").length} with no change · {preview.rows.filter((row) => row.result === "Removed").length} removed</p>
      <div><Button size="sm" variant="outline" disabled={busy || loading} onClick={() => void load(preview.receipt.id)}>Refresh recovery preview</Button></div>
      <div className="table-scroll migration-evidence" tabIndex={0} role="region" aria-label="CRM recovery records"><table className="data-table" role="table"><thead><tr role="row">
        <th role="columnheader" scope="col">Source record</th><th role="columnheader" scope="col">Recovery result</th><th role="columnheader" scope="col">Orbit record</th></tr></thead>
        <tbody role="rowgroup">{preview.rows.map((row) => <tr key={row.key} role="row">
          <td role="cell"><strong>{row.label}</strong><small>{row.key}{row.correction && " · Corrected reimport"}</small></td>
          <td role="cell">{row.result === "Candidate" ? "Undo candidate" : row.result}<small>{row.reason}</small>
            {row.channelBlocks && <ChannelEvidence {...row.channelBlocks} />}
            {row.removal && <small>{row.removal.by} · {new Date(row.removal.at).toLocaleString()}</small>}</td>
          {row.canOpen ? <td role="cell"><MigrationRecordLink key={preview.receipt.id} brokerageId={brokerageId}
            query={{ type: "receipt", origin: preview.receipt.origin, key: row.key, receiptId: preview.receipt.id }} busy={busy || loading}
            open={openRecord} label={row.key.startsWith("Note:") || row.key.startsWith("Task:") ? "Open evidence" : "Open record"} /></td> : <td role="cell">—</td>}
        </tr>)}</tbody></table></div>
      {candidates > 0 && <div className="record-form">
        <label><input type="checkbox" disabled={busy || loading} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed the undo candidates and want to remove them.</label>
        <div><Button variant="danger" disabled={busy || loading || !confirmed} onClick={undo}>Undo {candidates} {candidates === 1 ? "record" : "records"}</Button></div>
      </div>}
    </div>}
  </section>;
}

function LoanFileRehearsal({ busy, save, openLoan, brokerageId }: { busy: boolean; save: Save; openLoan: (id: string) => void; brokerageId: string }) {
  const [preview, setPreview] = useState<ReturnType<typeof readMismo>>();
  const [requestId, setRequestId] = useState("");
  const [fictional, setFictional] = useState(false);
  const [error, setError] = useState("");
  const [contactChoice, setContactChoice] = useState("");
  const [importedLoanId, setImportedLoanId] = useState<string>();
  const [duplicateLoanId, setDuplicateLoanId] = useState<string>();
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const chosen = contactChoice === "new" ? undefined : contactChoice || undefined;
  function load(xml: string) {
    setError("");
    setPreview(undefined);
    setFictional(false);
    setContactChoice("");
    setImportedLoanId(undefined);
    setDuplicateLoanId(undefined);
    try {
      setPreview(readMismo(xml));
      setRequestId(crypto.randomUUID());
    } catch (error) { setError((error as Error).message); }
  }
  async function createDraft(confirmedDuplicateLoanId?: string) {
    if (!preview) return;
    let imported: string | undefined;
    await save({ type: "importMismo", requestId, fields: preview.fields, extraBorrowers: preview.extraBorrowers, existingContactId: chosen, fictional, confirmedDuplicateLoanId },
      ({ applicationLoanId, mismoDuplicateLoanId }) => {
        if (!active.current) return;
        setDuplicateLoanId(mismoDuplicateLoanId);
        if (applicationLoanId) {
          setImportedLoanId(applicationLoanId);
          imported = applicationLoanId;
        }
      });
    if (imported && active.current) openLoan(imported);
  }
  return <section className="integration record-form manager-panel" aria-label="MISMO 3.4 import">
    <h2>Import MISMO 3.4</h2>
    <details className="document-form"><summary>What the pilot imports and exports</summary>
      <p className="muted">Review mapped values for one fictional loan. Enter employment, finances, additional borrowers, and identifiers in the 1003. The pilot export contains the reviewed XML fields. Lender extensions require separate review.</p>
    </details>
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => load(mismoExample)}>Load sample XML</Button>
      <Button size="sm" variant="outline" onClick={() => downloadSampleFile(mismoExample, "orbit-fictional-input.xml", "application/xml")}>Download sample XML</Button>
    </div>
    <label className="field">Fictional MISMO XML<input type="file" accept=".xml,text/xml,application/xml" aria-describedby="mismo-import-limit" disabled={busy} onChange={async (event) => {
      const input = event.currentTarget;
      const selected = input.files?.[0];
      input.value = "";
      if (selected) load(selected.size <= 600_000 ? await selected.text() : " ".repeat(600_001));
    }} /></label>
    <p className="muted" id="mismo-import-limit">One fictional loan per XML file, up to 600 kB.</p>
    {error && <p role="alert" className="application-error">{error}</p>}
    {preview && <>
      {preview.extraBorrowers > 0 && <p className="application-message">{preview.extraBorrowers} additional borrower records will need manual entry.</p>}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>1003 field</th><th>XML location</th><th>Draft value</th></tr></thead>
        <tbody>{mismoMapping.map(([key, label, path]) => <tr key={key}><td>{label}</td><td>{path}</td>
          <td>{preview.fields[key] || (key === "middleName" || key === "suffix" ? "—" : "Review in 1003")}</td></tr>)}</tbody>
      </table></div>
      <LoanContactPicker key={requestId} kind="borrower" brokerageId={brokerageId} value={contactChoice} initialId=""
        initialSearch={mismoBorrowerName(preview.fields)} requireBorrowerChoice disabled={busy || !!importedLoanId}
        onChange={(id) => { setContactChoice(id); setDuplicateLoanId(undefined); }} />
      {chosen && <p className="muted">The draft keeps the XML name and property fields and prefills the selected contact’s email and phone.</p>}
      <label><input type="checkbox" checked={fictional} disabled={busy || !!importedLoanId} onChange={(event) => setFictional(event.target.checked)} /> I confirmed the reviewed values are fictional.</label>
      {duplicateLoanId ? <section className="work-queue" aria-label="Matching MISMO import">
        <h3>Matching MISMO import</h3>
        <p className="muted">This borrower already has a 1003 imported with the same reviewed XML values.</p>
        <div className="loan-application-actions">
          <Button disabled={busy} onClick={() => openLoan(duplicateLoanId)}>Open matching 1003</Button>
          <Button variant="outline" disabled={busy || !fictional || !chosen} onClick={() => void createDraft(duplicateLoanId)}>Create separate draft</Button>
        </div>
      </section> : <div>{importedLoanId ? <Button onClick={() => openLoan(importedLoanId)}>Open imported 1003</Button> :
        <Button disabled={busy || !fictional || !contactChoice} onClick={() => void createDraft()}>Create fictional 1003 draft</Button>}</div>}
    </>}
  </section>;
}

export function MigrationWorkspace({ busy, save, openLinkedLoan, openRecord, brokerageId, version }: {
  busy: boolean; save: Save; openLinkedLoan: (id: string, target: string) => void; openRecord: (destination: MigrationDestination) => void;
  brokerageId: string; version: object;
}) {
  const views = ["CRM import and export", "Loan file import", "Cutover checklist", "Import recovery"] as const;
  const [view, setView] = useState<(typeof views)[number]>("CRM import and export");
  const navigation = useRef<HTMLElement>(null);
  const [visit, setVisit] = useState(0);
  const [cutoverEntry, setCutoverEntry] = useState<{ origin: string; visit: number }>();
  useEffect(() => { if (visit) navigation.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus(); }, [visit]);
  function navigate(next: (typeof views)[number]) { setView(next); setVisit(value => value + 1); }
  return <div className="record-form">
    <nav ref={navigation} className="loan-application-actions" aria-label="Migration views">
      {views.map(item => <Button key={item} size="sm" variant={view === item ? "default" : "outline"}
        aria-current={view === item ? "page" : undefined} disabled={busy} onClick={() => navigate(item)}>{item}</Button>)}
    </nav>
    <Activity mode={view === "CRM import and export" ? "visible" : "hidden"}>
      <PipelineMigration busy={busy} save={save} brokerageId={brokerageId} openRecord={openRecord} reviewCutover={(origin) => {
        setCutoverEntry({ origin, visit: visit + 1 });
        navigate("Cutover checklist");
      }} />
    </Activity>
    <Activity mode={view === "Cutover checklist" ? "visible" : "hidden"}>
      <MigrationCutoverChecklist key={`${brokerageId}:${cutoverEntry?.visit ?? 0}`} initialOrigin={cutoverEntry?.origin}
        brokerageId={brokerageId} version={version} busy={busy} openLoan={openLinkedLoan} openRecord={openRecord} save={save} />
    </Activity>
    <Activity mode={view === "Import recovery" ? "visible" : "hidden"}>
      <MigrationRecovery key={brokerageId} brokerageId={brokerageId} busy={busy} save={save} openRecord={openRecord} />
    </Activity>
    <Activity mode={view === "Loan file import" ? "visible" : "hidden"}>
      <LoanFileRehearsal key={brokerageId} busy={busy} save={save} openLoan={(id) => openLinkedLoan(id, "loan-application")} brokerageId={brokerageId} />
    </Activity>
  </div>;
}
