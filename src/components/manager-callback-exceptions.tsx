"use client";

import { useEffect, useState } from "react";
import { readCampaignCallbackExceptions } from "@/app/actions";
import type { BrokerageMember } from "@/lib/brokerage-model";
import type { CallCampaign } from "@/lib/call-campaign-model";
import type { CampaignCallbackException, CampaignCallbackExceptionPage, CampaignCallbackExceptionQuery } from "@/lib/campaign-callback-exceptions-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function ManagerCallbackExceptions({ brokerageId, campaigns, officers, teamLoaded, version, busy, save, open, openAssignment, reviewRecovery }: {
  brokerageId: string; campaigns: Pick<CallCampaign, "id" | "name">[]; officers: BrokerageMember[]; teamLoaded: boolean; version: object; busy: boolean;
  save: (input: unknown, after?: () => void) => Promise<void>; open: (item: CampaignCallbackException) => void;
  openAssignment?: (loanId: string) => void; reviewRecovery: (id: string) => void;
}) {
  const [query, setQuery] = useState<CampaignCallbackExceptionQuery>({});
  const [data, setData] = useState<{ query: CampaignCallbackExceptionQuery; version: object; result: CampaignCallbackExceptionPage | { error: string } }>();

  useEffect(() => {
    let active = true;
    const update = (result: CampaignCallbackExceptionPage | { error: string }) => {
      if (active) setData({ query, version, result });
    };
    void readCampaignCallbackExceptions(query, brokerageId).then(update, () => update({ error: "Could not load overdue callbacks. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, version]);

  const current = data?.query === query && data.version === version ? data.result : undefined;
  const page = current && !("error" in current) ? current : undefined;
  const firstPage = () => setQuery((last) => ({ ...last, after: undefined }));

  return <section className="record-form" aria-label="Overdue promised callbacks">
    <p className="muted">Review missed callback promises on leads and loans. Changing the owner preserves the missed deadline and the current callback time.</p>
    <div className="loan-application-actions" role="group" aria-label="Overdue callback filters">
      <label className="field playbook-filter">Callback campaign
        <select value={query.campaignId ?? ""} onChange={(event) => setQuery({ ...query, campaignId: event.target.value || undefined, after: undefined })}>
          <option value="">Any campaign</option>{campaigns.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className="field playbook-filter">Callback owner
        <select value={query.ownerEmail === null ? "shared" : query.ownerEmail ?? ""} onChange={(event) => {
          const owner = event.target.value;
          setQuery({ ...query, ownerEmail: owner === "shared" ? null : owner || undefined, after: undefined });
        }}>
          <option value="">Any owner</option><option value="shared">Shared inbox</option>
          {officers.map(({ email, name }) => <option key={email} value={email}>{name}</option>)}
        </select>
      </label>
      <Button size="sm" variant="outline" onClick={firstPage}>Refresh overdue callbacks</Button>
      {(query.campaignId || query.ownerEmail !== undefined) && <Button size="sm" variant="ghost" onClick={() => setQuery({})}>Clear callback filters</Button>}
    </div>
    {!current && <p className="muted" role="status">Loading overdue callbacks…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {page && <>
      {page.items.length ? <ul className="playbook-exceptions">{page.items.map((item) => {
        const choices = officers.filter(({ email }) => email !== item.ownerEmail);
        const loanTask = item.loanTask;
        return <li className="document-item" key={item.id}>
          <div className="document-item-head"><strong>{item.name}</strong><span className="open-chip">Overdue promise</span></div>
          <p className="muted">{item.campaignName} · {item.owner}{item.loanTask && " · Continued on loan"}{teamLoaded && item.ownerEmail &&
            !officers.some(({ email }) => email === item.ownerEmail) && " · Owner unavailable"}</p>
          <p>Missed deadline · <time dateTime={item.dueAt}>{dateTime(item.dueAt, "medium")} ET</time></p>
          {item.scheduledAt && item.scheduledAt !== item.dueAt &&
            <p className="muted">Current callback time · <time dateTime={item.scheduledAt}>{dateTime(item.scheduledAt)} ET</time></p>}
          {item.request && <details className="document-form">
            <summary>View callback request</summary>
            <p><strong>{item.request.actor} · {dateTime(item.request.at, "medium")} ET</strong><br />{item.request.text}</p>
          </details>}
          <div className="loan-application-actions">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => open(item)}>{item.loanTask ? "Open loan callback" : "Open campaign callback"}</Button>
            {loanTask && openAssignment && <Button size="sm" variant="outline" disabled={busy}
              onClick={() => openAssignment(loanTask.loanId)}>Manage loan owner</Button>}
            {item.needsRecovery && <Button size="sm" variant="outline" disabled={busy} onClick={() => reviewRecovery(item.id)}>Review callback recovery</Button>}
          </div>
          {!item.loanTask && choices.length > 0 && <form className="brokerage-form" key={item.ownerEmail ?? "shared"} onSubmit={(event) => {
            event.preventDefault();
            const email = String(new FormData(event.currentTarget).get("owner") ?? "");
            if (email) void save({ type: "assignInboxLead", leadId: item.leadId, email, previousEmail: item.ownerEmail, callbackPromiseId: item.id }, firstPage);
          }}>
            <label className="field">New callback owner<select name="owner" required defaultValue="">
              <option value="">Select team member</option>{choices.map(({ email, name }) => <option key={email} value={email}>{name}</option>)}
            </select></label>
            <Button type="submit" size="sm" disabled={busy}>{item.ownerEmail ? "Reassign callback" : "Assign callback"}</Button>
          </form>}
          {!item.loanTask && teamLoaded && !choices.length && <small className="muted">No other active loan officer is available.</small>}
        </li>;
      })}</ul> : <p className="empty-inline">{page.next ? "No actionable callbacks on this page. Check the next page." : "No overdue callback promises match these filters."}</p>}
      {(query.after || page.next) && <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={firstPage}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>}
    </>}
  </section>;
}
