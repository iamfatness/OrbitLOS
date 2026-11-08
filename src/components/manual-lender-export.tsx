"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import type { StaffApplication } from "@/lib/application-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { exportName, mismoHandoffCoverage, suggestExportName, type ExportName } from "@/lib/lender-export-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

const nameFields = [
  ["first", "First name"], ["middle", "Middle name"], ["last", "Last name"], ["suffix", "Suffix"],
] as const;

export function ManualLenderExport({ application, busy, save }: {
  application: StaffApplication;
  busy: boolean;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
}) {
  const originals = application.draft ? [application.draft.borrowerName,
    ...application.draft.urla.additional.map((person) => person.identity.fields.name)] : [];
  const [names, setNames] = useState(() => originals.map(suggestExportName));
  const [confirmed, setConfirmed] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const ready = application.reviewedAt && application.submittedAt && !application.correctionNote && application.draft?.confirmedDemo;
  const valid = names.length > 0 && names.every((item) => exportName.safeParse(item).success);

  return <details className="application-review" id="manual-lender-export">
    <summary>Manual lender export</summary>
    <p className="muted">Use MISMO 3.4 XML for a manual upload rehearsal. Check the lender’s import profile and required fields before a live handoff.</p>
    {!ready ? <p className="muted">Review the current submitted pilot 1003 to unlock the download.</p> :
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || !valid) return;
        const input = { type: "exportReviewedApplication", loanId: application.loanId, revision: application.revision,
          lenderRevision: application.lender?.revision ?? 0, names };
        const key = JSON.stringify(input);
        if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
        void save({ ...input, eventId: attempt.current.id }, ({ mismoXml }) => {
          if (mismoXml) {
            downloadSampleFile(mismoXml, `orbit-fictional-1003-r${application.revision}.xml`, "application/xml");
            attempt.current = null;
          }
        });
      }}>
        <div>
          <p><strong>Mapped fields</strong> · {mismoHandoffCoverage.mapped}</p>
          <p><strong>Portal review</strong> · {mismoHandoffCoverage.review}</p>
        </div>
        {names.map((name, index) => <fieldset key={index} className="record-form">
          <legend>Borrower {index + 1} · {originals[index]}</legend>
          <div className="form-grid">
            {nameFields.map(([key, label]) => <label className="field" key={key}>{label}<input type="text"
              value={name[key]} required={key === "first" || key === "last"} maxLength={key === "suffix" ? 20 : 160} disabled={busy}
              onChange={(event) => {
                const value = event.target.value;
                setNames((previous) => previous.map((item, position): ExportName => position === index ? { ...item, [key]: value } : item));
                setConfirmed(false);
              }} /></label>)}
          </div>
        </fieldset>)}
        <label><input type="checkbox" checked={confirmed} disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)} /> I verified the borrower names for this fictional export.</label>
        <div><Button size="sm" type="submit" disabled={busy || !confirmed || !valid}><Download /> Download MISMO 3.4 XML</Button></div>
      </form>}
  </details>;
}
