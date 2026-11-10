"use client";

import { useRef, useState } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import type { MigrationDestination } from "@/lib/migration-record-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Backfill = Extract<ComplianceCaseResult, { kind: "leadBackfill" }>;

export function ComplianceLeadBackfill({ brokerageId, openRecord }: {
  brokerageId: string; openRecord: (destination: MigrationDestination) => void;
}) {
  const [data, setData] = useState<Backfill>();
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [laterPage, setLaterPage] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function load(filter: boolean, after?: Backfill["next"], revision?: number) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await accessComplianceCases(revision === undefined ? { type: "leadBackfill", unknownOnly: filter, after: after ?? undefined } :
        { type: "advanceLeadBackfill", revision }, brokerageId);
      if ("error" in result) { setData(undefined); setError(result.error); }
      else if (result.kind === "leadBackfill") {
        setData(result);
        setUnknownOnly(filter);
        setLaterPage(Boolean(after));
      }
    } catch { setError("Could not load lead history. Try again."); }
    finally { busy.current = false; setPending(false); }
  }

  const state = data?.state;
  const progress = !data ? pending ? "Loading lead history…" : "Lead history unavailable." :
    state === "Not started" ? "Scan existing fictional leads, activity, and task references." :
      state === "Stale" ? "A source record changed. Rebuild the backfill for current results." :
        state === "Scanning" ? `${data.scanned} records scanned so far. Counts cover scanned records only.` :
          `${data.scanned} ${data.scanned === 1 ? "record" : "records"} backfilled${data.asOf ? ` as of ${dateTime(data.asOf)} ET` : ""}.`;

  return <details className="document-form compliance-inventory" onToggle={(event) => { if (event.currentTarget.open) void load(unknownOnly); }}>
    <summary>Fictional lead history backfill</summary>
    <section className="document-item record-form" aria-label="Fictional lead history backfill">
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void load(unknownOnly)}>Refresh lead history</Button>
        {data && state !== "Complete" && <Button size="sm" disabled={pending} onClick={() => void load(false, null, data.revision)}>
          {state === "Stale" ? "Rebuild lead history" : state === "Scanning" ? "Scan next lead batch" : "Start lead backfill"}</Button>}
      </div>
      <p role="status" className="muted">{pending && data ? "Updating lead history…" : progress}</p>
      {error && <p role="alert">{error}</p>}
      {data && (state === "Complete" || state === "Scanning") && <>
        <label><input type="checkbox" checked={unknownOnly} disabled={pending} onChange={(event) => void load(event.target.checked)} />
          {" "}Show only records without an exact timestamp ({data.unknown})</label>
        {data.entries.length ? <ul className="loan-task-list">{data.entries.map(({ destination, ...entry }) => <li className="loan-task compliance-row" key={`${entry.kind}:${entry.id}`}>
          <div className="loan-task-copy">
            <strong>{entry.name}</strong>
            <span>{entry.kind} · {entry.event} · {entry.source}</span>
            <span>{entry.occurredAt ? `${dateTime(entry.occurredAt)} ET` :
              entry.recordedDate ? `${entry.recordedDate} · Original time unknown` : "Original timestamp unknown"}</span>
            {entry.sourceRef && <span>{entry.sourceRef}</span>}
          </div>
          {destination && <Button size="sm" variant="outline" aria-label={`Open ${entry.loanId ? "loan" : "lead"} for ${entry.name}`}
            onClick={() => openRecord(destination)}>{entry.loanId ? "Open loan" : destination.kind === "archivedLead" ? "Open archive" : "Open lead"}</Button>}
        </li>)}</ul> : <p className="muted">{unknownOnly ? "No scanned records are missing an exact timestamp." : "No lead history records in this scan."}</p>}
        {(laterPage || data.next) && <div className="loan-application-actions">
          {laterPage && <Button size="sm" variant="outline" disabled={pending} onClick={() => void load(unknownOnly)}>First lead history page</Button>}
          {data.next && <Button size="sm" variant="outline" disabled={pending} onClick={() => void load(unknownOnly, data.next)}>Next lead history page</Button>}
        </div>}
      </>}
    </section>
  </details>;
}
