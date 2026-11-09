"use client";

import { useEffect, useRef, useState } from "react";
import { readManagerExceptions } from "@/app/actions";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { dateLabel } from "@/lib/client-retention";
import { leadSources } from "@/lib/model";
import { documentReminderTimingLabel, documentReminderTimingLimit, manualReturnHoursLimit, secondReviewDueDaysLimit, type PlaybookWork } from "@/lib/playbook-model";
import { defaultManagerExceptionFilters, managerExceptionsUnavailable, managerExceptionTypes, type ManagerExceptionFilters,
  type ManagerExceptionPage, type ManagerExceptionResult, type ManagerExceptionRow } from "@/lib/manager-exception-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { BorrowerCallbackReschedule, ContactFollowUpCompletion } from "./contact-crm";
import { Button } from "./ui/button";
import { PlaybookRunHistory, type PlaybookRunHistoryHandle } from "./playbook-runs";
import { FileExceptions } from "./file-exceptions";
import type { FileException } from "@/lib/file-exception-model";
import type { ManualReturnAssignment } from "@/lib/lender-export-model";
import type { ReportingPeriod } from "@/lib/call-report-readiness-model";
import { ReportingReadinessPanel } from "./call-report-readiness";
import { ManagerCallbackExceptions } from "./manager-callback-exceptions";

export type ManagerExceptionView = "files" | "owners" | "reporting" | "callbacks";
const reminderTimingOptions = Array.from({ length: 2 * documentReminderTimingLimit + 1 }, (_, index) => index - documentReminderTimingLimit);

export function BrokeragePlaybooks({ staff, busy, save, refresh, open, openLead, openCampaignRun, openCallbackPromise, openContactFollowUp, openLoan, openAssignment, openFunding, openDocument, fileVersion, openFile, view, setView, filters, setFilters, reporting }: {
  staff: WorkspaceStaff | null; busy: boolean;
  save: (input: unknown, after?: () => void) => Promise<void>; refresh: () => Promise<void>; open: (item: PlaybookWork) => void;
  openLead: (id: string, preferInbox?: boolean) => void; openCampaignRun: (leadId: string, campaignId: string) => void;
  openCallbackPromise: React.ComponentProps<typeof ManagerCallbackExceptions>["open"];
  openContactFollowUp: (contactId: string, activityId: string) => void;
  openLoan: (id: string, processing: boolean) => void;
  openAssignment?: (id: string, manualReturn?: ManualReturnAssignment) => void;
  openFunding: (id: string) => void;
  openDocument: (loanId: string, requestId: string) => void;
  fileVersion: object;
  openFile: (item: FileException) => void;
  view: ManagerExceptionView;
  setView: (view: ManagerExceptionView) => void;
  filters: ManagerExceptionFilters;
  setFilters: (filters: ManagerExceptionFilters) => void;
  reporting: { period: ReportingPeriod; setPeriod: (period: ReportingPeriod) => void; openLoan: (id: string) => void; openReport: () => void };
}) {
  const brokerageId = staff?.brokerage.id ?? demoBrokerageId;
  const [changing, setChanging] = useState(false);
  const [metadata, setMetadata] = useState<{ brokerageId: string; result: ManagerExceptionResult }>();
  const [ownership, setOwnership] = useState<{ brokerageId: string; version: object; filters: ManagerExceptionFilters;
    page?: ManagerExceptionPage; error?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const runHistory = useRef<PlaybookRunHistoryHandle>(null);
  const endpoint = staff ? `/api/brokerages?brokerage=${encodeURIComponent(staff.brokerage.id)}` : "";
  useEffect(() => {
    let active = true;
    void readManagerExceptions({ view: "settings" }, brokerageId).catch(() => ({ error: managerExceptionsUnavailable })).then((result) => {
      if (active) setMetadata({ brokerageId, result });
    });
    return () => { active = false; };
  }, [brokerageId, fileVersion]);
  useEffect(() => {
    if (view !== "owners") return;
    let active = true;
    void readManagerExceptions({ view: "owners", filters }, brokerageId).catch(() => ({ error: managerExceptionsUnavailable })).then((result) => {
      if (active) setOwnership({ brokerageId, version: fileVersion, filters, ...("kind" in result && result.kind === "owners" ?
        { page: result } : { error: "error" in result ? result.error : managerExceptionsUnavailable }) });
    });
    return () => { active = false; };
  }, [brokerageId, view, filters, fileVersion]);
  const settingsResult = metadata?.brokerageId === brokerageId ? metadata.result : undefined;
  const settings = settingsResult && "kind" in settingsResult && settingsResult.kind === "settings" ? settingsResult : undefined;
  const settingsError = settingsResult && "error" in settingsResult ? settingsResult.error : undefined;
  const members = settings?.members ?? null;
  const current = ownership?.brokerageId === brokerageId && ownership.version === fileVersion && ownership.filters === filters ? ownership : undefined;
  const page = current?.page;

  const officers = members?.filter((member) => member.role !== "Processor") ?? [];
  const processors = members?.filter((member) => member.role === "Processor") ?? [];
  const reviewAdmins = members?.filter((member) => member.role === "Admin") ?? [];
  const policy = settings?.policy;
  const reviewPolicy = policy?.secondReview;
  const canConfigureSecondReview = staff?.brokerage.role === "Admin" && members !== null;
  const campaigns = settings?.campaigns ?? [];
  const exceptions = page?.rows ?? [];

  async function loadMore() {
    if (!page?.next || !current || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await readManagerExceptions({ view: "owners", filters, after: page.next }, brokerageId)
        .catch(() => ({ error: managerExceptionsUnavailable }));
      setOwnership((latest) => {
        if (latest !== current) return latest;
        if (!("kind" in result) || result.kind !== "owners") return { ...latest, error: "error" in result ? result.error : managerExceptionsUnavailable };
        const rows = new Map(page.rows.map((row) => [row.item.id, row]));
        for (const row of result.rows) rows.set(row.item.id, row);
        return { ...latest, page: { ...result, rows: [...rows.values()] }, error: undefined };
      });
    } finally {
      setLoadingMore(false);
    }
  }

  async function reassign({ item, processingRevision }: ManagerExceptionRow, email: string) {
    setError("");
    setMessage("");
    if (item.kind === "lead" || item.kind === "lead-owner" || item.kind === "campaign-follow-up" || item.kind === "campaign-recovery" ||
      item.kind === "lead-document-owner") {
      await save({ type: "assignInboxLead", leadId: item.recordId, email, previousEmail: item.ownerEmail,
        ...(item.kind === "lead-document-owner" ? { documentRecovery: true } : {}) });
      return;
    }
    if (item.kind === "contact-follow-up") {
      await save({ type: "assignContactFollowUp", contactId: item.recordId, eventId: item.id, revision: item.activity.revision, email });
      return;
    }
    const action = item.kind === "assign" || item.kind === "accept" || item.kind === "processor-owner" ?
      { type: "assignProcessor", loanId: item.recordId, email, revision: processingRevision } :
      { type: "assign", loanId: item.recordId, email, previousEmail: item.ownerEmail };
    setChanging(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not reassign this item.");
      await refresh();
      setMessage(result.message ?? "Assignment saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reassign this item."); }
    finally { setChanging(false); }
  }

  const canReviewCallbacks = staff?.brokerage.role === "Admin" && staff.brokerage.pilot === true;
  const canCheckDocuments = !staff || (staff.brokerage.role === "Admin" && (brokerageId === demoBrokerageId || staff.brokerage.pilot === true));

  return <div className="relationship-stack">
    <PlaybookRunHistory ref={runHistory} key={brokerageId} brokerageId={brokerageId} busy={busy} canCheckDocuments={canCheckDocuments}
      openLoan={openFunding} openLead={openCampaignRun} openDocument={openDocument} refreshWorkspace={refresh} />
    <section className="integration record-form manager-panel" aria-label="Manager exception queue">
      <div className="section-heading"><h2>Manager exception queue</h2>{view === "owners" && page && <span className="pill">{exceptions.length} shown</span>}</div>
      <div className="loan-application-actions" aria-label="Exception queue view">
        <Button size="sm" variant={view === "files" ? "default" : "outline"} aria-pressed={view === "files"} onClick={() => setView("files")}>File exceptions</Button>
        <Button size="sm" variant={view === "owners" && filters.type !== "Campaign recovery" ? "default" : "outline"}
          aria-pressed={view === "owners" && filters.type !== "Campaign recovery"} onClick={() => {
            if (filters.type === "Campaign recovery") setFilters({ ...filters, type: "All exceptions" });
            setView("owners");
          }}>Ownership and deadlines</Button>
        {staff && <Button size="sm" variant={view === "owners" && filters.type === "Campaign recovery" ? "default" : "outline"}
          aria-pressed={view === "owners" && filters.type === "Campaign recovery"} onClick={() => {
            setFilters({ ...filters, type: "Campaign recovery" });
            setView("owners");
          }}>Campaign recovery</Button>}
        {canReviewCallbacks && <Button size="sm" variant={view === "callbacks" ? "default" : "outline"}
          aria-pressed={view === "callbacks"} onClick={() => setView("callbacks")}>Overdue callbacks</Button>}
        <Button size="sm" variant={view === "reporting" ? "default" : "outline"} aria-pressed={view === "reporting"} onClick={() => setView("reporting")}>Reporting readiness</Button>
      </div>
      {settingsError && <p role="alert" className="application-error">{settingsError}</p>}
      {view === "files" ? <FileExceptions brokerageId={staff?.brokerage.id ?? demoBrokerageId} version={fileVersion} busy={busy}
        open={openFile} assign={openAssignment} /> :
      view === "callbacks" && canReviewCallbacks ? <ManagerCallbackExceptions brokerageId={brokerageId} campaigns={campaigns} officers={officers}
        teamLoaded={members !== null} version={fileVersion} busy={busy} save={save} open={openCallbackPromise} openAssignment={openAssignment}
        reviewRecovery={(id) => runHistory.current?.reviewCampaignRun(id)} /> :
      view === "reporting" ? <ReportingReadinessPanel brokerageId={staff?.brokerage.id ?? demoBrokerageId} version={fileVersion} busy={busy} {...reporting} /> : <>
      <p className="muted">Resolve overdue work, interrupted campaign follow-ups, missing owners, and unaccepted handoffs. Open lead documents and their deadlines follow the new owner.</p>
      <div className="loan-application-actions" role="group" aria-label="Exception filters">
        <label className="field playbook-filter">Exception type<select value={filters.type} onChange={(event) => setFilters({
          ...filters, type: event.target.value as ManagerExceptionFilters["type"],
        })}>{managerExceptionTypes.filter((type) => type !== "Lead documents" || staff?.brokerage.pilot).map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="field playbook-filter">Lead source<select value={filters.source} onChange={(event) => setFilters({
          ...filters, source: event.target.value as ManagerExceptionFilters["source"],
        })}>
          <option value="">Any source</option>{leadSources.map((source) => <option key={source}>{source}</option>)}
        </select></label>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy || changing}>Refresh exceptions</Button>
        <label className="field playbook-filter">Call campaign<select value={filters.campaign}
          onChange={(event) => setFilters({ ...filters, campaign: event.target.value })}>
          <option value="">Any campaign</option><option value="none">No campaign</option>
          {campaigns.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          {filters.campaign && filters.campaign !== "none" && !campaigns.some(({ id }) => id === filters.campaign) &&
            <option value={filters.campaign}>Campaign unavailable</option>}
        </select></label>
      </div>
      {(filters.source || filters.campaign) && <div className="loan-application-actions">
        <Button size="sm" variant="ghost" onClick={() => setFilters({ ...defaultManagerExceptionFilters, type: filters.type })}>Clear lead filters</Button>
      </div>}
      {error && <p role="alert" className="application-error">{error}</p>}
      {current?.error && <p role="alert" className="application-error">{current.error}</p>}
      {!current && <p role="status" className="muted">Loading ownership and deadlines…</p>}
      {message && <p role="status" className="application-message">{message}</p>}
      {exceptions.length ? <ul className="playbook-exceptions">{exceptions.map((row) => {
        const { item, overdue, unassigned, unavailable, stalled, intake, otherOwner } = row;
        const processor = item.kind === "assign" || item.kind === "accept" || item.kind === "processor-owner";
        const choices = (processor ? processors : officers).filter((member) => member.email !== item.ownerEmail &&
          member.email !== otherOwner);
        const backup = item.kind === "lead" && choices.some((member) => member.email === policy?.backupEmail) ? policy?.backupEmail : "";
        const campaignRecovery = item.kind === "campaign-recovery";
        const documentOwner = item.kind === "lead-document-owner";
        const assignmentLabel = `${unassigned ? "Assign" : "Reassign"}${item.kind === "campaign-follow-up" || campaignRecovery || documentOwner ? " lead" : ""}`;
        return <li className="document-item" key={item.id}>
          <div className="document-item-head"><strong>{item.title} · {item.name}</strong><span className="open-chip">
            {[campaignRecovery && "Recovery needed", unassigned && "Unassigned", unavailable && "Owner unavailable", overdue && "Overdue", stalled && "Stalled"].filter(Boolean).join(" · ")}
          </span></div>
          {intake && <p className="muted">{intake.source}{intake.campaign && item.kind !== "campaign-follow-up" && ` · ${intake.campaign.name}`}</p>}
          <p>{item.reason}</p><p className="muted">{item.owner || item.ownerEmail || "No owner"}{item.dueAt &&
            ` · Due ${documentOwner ? dateLabel(item.dueAt) : `${dateTime(item.dueAt)} ET`}`}</p>
          <div className="loan-application-actions">
            {campaignRecovery && <Button size="sm" disabled={busy || changing || unavailable} onClick={() => runHistory.current?.reviewCampaignRun(item.id)}>Review recovery</Button>}
            <Button size="sm" variant="outline" disabled={busy || changing} onClick={() => {
            if (documentOwner) openLead(item.recordId, true);
            else if (item.kind === "lead" || item.kind === "lead-owner" || item.kind === "campaign-follow-up" || campaignRecovery) openLead(item.recordId);
            else if (item.kind === "contact-follow-up") openContactFollowUp(item.recordId, item.id);
            else if (item.kind === "loan-owner" || item.kind === "processor-owner") openLoan(item.recordId, item.kind === "processor-owner");
            else open(item);
          }}>{item.kind === "contact-follow-up" ? "Open follow-up" : documentOwner ? "Open lead" : intake?.campaign ? "Open campaign" : intake ? "Open lead" : "Open work"}</Button>
            {openAssignment && (processor || item.kind === "loan-owner") && <Button size="sm" variant="outline" disabled={busy || changing}
              onClick={() => openAssignment(item.recordId)}>Manage assignment</Button>}
          </div>
          {campaignRecovery && unavailable && <small className="muted">Reassign this lead before restoring its follow-up.</small>}
          {item.kind === "contact-follow-up" && <>
            <ContactFollowUpCompletion item={item.activity} busy={busy || changing} save={save} />
            <BorrowerCallbackReschedule item={item.activity} busy={busy || changing} save={save} />
          </>}
          {staff && choices.length > 0 && <form className="brokerage-form" key={`${item.ownerEmail}:${backup}`} onSubmit={(event) => {
            event.preventDefault();
            const email = String(new FormData(event.currentTarget).get("owner") ?? "");
            if (email) void reassign(row, email);
          }}>
            <label className="field">{processor ? "New processor" : "New loan officer"}<select name="owner" defaultValue={backup ?? ""} required>
              <option value="">Select team member</option>{choices.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
            </select></label>
            <Button size="sm" type="submit" disabled={busy || changing}>{assignmentLabel}</Button>
          </form>}
          {staff && members && !choices.length && <small className="muted">No other active {processor ? "processor" : "loan officer"} is available.</small>}
        </li>;
      })}</ul> : page && <p className="empty-inline">No work matches this exception view.</p>}
      {page?.next && <div className="loan-application-actions"><Button variant="outline" size="sm" disabled={busy || loadingMore}
        onClick={() => void loadMore()}>Load more exceptions</Button></div>}
      </>}
    </section>
    <section className="integration manager-panel" aria-label="Playbook settings">
      <div className="section-heading"><h2>Playbook settings</h2></div>
      <p className="muted">Review and handoff deadlines follow these settings for open files. Post-funding timing applies when funding is recorded. Message drafts require staff review.</p>
      {!policy && !settingsError && <p className="muted" role="status">Loading playbook settings…</p>}
      {settingsError && <Button variant="outline" size="sm" onClick={() => void refresh()}>Retry playbook settings</Button>}
      {policy && <form className="record-form playbook-settings" key={policy.revision} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const reminderOffset = data.get("documentReminderOffsetDays");
        const secondReviewer = data.get("secondReviewerEmail");
        const secondReview = typeof secondReviewer === "string" ?
          (secondReviewer ? { reviewerEmail: secondReviewer, dueDays: Number(data.get("secondReviewDueDays")) } : null) : undefined;
        const changedReview = secondReview !== undefined &&
          (secondReview?.reviewerEmail !== reviewPolicy?.reviewerEmail || secondReview?.dueDays !== reviewPolicy?.dueDays);
        void save({ type: "savePlaybook", revision: policy.revision, quietHours: Number(data.get("quietHours")),
          reviewHours: Number(data.get("reviewHours")), handoffHours: Number(data.get("handoffHours")), fundingDays: Number(data.get("fundingDays")),
          manualReturnHours: Number(data.get("manualReturnHours")),
          ...(typeof reminderOffset === "string" ? { documentReminderOffsetDays: Number(reminderOffset) } : {}),
          ...(changedReview ? { secondReview } : {}),
          ...(canConfigureSecondReview ? { requireSecondReview: data.has("requireSecondReview") } : {}),
          backupEmail: data.get("backupEmail") || null });
      }}>
        <div className="form-grid">
          <label className="field">Hours after outreach without reply<input name="quietHours" type="number" min={1} max={336} defaultValue={policy.quietHours} required /></label>
          <label className="field">Hours to review a submitted 1003<input name="reviewHours" type="number" min={1} max={168} defaultValue={policy.reviewHours} required /></label>
          <label className="field">Hours to send or accept a handoff<input name="handoffHours" type="number" min={1} max={168} defaultValue={policy.handoffHours} required /></label>
          <label className="field">Hours to follow up on a lender return<input name="manualReturnHours" type="number" min={1}
            max={manualReturnHoursLimit} defaultValue={policy.manualReturnHours} required />
            <small className="muted">The deadline is set when the lender return is recorded.</small>
          </label>
          <label className="field">Days from funding to follow-up<input name="fundingDays" type="number" min={0} max={90} defaultValue={policy.fundingDays} required /></label>
          {canCheckDocuments && <div className="field">
            <label htmlFor="document-reminder-timing">Mock document reminder timing</label>
            <select id="document-reminder-timing" name="documentReminderOffsetDays" defaultValue={policy.documentReminderOffsetDays}
              aria-describedby="document-reminder-timing-help" required>
              {reminderTimingOptions.map((offset) => <option key={offset} value={offset}>{documentReminderTimingLabel(offset)}</option>)}
            </select>
            <small id="document-reminder-timing-help" className="muted">Timing applies to new mock runs. Existing runs keep the timing and borrower due date they recorded.</small>
          </div>}
          {staff && members && <label className="field">Suggested quiet-lead backup<select name="backupEmail" defaultValue={policy.backupEmail ?? ""}>
            <option value="">No backup selected</option>{officers.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
          </select></label>}
        </div>
        {canConfigureSecondReview && <fieldset className="record-form">
          <legend>1003 second review</legend>
          <label className="demo-confirm"><input type="checkbox" name="requireSecondReview" defaultChecked={policy.requireSecondReview}
            aria-describedby="second-review-checkpoint-help" /> Require second 1003 approval before handoff and mock UWM submission</label>
          <p className="muted" id="second-review-checkpoint-help">The checkpoint applies to sending and accepting a processing handoff and submitting a revision to mock UWM. Choose a reviewer manually or use automatic routing.</p>
          <p className="muted">Choose an admin to enable automatic routing after the first staff review of each submitted 1003 revision. A different staff member must take the second review. When the selected admin is unavailable for the file, assign the review manually. Existing reviews keep their assignments.</p>
          <div className="form-grid">
            <label className="field">Automatic second reviewer<select name="secondReviewerEmail" defaultValue={reviewPolicy?.reviewerEmail ?? ""}>
              <option value="">Manual assignment</option>
              {reviewAdmins.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
              {reviewPolicy && !reviewAdmins.some((member) => member.email === reviewPolicy.reviewerEmail) &&
                <option value={reviewPolicy.reviewerEmail}>Unavailable admin · {reviewPolicy.reviewerEmail}</option>}
            </select></label>
            <label className="field">Eastern calendar days to complete second review<input name="secondReviewDueDays" type="number" min={0} max={secondReviewDueDaysLimit}
              defaultValue={reviewPolicy?.dueDays ?? 1} required /></label>
          </div>
        </fieldset>}
        <div><Button type="submit" disabled={busy || changing || Boolean(staff && !members)}>Save playbook</Button></div>
      </form>}
    </section>
  </div>;
}
