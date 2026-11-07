"use client";

import { useRef, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { draftChannels, draftCopied, draftRecipient, renderDraft } from "@/lib/communication-templates";
import type { CommunicationDraft, DraftAudience, DraftChannel, Loan, Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Preview = (loanId: string, audience: DraftAudience, draftId?: string) => void;
type Save = (input: unknown) => Promise<void>;
const queueViews = ["Ready to copy", "Copied", "All drafts"] as const;

function stillLinked(draft: CommunicationDraft, loan: Loan) {
  return draft.contactId === draftRecipient(loan, draft.audience);
}

function DraftRows({ drafts, state, preview, showLoan }: {
  drafts: CommunicationDraft[]; state: Workspace; preview: Preview; showLoan?: boolean;
}) {
  return <ul className="communication-drafts">
    {drafts.map((draft) => {
      const loan = state.loans.find((item) => item.id === draft.loanId);
      if (!loan) return null;
      const recipient = state.contacts.find((item) => item.id === draft.contactId);
      const borrower = state.contacts.find((item) => item.id === loan.contactId);
      const copied = [draft.emailCopiedAt && "Email", draft.textCopiedAt && "Text"].filter(Boolean).join(" and ");
      const earlier = draft.milestone !== "Application received" && draft.milestone !== loan.stage;
      const linked = stillLinked(draft, loan);
      return <li key={draft.id} className="communication-draft-row">
        <div>
          <strong>{draft.milestone} · {draft.audience}</strong>
          <p className="muted">{recipient?.name ?? "Contact unavailable"}{showLoan && draft.audience === "Realtor" && borrower ? ` · Loan for ${borrower.name}` : ""}</p>
          <small className="muted">{dateTime(draft.createdAt)} ET · {copied ? `${copied} copied` : "Draft"}
            {!linked ? " · Recipient changed" : earlier ? " · Earlier milestone" : ""}</small>
        </div>
        <Button variant="outline" size="sm" disabled={!linked} aria-label={`Preview ${draft.audience.toLowerCase()} draft for ${draft.milestone}`}
          onClick={() => preview(draft.loanId, draft.audience, draft.id)}>Preview</Button>
      </li>;
    })}
  </ul>;
}

export function CommunicationQueue({ state, preview }: { state: Workspace; preview: Preview }) {
  const [view, setView] = useState<(typeof queueViews)[number]>("Ready to copy");
  const drafts = state.communicationDrafts.filter((draft) => {
    const loan = state.loans.find((item) => item.id === draft.loanId);
    if (!loan || view === "All drafts") return Boolean(loan);
    if (view === "Copied") return draftCopied(draft);
    return stillLinked(draft, loan) && !draftCopied(draft) && (draft.milestone === loan.stage || draft.milestone === "Application received");
  });
  return <section className="pipeline" aria-label="Milestone draft queue">
    <div className="pipeline-heading"><div><h2>Milestone drafts <span>{drafts.length} shown</span></h2>
      <p>Review borrower and realtor updates before copying them.</p></div></div>
    <div className="filter-row"><select aria-label="Draft status" value={view} onChange={(event) => setView(event.target.value as typeof view)}>
      {queueViews.map((option) => <option key={option}>{option}</option>)}
    </select></div>
    {drafts.length ? <div className="communication-queue"><DraftRows drafts={drafts} state={state} preview={preview} showLoan /></div>
      : <p className="empty-inline no-matches">{view === "Ready to copy" ? "No current drafts to copy. Drafts appear when an application is received or a loan changes stage." : "No drafts match this view."}</p>}
  </section>;
}

export function LoanCommunications({ loan, state, preview }: { loan: Loan; state: Workspace; preview: Preview }) {
  const drafts = state.communicationDrafts.filter((draft) => draft.loanId === loan.id);
  return <section className="details-section" aria-label="Loan communications">
    <div className="section-heading"><h3><Mail size={17} /> Communications</h3></div>
    <div className="loan-application-actions">
      <Button variant="outline" size="sm" onClick={() => preview(loan.id, "Borrower")}>Preview borrower update</Button>
      {loan.partnerId && <Button variant="outline" size="sm" onClick={() => preview(loan.id, "Realtor")}>Preview realtor update</Button>}
    </div>
    {!loan.partnerId && <p className="empty-inline">Link a realtor in Edit loan to preview their update.</p>}
    {drafts.length > 0 && <DraftRows drafts={drafts} state={state} preview={preview} />}
  </section>;
}

export function CommunicationPreview({ loan, state, audience, draftId, busy, save }: {
  loan: Loan; state: Workspace; audience: DraftAudience; draftId?: string; busy: boolean; save: Save;
}) {
  const [channel, setChannel] = useState<DraftChannel>("Email");
  const [status, setStatus] = useState("");
  const message = useRef<HTMLTextAreaElement>(null);
  const draft = draftId ? state.communicationDrafts.find((item) => item.id === draftId && item.loanId === loan.id && item.audience === audience) : undefined;
  const contactId = draftRecipient(loan, audience);
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact || (draftId && (!draft || !stillLinked(draft, loan)))) {
    return <p className="empty-inline">The intended recipient is no longer linked to this loan.</p>;
  }
  const recipientId = contact.id;
  const milestone = draft?.milestone ?? loan.stage;
  const content = renderDraft(audience, milestone, channel, contact.name, loan.officer);
  const copyText = content.subject ? `Subject: ${content.subject}\n\n${content.body}` : content.body;
  const destination = channel === "Email" ? contact.email : contact.phone;
  const saved = draft ?? state.communicationDrafts.find((item) => item.loanId === loan.id && item.contactId === contact.id && item.audience === audience && item.milestone === milestone);
  const copiedAt = channel === "Email" ? saved?.emailCopiedAt : saved?.textCopiedAt;
  const earlier = milestone !== loan.stage && milestone !== "Application received";

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      message.current?.focus();
      message.current?.select();
      setStatus("The draft is selected. Use your device’s copy shortcut.");
      return;
    }
    setStatus("Draft copied to clipboard.");
    await save({ type: "copyDraft", loanId: loan.id, contactId: recipientId, audience, milestone, channel });
  }

  return <div className="communication-preview">
    <div className="section-heading"><h3>{audience} milestone update</h3><span className="pill">Preview only</span></div>
    <div className="view-toggle" aria-label="Message channel">
      {draftChannels.map((option) => <button key={option} type="button" aria-pressed={channel === option} onClick={() => { setChannel(option); setStatus(""); }}>{option}</button>)}
    </div>
    <dl>
      <div><dt>To</dt><dd>{contact.name} <span className="muted">{destination || (channel === "Email" ? "· No email on file" : "· No phone on file")}</span></dd></div>
      <div><dt>Milestone</dt><dd>{milestone}</dd></div>
    </dl>
    {earlier && <p className="empty-inline">This draft is for an earlier milestone. The loan is now at {loan.stage}.</p>}
    <textarea ref={message} readOnly aria-label={`${channel} draft preview`} className="communication-message" value={copyText} rows={channel === "Email" ? 8 : 4} />
    <div className="loan-application-actions">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void copy()}><Copy /> Copy {channel.toLowerCase()} draft</Button>
      {copiedAt && <small className="muted">First copied {dateTime(copiedAt)} ET</small>}
    </div>
    {status && <p className="muted" role="status">{status}</p>}
    <p className="muted">Copy the draft to use in your email or messaging app.</p>
  </div>;
}
