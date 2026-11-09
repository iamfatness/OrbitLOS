"use client";

import { useEffect, useState } from "react";
import { readTaskWork } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { fundingCheckInTarget } from "@/lib/loan-workflow";
import { fundingTaskAudience, reversedFundingTaskPrefix } from "@/lib/playbook-model";
import { queueActionLabel, workspaceTaskGroupNames, workspaceTasksUnavailable, workspaceTaskViews,
  type CalendarItem, type ContactTaskWork, type WorkspaceTaskList, type WorkspaceTaskPage } from "@/lib/officer-queue-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { BorrowerCallbackReschedule, ContactFollowUpAssignment, ContactFollowUpCompletion, ContactFollowUpResult } from "./contact-crm";
import { LoanTaskRow } from "./loan-task";
import { Button } from "./ui/button";
import { useLeadOwners } from "./use-lead-owners";

type Save = (input: unknown, after?: () => void) => Promise<void>;

export function PagedTaskQueue({ staff, version, busy, focusContact, openWork, openHistory, save }: {
  staff: WorkspaceStaff; version: object; busy: boolean; focusContact?: string;
  openWork: (item: CalendarItem) => void; openHistory: (id: string, realtor: boolean) => void; save: Save;
}) {
  const { id: brokerageId, role } = staff.brokerage;
  const [query, setQuery] = useState<WorkspaceTaskList>({
    type: "list", scope: role === "Admin" ? "Team" : role === "LO" ? "Available" : "Mine", view: "Open", group: "All work",
  });
  const [result, setResult] = useState<{ query: WorkspaceTaskList; version: object; page?: WorkspaceTaskPage; error?: string }>();
  const [selection, setSelection] = useState<{ from?: string; id?: string }>();
  const [detail, setDetail] = useState<{ id: string; version: object; work?: ContactTaskWork; error?: string }>();
  const selected = selection?.from === focusContact ? selection?.id : focusContact;
  const contact = detail?.id === selected ? detail : undefined;
  const { members, error: ownerError } = useLeadOwners(selected && role === "Admin" ? brokerageId : null);

  useEffect(() => {
    let active = true;
    const update = (data: Awaited<ReturnType<typeof readTaskWork>>) => {
      if (!active) return;
      setResult({ query, version, ...("kind" in data && data.kind === "list" ? { page: data } :
        { error: "error" in data ? data.error : workspaceTasksUnavailable }) });
    };
    void readTaskWork(query, brokerageId).then(update, () => update({ error: workspaceTasksUnavailable }));
    return () => { active = false; };
  }, [brokerageId, query, version]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const update = (data: Awaited<ReturnType<typeof readTaskWork>>) => {
      if (!active) return;
      setDetail({ id: selected, version, ...("kind" in data && data.kind === "contact" ? { work: data } :
        { error: "error" in data ? data.error : "Could not open this follow-up." }) });
    };
    void readTaskWork({ type: "contact", id: selected }, brokerageId).then(update, () => update({ error: "Could not open this follow-up." }));
    return () => { active = false; };
  }, [brokerageId, selected, version]);

  function change(values: Partial<Pick<WorkspaceTaskList, "view" | "scope" | "group">>) {
    setQuery((current) => ({ ...current, ...values, after: undefined, checkedAt: undefined }));
  }
  function selectContact(id?: string) {
    setDetail(undefined);
    setSelection({ from: focusContact, id });
  }
  const current = result?.query === query ? result : undefined;
  const page = current?.page;
  const reading = current?.version !== version;
  const contactLoading = !!selected && contact?.version !== version;
  const work = contact?.work;
  const contactTaskId = work?.item.id;
  useEffect(() => {
    if (!contactTaskId) return;
    const row = document.getElementById(`contact-follow-up-${contactTaskId}`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [contactTaskId]);
  return <section className="pipeline" aria-label="Task queue">
    <div className="pipeline-heading"><div><h2>Follow-up queue</h2>
      <p>Find follow-ups by deadline or review completed work and open the linked record.</p></div></div>
    <div className="filter-row">
      <Button size="sm" variant={query.scope === "Mine" ? "default" : "outline"} aria-pressed={query.scope === "Mine"}
        onClick={() => change({ scope: "Mine" })}>My Tasks</Button>
      {role !== "Processor" && <Button size="sm" variant={query.scope !== "Mine" ? "default" : "outline"} aria-pressed={query.scope !== "Mine"}
        onClick={() => change({ scope: role === "Admin" ? "Team" : "Available" })}>{role === "Admin" ? "Team tasks" : "My tasks and shared leads"}</Button>}
      <select aria-label="Task status" value={query.view} onChange={(event) => change({ view: event.target.value as WorkspaceTaskList["view"] })}>
        {workspaceTaskViews.map((view) => <option key={view}>{view}</option>)}
      </select>
      <select aria-label="Task category" value={query.group} onChange={(event) => change({ group: event.target.value as WorkspaceTaskList["group"] })}>
        {workspaceTaskGroupNames.map((group) => <option key={group}>{group}</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={() => change({})}>Refresh tasks</Button>
    </div>
    {selected && <section className="work-queue" aria-label="Selected contact follow-up">
      <div className="section-heading"><h3>Contact follow-up</h3><Button size="sm" variant="ghost" onClick={() => selectContact()}>Close follow-up</Button></div>
      {contactLoading && <p role="status">Opening follow-up…</p>}
      {contact?.error && <p role="alert">{contact.error}</p>}
      {ownerError && <p role="alert">{ownerError}</p>}
      {work && <ul className="loan-task-list"><LoanTaskRow id={`contact-follow-up-${work.item.id}`}
        task={{ title: work.item.postFundingCheckIn ? "Post-funding follow-up" : `Follow up after ${work.item.kind.toLowerCase()}`,
          dueAt: work.item.dueAt!, completedAt: work.item.completedAt, purpose: work.item.purpose }}
        officer={work.item.followUpOwner ?? ""} borrower={work.contact.name} busy={busy || contactLoading} blocked={work.blocked}
        context={work.item.outcome ?? undefined} openLoan={() => openHistory(work.contact.id, work.contact.role === "Realtor")}
        onChange={work.item.completedAt ? () => void save({ type: "completeContactFollowUp", contactId: work.contact.id,
          eventId: work.item.id, revision: work.item.revision, completed: false }) : undefined}>
        <ContactFollowUpResult completion={work.item.latestCompletion} current={!!work.item.completedAt} />
        {!work.item.completedAt && !work.blocked && <ContactFollowUpCompletion item={work.item} busy={busy || contactLoading} save={save} />}
        {!work.blocked && <BorrowerCallbackReschedule item={work.item} busy={busy || contactLoading} save={save} />}
        {role === "Admin" && members && !work.item.completedAt && !work.blocked &&
          <ContactFollowUpAssignment item={work.item} members={members} busy={busy || contactLoading} save={save} />}
      </LoanTaskRow></ul>}
    </section>}
    {reading && <p className="empty-inline" role="status">Loading tasks…</p>}
    {current?.error && <p role="alert" className="empty-inline">{current.error}</p>}
    {page && <>
      <div className="section-heading"><h3>{page.items.length} on this page</h3><span className="muted">Checked {dateTime(page.checkedAt)} ET</span></div>
      {page.items.length ? <ul className="loan-task-list">{page.items.map((item) => {
        const date = item.handoffDueAt ?? item.dueAt;
        const event = item.kind === "document-review" || item.kind === "uwm-alert" || (item.kind === "handoff" && !item.handoffDueAt);
        const toggle = (item.kind === "loan" || (item.kind === "funding" && fundingTaskAudience(item.id) === "Realtor")) &&
          item.target !== fundingCheckInTarget && item.target !== "loan-application" && !item.id.startsWith(reversedFundingTaskPrefix) && !item.blocked;
        const timeLabel = item.completedAt ? item.kind === "uwm-alert" ? "Reviewed" : "Completed" :
          event ? item.kind === "handoff" ? "Updated" : "Received" : item.overdue ? "Overdue" : "Due";
        return <li className="loan-task" key={`${item.kind}:${item.id}`}>
          <div className="loan-task-copy"><strong>{item.title}</strong><span>{item.name} · {item.owner}</span>
            {item.reason && <span>{item.reason}</span>}
            <span>{timeLabel} · {date.length === 10 ? dateLabel(date) : `${dateTime(date)} ET`}</span>
            {item.blocked && <span className="pill">Blocked by outreach opt-out</span>}</div>
          <div className="loan-application-actions">
            <Button size="sm" variant="outline" disabled={busy || reading}
              onClick={() => item.kind === "contact" ? selectContact(item.id) : openWork(item)}>{queueActionLabel(item)}</Button>
            {toggle && <Button size="sm" variant="ghost" disabled={busy || reading}
              onClick={() => void save({ type: "completeTask", id: item.id, completed: !item.completedAt }, () => change({}))}>
              {item.completedAt ? "Reopen" : "Mark complete"}
            </Button>}
            {item.kind === "uwm-alert" && !item.completedAt && <Button size="sm" variant="ghost" disabled={busy || reading}
              onClick={() => void save({ type: "reviewUwmAlert", loanId: item.recordId, alertId: item.id }, () => change({}))}>Mark reviewed</Button>}
          </div>
        </li>;
      })}</ul> : <p className="empty-inline">{page.next ? "No actionable tasks on this page. Check the next page." :
        query.view === "Completed" ? "No completed work matches these filters." : "No active tasks match these filters."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => change({})}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" disabled={reading || busy} onClick={() => setQuery({
          ...query, after: page.next ?? undefined, checkedAt: page.checkedAt,
        })}>Next page</Button>}
      </div>
    </>}
  </section>;
}
