"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import type { StaffApplication } from "@/lib/application-model";
import { campaignManualSubmission } from "@/lib/call-campaign-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { Submission } from "@/lib/model";
import { exportName, mismoHandoffCoverage, suggestExportName, type ExportName } from "@/lib/lender-export-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

const nameFields = [
  ["first", "First name"], ["middle", "Middle name"], ["last", "Last name"], ["suffix", "Suffix"],
] as const;

export function ManualLenderExport({ application, busy, save, campaign, linkedFile, openConditions }: {
  application: StaffApplication;
  busy: boolean;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
  campaign?: { submission?: Submission; openConditions: (id: string) => void };
  linkedFile?: Submission;
  openConditions: (id: string) => void;
}) {
  const originals = application.draft ? [application.draft.borrowerName,
    ...application.draft.urla.additional.map((person) => person.identity.fields.name)] : [];
  const [names, setNames] = useState(() => originals.map(suggestExportName));
  const [confirmed, setConfirmed] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const acknowledgmentAttempt = useRef<string | null>(null);
  const linkedAttempt = useRef<{ key: string; id: string } | null>(null);
  const ready = application.reviewedAt && application.submittedAt && !application.correctionNote && application.draft?.confirmedDemo;
  const valid = names.length > 0 && names.every((item) => exportName.safeParse(item).success);
  const handoff = application.manualHandoff;
  const existing = handoff?.outcome === "Acknowledged" ? campaign?.submission : undefined;

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
    {ready && campaign && <section className="document-item" aria-label="Simulated lender acknowledgment">
      <div className="document-item-head"><strong>Fictional lender acknowledgment</strong><span className="pill">Demo</span></div>
      <p className="muted">{existing ? "The acknowledgment is recorded for this revision." :
        handoff?.exportPrepared ? "Record the simulated response and open the fictional lender checklist." :
          "Prepare the MISMO download to enable acknowledgment for this revision."}</p>
      <div><Button size="sm" disabled={busy || !handoff?.exportPrepared} onClick={() => {
        if (existing) {
          campaign.openConditions(existing.id);
          return;
        }
        void save({
          type: "acknowledgeCampaignLenderExport", loanId: application.loanId, revision: application.revision,
          lenderRevision: application.lender?.revision ?? 0, eventId: acknowledgmentAttempt.current ??= crypto.randomUUID(),
        }, ({ state }) => {
          acknowledgmentAttempt.current = null;
          const updated = state.applications.find((item) => item.loanId === application.loanId);
          const submission = campaignManualSubmission(state.submissions, application.loanId);
          if (updated?.manualHandoff?.outcome === "Acknowledged" && submission) campaign.openConditions(submission.id);
        });
      }}>{existing ? "Open fictional lender conditions" : "Record simulated acknowledgment"}</Button></div>
    </section>}
    {ready && !campaign && handoff?.exportPrepared && <section className="document-item" aria-label="Manual lender acknowledgment">
      <div className="document-item-head"><strong>Lender acknowledgment</strong><span className="pill">Manual</span></div>
      {linkedFile ? <>
        <p className="muted">Acknowledged by {linkedFile.lender} · {linkedFile.externalId}</p>
        <Button size="sm" onClick={() => openConditions(linkedFile.id)}>Open lender conditions</Button>
      </> : <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const input = { type: "recordManualHandoff", loanId: application.loanId, revision: application.revision,
          lenderRevision: application.lender?.revision ?? 0, outcome: "Acknowledged", note: "",
          lenderFile: { lender: fields.get("lender"), externalId: fields.get("externalId") } };
        const key = JSON.stringify(input);
        if (linkedAttempt.current?.key !== key) linkedAttempt.current = { key, id: crypto.randomUUID() };
        void save({ ...input, eventId: linkedAttempt.current.id }, () => { linkedAttempt.current = null; });
      }}>
        <p className="muted">After the lender confirms receipt, record its reference to open or reuse a condition checklist on this loan.</p>
        <div className="form-grid">
          <label className="field">Lender name<input name="lender" required maxLength={160} /></label>
          <label className="field">Lender file reference<input name="externalId" required maxLength={160} /></label>
        </div>
        <div><Button size="sm" type="submit" disabled={busy}>Record lender acknowledgment</Button></div>
      </form>}
    </section>}
  </details>;
}
