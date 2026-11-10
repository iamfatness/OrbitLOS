"use client";

import { useRef, useState } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { InventoryBucket } from "@/lib/compliance-case-model";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Inventory = Extract<ComplianceCaseResult, { kind: "inventory" }>;

export function ComplianceInventory({ brokerageId, openLoan, initiallyOpen }: { brokerageId: string; openLoan: (id: string) => void; initiallyOpen?: boolean }) {
  const [data, setData] = useState<Inventory>();
  const [bucket, setBucket] = useState<InventoryBucket>();
  const [laterPage, setLaterPage] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function load(selected?: InventoryBucket, next?: Inventory["next"], advance?: number) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await accessComplianceCases(advance === undefined ? { type: "inventory", bucket: selected, after: next ?? undefined } :
        { type: "advanceInventory", revision: advance }, brokerageId);
      if ("error" in result) { setData(undefined); setError(result.error); }
      else if (result.kind === "inventory") { setData(result); setBucket(selected); setLaterPage(Boolean(next)); }
    } catch { setError("Could not update the file inventory. Try again."); }
    finally { busy.current = false; setPending(false); }
  }

  const state = data?.state;
  const progress = !data ? pending ? "Loading inventory…" : "Inventory unavailable." :
    state === "Not started" ? "Scan existing files for this pilot’s Michigan purchase sample." :
      state === "Stale" ? "A loan or sample evidence changed. Rebuild the inventory for current counts." :
        state === "Scanning" ? `${data.scanned} files scanned so far. Counts cover scanned files only.` :
          `${data.scanned} ${data.scanned === 1 ? "file" : "files"} inventoried${data.asOf ? ` as of ${dateTime(data.asOf)} ET` : ""}.`;

  return <details className="document-form compliance-inventory" open={initiallyOpen} onToggle={(event) => { if (event.currentTarget.open) void load(bucket); }}>
    <summary>Fictional file inventory</summary>
    <section className="document-item record-form" aria-label="Fictional file inventory">
      <div><Button size="sm" variant="outline" disabled={pending} onClick={() => void load(bucket)}>Refresh inventory</Button></div>
      <p role="status" className="muted">{pending && data ? "Updating inventory…" : progress}</p>
      {error && <p role="alert">{error}</p>}
      {data && state !== "Complete" && <div><Button size="sm" disabled={pending} onClick={() => void load(undefined, null, data.revision)}>
        {state === "Stale" ? "Rebuild inventory" : state === "Scanning" ? "Scan next batch" : "Start inventory"}</Button></div>}
      {data && (state === "Complete" || state === "Scanning") && <>
        <div className="loan-application-actions" role="group" aria-label="Inventory categories">
          {data.counts.map(({ bucket: label, count }) => <Button key={label} size="sm" variant="outline" aria-pressed={bucket === label}
            disabled={pending || count === 0} onClick={() => void load(label)}>{label} · {count}</Button>)}
        </div>
        {bucket && <div className="record-form" aria-label={bucket}>
          <h4>{bucket}</h4>
          {data.files.length ? <ul className="loan-task-list">{data.files.map((file) => <li className="loan-task compliance-row" key={file.loanId}>
            <strong>{file.name}</strong><Button size="sm" variant="outline" aria-label={`Open ${file.name}`} onClick={() => openLoan(file.loanId)}>Open file</Button>
          </li>)}</ul> : <p className="muted">No files in this category.</p>}
          {(laterPage || data.next) && <div className="loan-application-actions">
            {laterPage && <Button size="sm" variant="outline" disabled={pending} onClick={() => void load(bucket)}>First inventory page</Button>}
            {data.next && <Button size="sm" variant="outline" disabled={pending} onClick={() => void load(bucket, data.next)}>Next inventory page</Button>}
          </div>}
        </div>}
      </>}
    </section>
  </details>;
}
