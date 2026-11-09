"use client";

import { useEffect, useState } from "react";
import { assignManagerRealtorReferral, readManagerRealtorQueue } from "@/app/actions";
import type { BrokerageMember } from "@/lib/brokerage-model";
import type { RealtorQueueReport as Report, RealtorQueueReportInput } from "@/lib/realtor-queue-report-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function RealtorQueueReport({ brokerageId, version, members, memberError, openLead, openLoan }: {
  brokerageId: string; version: object; members?: BrokerageMember[]; memberError: string;
  openLead: (leadId: string) => void; openLoan: (loanId: string) => void;
}) {
  const [query, setQuery] = useState<RealtorQueueReportInput>({ view: "Waiting", days: 7 });
  const [result, setResult] = useState<{ query: RealtorQueueReportInput; version: object; data: Report | { error: string } }>();
  const [assigning, setAssigning] = useState(false);
  const [assignment, setAssignment] = useState<{ message: string } | { error: string }>();
  useEffect(() => {
    let active = true;
    const update = (data: Report | { error: string }) => { if (active) setResult({ query, version, data }); };
    void readManagerRealtorQueue(query, brokerageId).then(update, () => update({ error: "Could not load the referral queue. Try refreshing." }));
    return () => { active = false; };
  }, [query, version, brokerageId]);
  const data = result?.query === query && result.version === version ? result.data : undefined;
  const page = data && !("error" in data) ? data : undefined;
  async function assign(item: Report["items"][number], officerEmail: string) {
    if (assigning) return;
    setAssigning(true);
    setAssignment(undefined);
    try {
      const response = await assignManagerRealtorReferral({ leadId: item.leadId, waitingSince: item.at, officerEmail }, brokerageId);
      setAssignment("error" in response ? { error: response.error ?? "The referral could not be assigned." } : { message: response.message });
      setQuery((current) => ({ ...current, after: page?.items.length === 1 ? undefined : current.after }));
    } catch {
      setAssignment({ error: "Could not confirm the assignment. Refresh the referral queue before trying again." });
    } finally {
      setAssigning(false);
    }
  }

  return <section className="integration record-form manager-panel" aria-label="Realtor queue report">
    <div className="section-heading"><h2>Shared realtor queue</h2>
      <Button size="sm" variant="outline" disabled={assigning} onClick={() => setQuery({ ...query, after: undefined })}>Refresh referral queue</Button></div>
    <p className="muted">See unassigned referrals and how long officers took to claim them. Returning a referral to the shared inbox starts a new wait.</p>
    <div className="filter-row">
      <label className="field">Report view<select value={query.view} disabled={assigning} onChange={(event) =>
        setQuery({ ...query, view: event.target.value as RealtorQueueReportInput["view"], after: undefined })}>
        <option>Waiting</option><option>Claim history</option></select></label>
      <label className="field">Claim window<select value={query.days} disabled={assigning} onChange={(event) =>
        setQuery({ ...query, days: event.target.value === "30" ? 30 : 7, after: undefined })}>
        <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
    </div>
    {!data && <p role="status">Loading referral queue…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {query.view === "Waiting" && memberError && <p role="alert">{memberError}</p>}
    {assignment && ("error" in assignment ? <p role="alert">{assignment.error}</p> : <p role="status">{assignment.message}</p>)}
    {page && <>
      <div className="details-grid">
        <div><span>Open unassigned</span><strong>{page.waiting}</strong></div>
        <div><span>Oldest wait</span><strong>{duration(page.oldestWaitSeconds)}</strong></div>
        <div><span>Claims in window</span><strong>{page.claims}</strong></div>
        <div><span>Average pickup</span><strong>{duration(page.averageWaitSeconds)}</strong><small>{page.measuredClaims} measured</small></div>
      </div>
      <p className="muted">Checked {dateTime(page.checkedAt)} ET. Older referrals may show an estimate from receipt. The average uses recorded queue starts.</p>
      {page.items.length ? <ul className="document-list">{page.items.map((item) => <li className="document-item" key={item.id}>
        <div className="document-item-head"><strong>{item.name}</strong><span className="pill">{duration(item.seconds)} {item.officer ? "to claim" : "waiting"}</span></div>
        <p>{item.realtor}{item.officer && ` · Claimed by ${item.officer}`}</p>
        <p className="muted">{item.officer ? "Claimed" : item.estimated ? "Received" : "In shared inbox since"} {dateTime(item.at)} ET
          {item.officer && item.estimated && " · Wait estimated from receipt"}
          {item.contactStatus && ` · ${item.contactStatus}`}{item.contactStatus?.startsWith("First contact") && item.contactStatus !== "First contact logged" && ` ${dateTime(item.dueAt)} ET`}</p>
        {item.loanId ? <div><Button variant="outline" size="sm" disabled={assigning} onClick={() => openLoan(item.loanId!)}>Open loan</Button></div> :
          item.closed ? <p className="muted">Closed lead</p> :
          <div><Button variant="outline" size="sm" disabled={assigning} onClick={() => openLead(item.leadId)}>Open lead</Button></div>}
        {query.view === "Waiting" && !!members?.length && <form className="brokerage-form" onSubmit={(event) => {
          event.preventDefault();
          const email = new FormData(event.currentTarget).get("officer");
          if (typeof email === "string" && email) void assign(item, email);
        }}>
          <label className="field">Assign to<select name="officer" aria-label={`Assign ${item.name} to`} required disabled={assigning} defaultValue="">
            <option value="" disabled>Choose an officer</option>
            {members.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
          </select></label>
          <Button type="submit" size="sm" disabled={assigning}>Assign referral</Button>
        </form>}
      </li>)}</ul> : <p className="empty-inline">{query.view === "Waiting" ? "No open unassigned realtor referrals." : "No claims recorded in this window."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" disabled={assigning} onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" disabled={assigning} onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
  </section>;
}
