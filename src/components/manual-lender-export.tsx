"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { submittedRequestedLoanAmount, type StaffApplication } from "@/lib/application-model";
import { dateLabel, easternDate } from "@/lib/client-retention";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { documentRecipients } from "@/lib/document-model";
import type { Submission } from "@/lib/model";
import { nonAgencyManualHandoffMessage } from "@/lib/pricing-model";
import { defaultLenderExportProfile, lenderExportProfile, lenderExportProfiles, manualLenderAcknowledgmentTarget, mismoHandoffCoverage,
  suggestExportName, type ExportName } from "@/lib/lender-export-model";
import { exportCorrectionsTarget, exportNamesTarget, lenderExportIssues, lenderFieldPrefix, type LenderExportIssue } from "@/lib/lender-export-profile";
import { manualQuoteLenderDetails, sameManualQuote, type ManualQuoteBasis } from "@/lib/manual-pricing-model";
import { blankLenderDetails } from "@/lib/urla";
import { downloadSampleFile } from "./sample-download";
import { LenderHandoffShare } from "./lender-handoff-share";
import { Button } from "./ui/button";

const nameFields = [
  ["first", "First name"], ["middle", "Middle name"], ["last", "Last name"], ["suffix", "Suffix"],
] as const;

function focusExportIssue(issue: LenderExportIssue) {
  const target = issue.section === "borrower" ? document.getElementById(exportCorrectionsTarget) ?? document.getElementById("loan-application") :
    issue.section === "names" ? document.getElementById(`${exportNamesTarget}-${issue.field ?? "0"}`) :
      document.getElementById(lenderFieldPrefix(issue.section) + issue.field);
  if (!target) return;
  for (let parent = target.closest("details"); parent; parent = parent.parentElement?.closest("details") ?? null) parent.open = true;
  const field = target.querySelector<HTMLElement>("input, textarea, select") ?? target;
  field.focus({ preventScroll: true });
  field.scrollIntoView({ block: "center" });
}

export function ManualLenderExport({ application, busy, save, campaignManual, linkedFile, previousFile, canRecordReturn, canRecordRejection, openConditions,
  shareBrokerage, handoffBlocker, openReviews, correctionSave, correctionBlocked, manualQuote, manualQuoteNeeded, manualQuoteCurrent, openPricing }: {
  application: StaffApplication;
  busy: boolean;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
  correctionSave: (input: unknown) => Promise<void>;
  correctionBlocked: boolean;
  campaignManual: boolean;
  linkedFile?: Submission;
  previousFile?: Submission;
  canRecordReturn: boolean;
  canRecordRejection: boolean;
  openConditions: (id: string) => void;
  shareBrokerage?: string;
  handoffBlocker: string | null;
  openReviews?: () => void;
  manualQuote?: ManualQuoteBasis;
  manualQuoteNeeded: boolean;
  manualQuoteCurrent: boolean;
  openPricing: () => void;
}) {
  const originals = application.draft ? [application.draft.borrowerName,
    ...application.draft.urla.additional.map((person) => person.identity.fields.name)] : [];
  const [names, setNames] = useState(() => originals.map(suggestExportName));
  const [profile, setProfile] = useState(() => {
    const handoff = application.manualHandoff;
    const prepared = manualQuote ? handoff?.preparedQuotes?.find((item) => sameManualQuote(item, manualQuote))?.profile :
      handoff?.exportProfiles?.[0] ?? (handoff?.exportPrepared ? defaultLenderExportProfile : undefined);
    return prepared ?? application.lastExportProfile ?? defaultLenderExportProfile;
  });
  const [confirmed, setConfirmed] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const acknowledgmentAttempt = useRef<{ key: string; id: string } | null>(null);
  const linkedAttempt = useRef<{ key: string; id: string } | null>(null);
  const returnAttempt = useRef<{ key: string; id: string } | null>(null);
  const rejectionAttempt = useRef<{ key: string; id: string } | null>(null);
  const ready = application.reviewedAt && application.submittedAt && !application.correctionNote && application.draft?.confirmedDemo;
  const details = manualQuote ? manualQuoteLenderDetails(application.lender?.details ?? blankLenderDetails(), manualQuote) : application.lender?.details;
  const issues = ready && application.draft ? lenderExportIssues(application.draft, details, names, profile) : [];
  const requested = submittedRequestedLoanAmount(application);
  const quoteIssue = manualQuoteNeeded ? nonAgencyManualHandoffMessage : manualQuote ? !manualQuoteCurrent ? "Reprice from the current 1003 before using this manual quote." :
    manualQuote.expiresOn < easternDate() ? "This manual quote expired. Choose a current offer in Pricing." :
      requested !== null && Math.round(requested * 100) !== Math.round(manualQuote.loanAmount * 100) ? "Choose a manual offer for the exact amount on the reviewed 1003." : null : null;
  const valid = !issues.length && !quoteIssue;
  const handoff = application.manualHandoff;
  const reference = manualQuote ? { runId: manualQuote.runId, offerId: manualQuote.offerId } : undefined;
  const prepared = handoff?.preparedExports?.find((item) => item.profile === profile && sameManualQuote(item.quote, reference));
  const exportPrepared = manualQuote ? handoff?.preparedQuotes?.some((item) => item.profile === profile && sameManualQuote(item, manualQuote)) :
    handoff?.exportProfiles ? handoff.exportProfiles.includes(profile) :
    handoff?.exportPrepared && profile === defaultLenderExportProfile;
  const initialCampaignHandoff = campaignManual && !manualQuote && !linkedFile && !previousFile;
  const correctionRecipient = application.joint && <label className="field">Correction recipient
    <select name="recipient" defaultValue="" required disabled={busy || correctionBlocked}>
      <option value="" disabled>Choose a borrower</option>
      {documentRecipients.map((recipient) => <option key={recipient}>{recipient}</option>)}
    </select>
  </label>;

  return <details className="application-review" id="manual-lender-export">
    <summary>Manual lender export</summary>
    <p className="muted">Prepare MISMO 3.4 XML for a fictional manual handoff. Live imports require the receiving lender’s verified specification.</p>
    {manualQuote && <section className="document-item" aria-label="Selected manual lender quote">
      <div className="document-item-head"><strong>{manualQuote.lender} · {manualQuote.product}</strong><span className="pill">Manual sample</span></div>
      <p>{manualQuote.rate.toFixed(3)}% · {manualQuote.years}-year fixed · Quote {manualQuote.reference} · Through {dateLabel(manualQuote.expiresOn)}</p>
      <p className="muted">The sample XML uses this offer’s note rate and term. Orbit keeps the quote with the export and acknowledgment.</p>
      {quoteIssue && <><p>{quoteIssue}</p><Button size="sm" variant="outline" disabled={busy} onClick={openPricing}>Open pricing</Button></>}
    </section>}
    {ready && handoffBlocker && <div className="document-item">
      <p>{linkedFile ? "An approved second review is required to share a new package." : handoffBlocker} You can prepare the XML for review.</p>
      {openReviews && <div><Button size="sm" variant="outline" disabled={busy} onClick={openReviews}>Open required second review</Button></div>}
    </div>}
    {!linkedFile && previousFile && <div className="document-item">
      <p className="muted">Previous lender file · {previousFile.lender} · {previousFile.externalId}. Its checklist is available while you prepare the revised export.</p>
      <div><Button size="sm" variant="outline" onClick={() => openConditions(previousFile.id)}>Open previous lender checklist</Button></div>
    </div>}
    {!ready ? <p className="muted">Review the current submitted pilot 1003 to unlock the download.</p> :
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || !valid) return;
        const input = { type: "exportReviewedApplication", loanId: application.loanId, revision: application.revision,
          lenderRevision: application.lender?.revision ?? 0, names, profile, manualQuote: reference };
        const key = JSON.stringify(input);
        if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
        void save({ ...input, eventId: attempt.current.id }, ({ mismoXml }) => {
          if (mismoXml) {
            downloadSampleFile(mismoXml, `orbit-fictional-1003-r${application.revision}.xml`, "application/xml");
            attempt.current = null;
          }
        });
      }}>
        <section className="document-item record-form" aria-label="MISMO export readiness">
          <div className="document-item-head"><strong>MISMO export readiness</strong>
            <span className="pill">{issues.length ? `${issues.length} to resolve` : "Profile checks passed"}</span></div>
          <label className="field">Export profile<select value={profile} disabled={busy} onChange={(event) => {
            const selected = lenderExportProfile.safeParse(event.target.value);
            if (selected.success) setProfile(selected.data);
          }}>
            {lenderExportProfile.options.map((id) => <option key={id} value={id}>{lenderExportProfiles[id].label}</option>)}
          </select></label>
          <p className="muted">{lenderExportProfiles[profile].description}</p>
          {!!issues.length && <ul className="loan-task-list">{issues.map((issue, index) => <li className="loan-task" key={index}>
            <div className="loan-task-copy"><strong>{issue.label}</strong><span>{issue.section === "borrower" ? "Reviewed 1003" :
              issue.section === "names" ? "Export names" : "Saved lender details"}</span></div>
            <Button size="sm" variant="outline" disabled={busy} aria-label={`Open field for ${issue.label}`}
              onClick={() => focusExportIssue(issue)}>Open field</Button>
          </li>)}</ul>}
        </section>
        <div>
          <p><strong>Mapped fields</strong> · {mismoHandoffCoverage.mapped}</p>
          <p><strong>Portal review</strong> · {mismoHandoffCoverage.review}</p>
        </div>
        {names.map((name, index) => <fieldset key={index} className="record-form" id={`${exportNamesTarget}-${index}`}>
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
    {shareBrokerage && <LenderHandoffShare key={application.lender?.revision ?? 0}
      brokerageId={shareBrokerage} loanId={application.loanId} revision={application.revision}
      lenderRevision={application.lender?.revision ?? 0} names={names} profile={profile} manualQuote={reference} manualLender={manualQuote?.lender}
      canCreate={!!ready && valid && confirmed && canRecordReturn && !handoffBlocker}
      onCreated={() => void save({ type: "refreshApplication", loanId: application.loanId })} />}
    {ready && initialCampaignHandoff && <section className="document-item" aria-label="Simulated lender acknowledgment" id={manualLenderAcknowledgmentTarget} tabIndex={-1}>
      <div className="document-item-head"><strong>Fictional lender acknowledgment</strong><span className="pill">Demo</span></div>
      <p className="muted">{exportPrepared ? "Record the simulated response and open the fictional lender checklist." :
          "Prepare the MISMO download for this profile to enable acknowledgment."}</p>
      <div><Button size="sm" disabled={busy || !exportPrepared || !!handoffBlocker || !!quoteIssue} onClick={() => {
        const lenderRevision = application.lender?.revision ?? 0;
        const key = `${profile}:${lenderRevision}`;
        if (acknowledgmentAttempt.current?.key !== key) acknowledgmentAttempt.current = { key, id: crypto.randomUUID() };
        void save({
          type: "acknowledgeCampaignLenderExport", loanId: application.loanId, revision: application.revision,
          lenderRevision, profile, eventId: acknowledgmentAttempt.current.id,
        }, ({ state }) => {
          acknowledgmentAttempt.current = null;
          const updated = state.applications.find((item) => item.loanId === application.loanId);
          const submissionId = updated?.manualHandoff?.submissionId;
          if (submissionId) openConditions(submissionId);
        });
      }}>Record simulated acknowledgment</Button></div>
    </section>}
    {ready && !initialCampaignHandoff && (exportPrepared || linkedFile) && <section className="document-item" aria-label="Manual lender acknowledgment" id={manualLenderAcknowledgmentTarget} tabIndex={-1}>
      <div className="document-item-head"><strong>Lender acknowledgment</strong><span className="pill">Manual</span></div>
      {linkedFile ? <>
        <p className="muted">Acknowledged by {linkedFile.lender} · {linkedFile.externalId}{handoff?.acknowledgedQuote && ` · Quote ${handoff.acknowledgedQuote.reference}`}</p>
        <Button size="sm" onClick={() => openConditions(linkedFile.id)}>Open lender conditions</Button>
        {canRecordReturn && <details className="document-form">
          <summary>Record lender return for corrections</summary>
          <form onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const note = String(fields.get("borrowerInstructions") ?? "").trim();
            const recipient = fields.get("recipient") ?? undefined;
            if (!note) return;
            const key = JSON.stringify({ note, recipient });
            if (returnAttempt.current?.key !== key) returnAttempt.current = { key, id: crypto.randomUUID() };
            void correctionSave({ type: "requestApplicationCorrection", loanId: application.loanId, revision: application.revision, note, recipient,
              lenderReturn: { eventId: returnAttempt.current.id, submissionId: linkedFile.id, lenderRevision: application.lender?.revision ?? 0 } });
          }}>
            {correctionRecipient}
            <label className="field">Instructions for the borrower<textarea name="borrowerInstructions" required rows={3} maxLength={500} disabled={correctionBlocked} /></label>
            <p className="muted">{application.joint ? "Only the selected borrower’s portion reopens." : "The borrower can reopen their existing link."} The lender checklist and its history stay on this loan.</p>
            <div><Button size="sm" type="submit" disabled={busy || correctionBlocked}>
              {application.joint ? "Record return and reopen portion" : "Record return and reopen 1003"}</Button></div>
          </form>
        </details>}
      </> : <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        if (handoffBlocker || quoteIssue) return;
        const fields = new FormData(event.currentTarget);
        const input = { type: "recordManualHandoff", loanId: application.loanId, revision: application.revision,
          lenderRevision: application.lender?.revision ?? 0, profile, outcome: "Acknowledged", note: "", manualQuote: reference,
          lenderFile: { lender: fields.get("lender"), externalId: fields.get("externalId") } };
        const key = JSON.stringify(input);
        if (linkedAttempt.current?.key !== key) linkedAttempt.current = { key, id: crypto.randomUUID() };
        void save({ ...input, eventId: linkedAttempt.current.id }, () => { linkedAttempt.current = null; });
      }}>
        <p className="muted">After the lender confirms receipt, record its reference to open or reuse a condition checklist on this loan.</p>
        <div className="form-grid">
          <label className="field">Lender name<input name="lender" required maxLength={160} defaultValue={manualQuote?.lender ?? previousFile?.lender} readOnly={!!manualQuote} /></label>
          <label className="field">Lender file reference<input name="externalId" required maxLength={160} defaultValue={previousFile?.externalId} /></label>
        </div>
        <div><Button size="sm" type="submit" disabled={busy || !!handoffBlocker || !!quoteIssue}>Record lender acknowledgment</Button></div>
      </form>}
    </section>}
    {ready && canRecordRejection && !linkedFile && !previousFile && !application.uwmReference && !application.uwmPendingReceipt && prepared &&
      <details className="document-form lender-rejection-form">
        <summary>Record rejection before acknowledgment</summary>
        <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          if (correctionBlocked) return;
          const fields = new FormData(event.currentTarget);
          const note = String(fields.get("borrowerInstructions") ?? "").trim();
          const recipient = fields.get("recipient") ?? undefined;
          const lenderRejection = { exportId: prepared.eventId, lenderRevision: application.lender?.revision ?? 0, profile,
            lender: String(fields.get("lender") ?? "").trim(), reference: String(fields.get("reference") ?? "").trim(),
            reason: String(fields.get("reason") ?? "").trim(), manualQuote: reference };
          if (!note || !lenderRejection.lender || !lenderRejection.reason) return;
          const key = JSON.stringify({ note, recipient, lenderRejection });
          if (rejectionAttempt.current?.key !== key) rejectionAttempt.current = { key, id: crypto.randomUUID() };
          void correctionSave({ type: "requestApplicationCorrection", loanId: application.loanId, revision: application.revision, note, recipient,
            lenderRejection: { ...lenderRejection, eventId: rejectionAttempt.current.id } });
        }}>
          <p className="muted">{application.joint ? "Only the selected borrower’s portion reopens. They can use their existing link." :
            "Reopens the 1003. The borrower can use their existing application link."}</p>
          <div className="form-grid">
            <label className="field">Lender name<input name="lender" required maxLength={160} defaultValue={manualQuote?.lender} readOnly={!!manualQuote} /></label>
            <label className="field">Lender reference (optional)<input name="reference" maxLength={160} /></label>
          </div>
          <label className="field">Lender rejection reason (staff only)<textarea name="reason" required rows={3} maxLength={500} /></label>
          {correctionRecipient}
          <label className="field">Instructions for the borrower<textarea name="borrowerInstructions" required rows={3} maxLength={500} /></label>
          <div><Button size="sm" type="submit" disabled={busy || correctionBlocked}>
            {application.joint ? "Record rejection and reopen portion" : "Record rejection and reopen 1003"}</Button></div>
        </form>
      </details>}
  </details>;
}
