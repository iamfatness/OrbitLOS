"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { readDraftWork, readLoanForWork } from "@/app/actions";
import { draftQueueUnavailable, draftQueueViews, type DraftQueuePage, type DraftQueueQuery, type DraftQueueRow } from "@/lib/communication-draft-model";
import { currentDraftMilestone, draftChannels, draftRecipient, renderDraft } from "@/lib/communication-templates";
import { draftMilestones, type BrokerageTemplate, type CommunicationDraft, type DraftAudience, type DraftChannel, type DraftMilestone, type Loan, type Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import type { ConversationSubject } from "@/lib/conversation-model";
import { reopenedMockClosingCondition } from "@/lib/loan-workflow";
import { Button } from "./ui/button";

type Preview = (loanId: string, audience: DraftAudience, draftId?: string) => void;
type Save = (input: unknown) => Promise<void>;

function stillLinked(draft: CommunicationDraft, loan: Loan) {
  return draft.contactId === draftRecipient(loan, draft.audience);
}

function DraftRows({ drafts, preview, showLoan, busy }: {
  drafts: DraftQueueRow[]; preview: Preview; showLoan?: boolean; busy?: boolean;
}) {
  return <ul className="communication-drafts">
    {drafts.map((draft) => {
      const copied = [draft.emailCopiedAt && "Email", draft.textCopiedAt && "Text"].filter(Boolean).join(" and ");
      return <li key={draft.id} className="communication-draft-row">
        <div>
          <strong>{draft.milestone} · {draft.audience}</strong>
          <p className="muted">{draft.recipient ?? "Contact unavailable"}{showLoan && draft.audience === "Realtor" && draft.borrower ? ` · Loan for ${draft.borrower}` : ""}</p>
          <small className="muted">{dateTime(draft.createdAt)} ET · {copied ? `${copied} copied` : "Draft"}
            {!draft.linked ? " · Recipient changed" : draft.supersededAt ? " · Superseded" : !draft.current ? " · Earlier milestone" : ""}</small>
        </div>
        <Button variant="outline" size="sm" disabled={busy || !draft.linked || (!draft.current && draft.milestone === "Closing complete")}
          aria-label={`Preview ${draft.audience.toLowerCase()} draft for ${draft.milestone}`}
          onClick={() => preview(draft.loanId, draft.audience, draft.id)}>Preview</Button>
      </li>;
    })}
  </ul>;
}

function hasClosingDate(state: Workspace, loanId: string) {
  return state.pastClients.some((profile) => profile.loanId === loanId && Boolean(profile.closingDate));
}

export function CommunicationQueue({ brokerageId, version, busy, preview, save }: {
  brokerageId: string; version: object; busy: boolean; preview: Preview; save: Save;
}) {
  const [view, setView] = useState<DraftQueueQuery["view"]>("Ready to copy");
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ view: typeof view; version: object; retry: number; page?: DraftQueuePage; error?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let active = true;
    void readDraftWork({ view }, brokerageId).catch(() => ({ error: draftQueueUnavailable })).then((result) => {
      if (!active) return;
      setData({ view, version, retry, ...("error" in result ? { error: result.error } : { page: result }) });
    });
    return () => { active = false; };
  }, [brokerageId, view, version, retry]);
  const current = data?.view === view && data.version === version && data.retry === retry ? data : undefined;
  const page = current?.page;

  async function loadMore() {
    if (!current || !page?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await readDraftWork({ view, after: page.next }, brokerageId).catch(() => ({ error: draftQueueUnavailable }));
      setData((previous) => {
        if (previous !== current) return previous;
        if ("error" in result) return { ...current, error: result.error };
        const rows = new Map(page.rows.map((row) => [row.id, row]));
        for (const row of result.rows) rows.set(row.id, row);
        return { ...current, page: { ...page, rows: [...rows.values()], next: result.next }, error: undefined };
      });
    } finally {
      setLoadingMore(false);
    }
  }

  return <><section className="pipeline" aria-label="Milestone draft queue">
    <div className="pipeline-heading"><div><h2>Milestone drafts {page && <span>{page.rows.length} shown</span>}</h2>
      <p>Review borrower and realtor updates before copying them.</p></div></div>
    <div className="filter-row"><select aria-label="Draft status" value={view} onChange={(event) => setView(event.target.value as typeof view)}>
      {draftQueueViews.map((option) => <option key={option}>{option}</option>)}
    </select><Button variant="outline" size="sm" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Refresh drafts</Button></div>
    {!current && <p className="empty-inline" role="status">Loading milestone drafts…</p>}
    {current?.error && <p className="empty-inline" role="alert">{current.error}</p>}
    {page && (page.rows.length ? <div className="communication-queue"><DraftRows drafts={page.rows} preview={preview} showLoan busy={busy} /></div>
      : <p className="empty-inline no-matches">{view === "Ready to copy" ? "No current drafts to copy. Drafts appear as applications, loan stages, and lender milestones change." : "No drafts match this view."}</p>)}
    {page?.next && <div className="filter-row"><Button size="sm" variant="outline" disabled={busy || loadingMore} onClick={() => void loadMore()}>
      {loadingMore ? "Loading drafts…" : "Load more drafts"}
    </Button></div>}
  </section>
  {data?.page?.templates && <BrokerageTemplates templates={data.page.templates} busy={busy || !current} save={save} />}
  </>;
}

export function LoanCommunications({ loan, state, preview, openConversation }: {
  loan: Loan; state: Workspace; preview: Preview; openConversation: (subject: ConversationSubject) => void;
}) {
  const drafts = state.communicationDrafts.filter((draft) => draft.loanId === loan.id).map((draft) => ({
    ...draft, recipient: state.contacts.find((contact) => contact.id === draft.contactId)?.name ?? null, borrower: null,
    linked: stillLinked(draft, loan), current: currentDraftMilestone(draft.milestone, loan.stage, hasClosingDate(state, loan.id)),
  }));
  const partnerId = loan.partnerId;
  return <section className="details-section" aria-label="Loan communications" id="loan-communications" tabIndex={-1}>
    <div className="section-heading"><h3><Mail size={17} /> Communications</h3></div>
    <div className="loan-application-actions">
      <Button variant="outline" size="sm" onClick={() => openConversation({ loanId: loan.id, contactId: loan.contactId, audience: "Borrower" })}>Open borrower conversation</Button>
      {partnerId && <Button variant="outline" size="sm" onClick={() => openConversation({ loanId: loan.id, contactId: partnerId, audience: "Realtor" })}>Open realtor conversation</Button>}
    </div>
    <div className="loan-application-actions">
      <Button variant="outline" size="sm" onClick={() => preview(loan.id, "Borrower")}>Preview borrower update</Button>
      {loan.partnerId && <Button variant="outline" size="sm" onClick={() => preview(loan.id, "Realtor")}>Preview realtor update</Button>}
    </div>
    {!loan.partnerId && <p className="empty-inline">Link a realtor in Edit loan to preview their update.</p>}
    {drafts.length > 0 && <DraftRows drafts={drafts} preview={preview} />}
  </section>;
}

function BrokerageTemplates({ templates, busy, save }: { templates: BrokerageTemplate[]; busy: boolean; save: Save }) {
  const [audience, setAudience] = useState<DraftAudience>("Borrower");
  const [milestone, setMilestone] = useState<DraftMilestone>("Application received");
  const current = templates.find((item) => item.audience === audience && item.milestone === milestone);
  const sample = renderDraft(audience, milestone, "Email", "Sample recipient", "Sample loan officer", current?.body);
  return <section className="pipeline relationship-panel" aria-label="Brokerage templates">
    <h2>Brokerage templates</h2>
    <p className="muted">Edit the message body used in previews. Use {"{{milestone}}"} to insert the stage. Keep realtor templates limited to milestone updates.</p>
    <div className="filter-row">
      <label className="field">Audience<select value={audience} onChange={(event) => setAudience(event.target.value as DraftAudience)}><option>Borrower</option><option>Realtor</option></select></label>
      <label className="field">Milestone<select value={milestone} onChange={(event) => setMilestone(event.target.value as DraftMilestone)}>
        {draftMilestones.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    <form className="record-form" key={`${audience}:${milestone}:${current?.revision ?? 0}`} onSubmit={(event) => {
      event.preventDefault();
      void save({ type: "saveBrokerageTemplate", audience, milestone, body: new FormData(event.currentTarget).get("body"), revision: current?.revision ?? 0 });
    }}>
      <label className="field">Message body<textarea name="body" defaultValue={current?.body} rows={3} maxLength={800} placeholder="Leave blank to use the default message" /></label>
      <div><Button size="sm" type="submit" disabled={busy}>Save template</Button></div>
    </form>
    <details><summary>Preview saved template</summary><p className="muted">{sample.subject}</p><textarea aria-label="Saved template preview" rows={5} readOnly value={sample.body} /></details>
  </section>;
}

export function CommunicationPreview({ loan, state, audience, draftId, brokerageId, busy, save }: {
  loan: Loan; state: Workspace; audience: DraftAudience; draftId?: string; brokerageId: string; busy: boolean; save: Save;
}) {
  const [channel, setChannel] = useState<DraftChannel>("Email");
  const [status, setStatus] = useState("");
  const [edits, setEdits] = useState<Partial<Record<DraftChannel, string>>>({});
  const [copying, setCopying] = useState(false);
  const [retired, setRetired] = useState(false);
  const message = useRef<HTMLTextAreaElement>(null);
  const draft = draftId ? state.communicationDrafts.find((item) => item.id === draftId && item.loanId === loan.id && item.audience === audience) : undefined;
  const contactId = draftRecipient(loan, audience);
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact || (draftId && (!draft || !stillLinked(draft, loan)))) {
    return <p className="empty-inline">The intended recipient is no longer linked to this loan.</p>;
  }
  const recipientId = contact.id;
  const milestone = draft?.milestone ?? loan.stage;
  const template = state.brokerageTemplates.find((item) => item.audience === audience && item.milestone === milestone);
  const content = renderDraft(audience, milestone, channel, contact.name, loan.officer, template?.body);
  const copyText = content.subject ? `Subject: ${content.subject}\n\n${content.body}` : content.body;
  const destination = channel === "Email" ? contact.email : contact.phone;
  const saved = draft ?? state.communicationDrafts.find((item) => item.loanId === loan.id && item.contactId === contact.id && item.audience === audience && item.milestone === milestone);
  const copiedAt = channel === "Email" ? saved?.emailCopiedAt : saved?.textCopiedAt;
  const superseded = retired || !!saved?.supersededAt || (milestone === "Clear to Close" && !!reopenedMockClosingCondition(loan.id, state.submissions));
  const earlier = !currentDraftMilestone(milestone, loan.stage, hasClosingDate(state, loan.id));
  if (earlier && milestone === "Closing complete") return <p className="empty-inline">Record the actual closing date to preview this draft.</p>;

  async function copy() {
    if (superseded || copying) return;
    if (milestone === "Clear to Close") {
      setCopying(true);
      try {
        const latest = await readLoanForWork(loan.id, brokerageId);
        if (!message.current) return;
        if ("error" in latest || draftRecipient(latest.loans[0], audience) !== recipientId ||
          reopenedMockClosingCondition(loan.id, latest.submissions) ||
          (saved ? !latest.communicationDrafts.some((item) => item.id === saved.id && !item.supersededAt) : latest.loans[0].stage !== milestone)) {
          setRetired(true);
          setStatus("This closing draft is no longer current. Reopen the loan for the latest update.");
          return;
        }
      } catch {
        setStatus("Could not verify the closing draft. Try again.");
        return;
      } finally {
        setCopying(false);
      }
    }
    try {
      await navigator.clipboard.writeText(edits[channel] ?? copyText);
    } catch {
      message.current?.focus();
      message.current?.select();
      setStatus("The draft is selected. Use your device’s copy shortcut.");
      return;
    }
    setStatus("Draft copied to clipboard.");
    await save({ type: "copyDraft", loanId: loan.id, contactId: recipientId, audience, milestone, channel, draftId: saved?.id });
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
    {superseded ? <p className="empty-inline">This draft has been superseded and is available in history.</p>
      : earlier && <p className="empty-inline">This draft is for an earlier milestone. The loan is now at {loan.stage}.</p>}
    {!superseded && <p className="muted">Based on the {milestone} milestone recorded on this loan. Review and edit before sharing.</p>}
    <textarea ref={message} aria-label={`${channel} draft preview`} className="communication-message" value={edits[channel] ?? copyText}
      onChange={(event) => setEdits({ ...edits, [channel]: event.target.value })} readOnly={superseded} rows={channel === "Email" ? 8 : 4} />
    <div className="loan-application-actions">
      {!superseded && <Button variant="outline" size="sm" disabled={busy || copying} onClick={() => void copy()}><Copy /> Copy {channel.toLowerCase()} draft</Button>}
      {copiedAt && <small className="muted">First copied {dateTime(copiedAt)} ET</small>}
    </div>
    {status && <p className="muted" role="status">{status}</p>}
    {!superseded && <p className="muted">Copy the draft to use in your email or messaging app.</p>}
  </div>;
}
