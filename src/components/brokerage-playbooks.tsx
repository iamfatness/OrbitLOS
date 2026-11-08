"use client";

import { useEffect, useState } from "react";
import type { BrokerageMember, BrokerageSettings } from "@/lib/brokerage-model";
import type { Workspace } from "@/lib/model";
import type { PlaybookWork } from "@/lib/playbook-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const exceptionViews = ["All exceptions", "Overdue", "Unassigned", "Stalled handoffs"] as const;
type ExceptionView = typeof exceptionViews[number];

export function BrokeragePlaybooks({ state, work, staff, now, busy, save, refresh, open }: {
  state: Workspace; work: PlaybookWork[]; staff: WorkspaceStaff | null; now: number; busy: boolean;
  save: (input: unknown) => void; refresh: () => Promise<void>; open: (item: PlaybookWork) => void;
}) {
  const [members, setMembers] = useState<BrokerageMember[] | null>(null);
  const [filter, setFilter] = useState<ExceptionView>("All exceptions");
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = staff ? `/api/brokerages?brokerage=${encodeURIComponent(staff.brokerage.id)}` : "";
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load active team members. Reload this page to try again.");
      const team: BrokerageSettings = await response.json();
      setMembers(team.members.filter((member) => member.status === "Active"));
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint]);

  const officers = members?.filter((member) => member.role !== "Processor") ?? [];
  const processors = members?.filter((member) => member.role === "Processor") ?? [];
  const policy = state.playbook;
  const exceptions = work.flatMap((item) => {
    const overdue = Date.parse(item.dueAt) <= now;
    const unassigned = item.kind === "assign" || (staff ? !item.ownerEmail ||
      !!members && !(item.kind === "accept" ? processors : officers).some((member) => member.email === item.ownerEmail) : !item.owner);
    const stalled = overdue && (item.kind === "assign" || item.kind === "prepare" || item.kind === "accept");
    if (!(overdue || unassigned)) return [];
    if (filter === "Overdue" && !overdue || filter === "Unassigned" && !unassigned || filter === "Stalled handoffs" && !stalled) return [];
    return [{ item, overdue, unassigned, stalled }];
  });

  async function reassign(item: PlaybookWork, email: string) {
    setError("");
    setMessage("");
    if (item.kind === "lead") {
      save({ type: "assignInboxLead", leadId: item.recordId, email, previousEmail: item.ownerEmail });
      return;
    }
    const processing = state.loanProcessing.find((entry) => entry.loanId === item.recordId);
    const action = item.kind === "assign" || item.kind === "accept" ?
      { type: "assignProcessor", loanId: item.recordId, email, revision: processing?.revision ?? 0 } :
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

  return <div className="relationship-stack">
    <section className="integration record-form manager-panel" aria-label="Manager exception queue">
      <div className="section-heading"><h2>Manager exception queue</h2><span className="pill">{exceptions.length} shown</span></div>
      <p className="muted">Resolve overdue work, missing owners, and unaccepted handoffs. Assigning an owner preserves the original deadline.</p>
      <label className="field playbook-filter">Exception type<select value={filter} onChange={(event) => setFilter(event.target.value as ExceptionView)}>
        {exceptionViews.map((view) => <option key={view}>{view}</option>)}
      </select></label>
      {error && <p role="alert" className="application-error">{error}</p>}
      {message && <p role="status" className="application-message">{message}</p>}
      {exceptions.length ? <ul className="playbook-exceptions">{exceptions.map(({ item, overdue, unassigned, stalled }) => {
        const processor = item.kind === "assign" || item.kind === "accept";
        const choices = (processor ? processors : officers).filter((member) => member.email !== item.ownerEmail &&
          (!processor || member.email !== state.loans.find((loan) => loan.id === item.recordId)?.officerEmail));
        const backup = item.kind === "lead" && choices.some((member) => member.email === policy.backupEmail) ? policy.backupEmail : "";
        return <li className="document-item" key={item.id}>
          <div className="document-item-head"><strong>{item.title} · {item.name}</strong><span className="open-chip">
            {[unassigned && "Unassigned", overdue && "Overdue", stalled && "Stalled"].filter(Boolean).join(" · ")}
          </span></div>
          <p>{item.reason}</p><p className="muted">{item.owner || "No owner"} · Due {dateTime(item.dueAt)} ET</p>
          <div className="loan-application-actions"><Button size="sm" variant="outline" onClick={() => open(item)}>Open work</Button></div>
          {staff && choices.length > 0 && <form className="brokerage-form" key={`${item.ownerEmail}:${backup}`} onSubmit={(event) => {
            event.preventDefault();
            const email = String(new FormData(event.currentTarget).get("owner") ?? "");
            if (email) void reassign(item, email);
          }}>
            <label className="field">{processor ? "New processor" : "New loan officer"}<select name="owner" defaultValue={backup ?? ""} required>
              <option value="">Select team member</option>{choices.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
            </select></label>
            <Button size="sm" type="submit" disabled={busy || changing}>{unassigned ? "Assign" : "Reassign"}</Button>
          </form>}
          {staff && members && !choices.length && <small className="muted">No other active {processor ? "processor" : "loan officer"} is available.</small>}
        </li>;
      })}</ul> : <p className="empty-inline">No work matches this exception view.</p>}
    </section>
    <section className="integration manager-panel" aria-label="Playbook settings">
      <div className="section-heading"><h2>Playbook settings</h2></div>
      <p className="muted">Review and handoff deadlines follow these settings for open files. Post-funding timing applies when funding is recorded. Message drafts require staff review.</p>
      <form className="record-form playbook-settings" key={policy.revision} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        save({ type: "savePlaybook", revision: policy.revision, quietHours: Number(data.get("quietHours")),
          reviewHours: Number(data.get("reviewHours")), handoffHours: Number(data.get("handoffHours")), fundingDays: Number(data.get("fundingDays")),
          backupEmail: data.get("backupEmail") || null });
      }}>
        <div className="form-grid">
          <label className="field">Hours after outreach without reply<input name="quietHours" type="number" min={1} max={336} defaultValue={policy.quietHours} required /></label>
          <label className="field">Hours to review a submitted 1003<input name="reviewHours" type="number" min={1} max={168} defaultValue={policy.reviewHours} required /></label>
          <label className="field">Hours to send or accept a handoff<input name="handoffHours" type="number" min={1} max={168} defaultValue={policy.handoffHours} required /></label>
          <label className="field">Days from funding to follow-up<input name="fundingDays" type="number" min={0} max={90} defaultValue={policy.fundingDays} required /></label>
          {staff && members && <label className="field">Suggested quiet-lead backup<select name="backupEmail" defaultValue={policy.backupEmail ?? ""}>
            <option value="">No backup selected</option>{officers.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
          </select></label>}
        </div>
        <div><Button type="submit" disabled={busy || changing || Boolean(staff && !members)}>Save playbook</Button></div>
      </form>
    </section>
  </div>;
}
