"use client";

import { useEffect, useState } from "react";
import { readSharedRealtorPage } from "@/app/actions";
import type { VersionedBrokerageMember } from "@/lib/brokerage-model";
import { sharedRealtorOfficerLimit, type RealtorClaimPolicy, type SharedRealtorQueue } from "@/lib/realtor-claim-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function SharedRealtorPolicyForm({ policy, members, busy, save }: {
  policy: RealtorClaimPolicy; members: VersionedBrokerageMember[]; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const eligible = members.filter(({ role, status }) => role === "LO" && status === "Active");
  const [selected, setSelected] = useState(() => new Set(eligible.filter((member) => policy.officers.some((officer) =>
    officer.email === member.email && officer.accessRevision === member.accessRevision)).map(({ email }) => email)));
  return <details className="loan-task-create">
    <summary>Shared realtor claim eligibility</summary>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      void save({ type: "saveRealtorClaimPolicy", revision: policy.revision, officers: [...selected] });
    }}>
      <p className="muted">Choose up to {sharedRealtorOfficerLimit} active loan officers who can claim unassigned realtor referrals. With no officers selected, admins assign these referrals.</p>
      {!eligible.length && <p className="muted">Invite a loan officer from Team to enable self-claim.</p>}
      {eligible.map((member) => <label className="demo-confirm" key={member.email}>
        <input type="checkbox" checked={selected.has(member.email)}
          disabled={busy || (!selected.has(member.email) && selected.size >= sharedRealtorOfficerLimit)} onChange={(event) => {
            const next = new Set(selected);
            if (event.target.checked) next.add(member.email); else next.delete(member.email);
            setSelected(next);
          }} /> {member.name} · {member.email}
      </label>)}
      <div><Button type="submit" size="sm" disabled={busy}>Save claim eligibility</Button></div>
    </form>
  </details>;
}

type Cursor = NonNullable<SharedRealtorQueue["next"]>;

export function SharedRealtorQueueView({ brokerageId, busy, claim }: {
  brokerageId: string; busy: boolean; claim: (leadId: string) => void;
}) {
  const [query, setQuery] = useState<{ after?: Cursor }>({});
  const [data, setData] = useState<{ query: typeof query; result: SharedRealtorQueue | { error: string } }>();
  useEffect(() => {
    let active = true;
    const update = (result: SharedRealtorQueue | { error: string }) => { if (active) setData({ query, result }); };
    void readSharedRealtorPage(query, brokerageId).then(update, () => update({ error: "Could not load shared referrals. Try refreshing." }));
    return () => { active = false; };
  }, [query, brokerageId]);
  const result = data?.query === query ? data.result : undefined;
  return <section className="work-queue" aria-label="Shared realtor referrals">
    <div className="document-item-head"><h3>Shared realtor referrals</h3>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setQuery({})}>Refresh shared referrals</Button></div>
    <p className="muted">Claim a referral to open the borrower’s details and start follow-up.</p>
    {!result ? <p role="status">Checking for shared referrals…</p> : "error" in result ? <p role="alert">{result.error}</p> : <>
      {result.leads.length ? <ul className="document-list">{result.leads.map((lead) => <li className="document-item" key={lead.id}>
        <div className="document-item-head"><strong>{lead.realtor}</strong><span className="pill">{lead.purpose}</span></div>
        <p className="muted">{lead.firstContactLogged ? "First contact logged" : `First contact due ${dateTime(lead.dueAt)} ET`}</p>
        <Button size="sm" disabled={busy} onClick={() => claim(lead.id)}>Claim referral</Button>
      </li>)}</ul> : <p className="muted">{result.next ? "No claimable referrals on this page." : "No shared realtor referrals are ready to claim."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" disabled={busy} onClick={() => setQuery({})}>First page</Button>}
        {result.next && <Button size="sm" variant="outline" disabled={busy} onClick={() => setQuery({ after: result.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
  </section>;
}
