"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { brokerageRoles, brokerageUrl, type BrokerageSettings } from "@/lib/brokerage-model";
import type { Workspace } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function BrokerageTeam({ staff, state, refresh }: {
  staff: WorkspaceStaff; state: Workspace; refresh: () => Promise<void>;
}) {
  const endpoint = `/api/brokerages?brokerage=${staff.brokerage.id}`;
  const [settings, setSettings] = useState<BrokerageSettings | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loanId, setLoanId] = useState("");
  const creating = useRef<string | null>(null);
  const loan = state.loans.find((item) => item.id === loanId);
  const admin = staff.brokerage.role === "Admin";

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Reload the workspace to check your brokerage access.");
      setSettings(await response.json());
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint]);

  async function change(action: Record<string, unknown>, reset?: () => void) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const result = await response.json() as { error?: string; created?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Orbit could not save this change.");
      if (result.created) { window.location.assign(brokerageUrl(result.created)); return; }
      if ((action.type === "role" || action.type === "revoke") && action.email === staff.email) {
        window.location.assign(action.type === "revoke" ? "/workspace" : brokerageUrl(staff.brokerage.id));
        return;
      }
      if (action.type === "assign") await refresh();
      const current = await fetch(endpoint);
      if (!current.ok) throw new Error("The change was saved. Reload to check your brokerage access.");
      setSettings(await current.json());
      setMessage(result.message ?? "Saved.");
      reset?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Orbit could not save this change."); }
    finally { setBusy(false); }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    creating.current ??= crypto.randomUUID();
    void change({ type: "create", name, id: creating.current });
  }

  return <div className="relationship-stack">
    <section className="pipeline relationship-panel" aria-label="Brokerage workspaces">
      <div className="section-heading"><h2>{staff.brokerage.name}</h2><span className="pill">{staff.brokerage.role}</span></div>
      <div className="loan-application-actions">{settings?.brokerages.filter((item) => item.id !== staff.brokerage.id).map((item) =>
        <Button key={item.id} asChild size="sm" variant="outline"><a href={brokerageUrl(item.id)}>Open {item.name}</a></Button>)}</div>
      {admin && <details className="document-form"><summary>Create brokerage</summary><form onSubmit={create}>
        <label className="field">Brokerage name<input name="name" required minLength={2} maxLength={80} /></label>
        <Button type="submit" size="sm" disabled={busy}>Create workspace</Button>
      </form></details>}
    </section>
    {error && <p role="alert" className="application-message banner-error">{error}</p>}
    {message && <p role="status" className="application-message">{message}</p>}
    {admin && settings && <>
      <section className="pipeline relationship-panel" aria-label="Staff access">
        <h2>Staff access</h2><p className="muted">Invite by Google email, then share the Orbit sign-in link. The invite activates when that account signs in.</p>
        <form className="brokerage-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void change({ type: "invite", email: data.get("email"), role: data.get("role") }, () => form.reset());
        }}>
          <label className="field">Google email<input name="email" type="email" required maxLength={254} /></label>
          <label className="field">Invite role<select name="role" defaultValue="LO">{brokerageRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
          <Button type="submit" size="sm" disabled={busy}>Save invitation</Button>
        </form>
        <ul className="document-list">{settings.members.map((member) => <li className="document-item" key={member.email}>
          <div className="document-item-head"><strong>{member.email}</strong><span className="pill">{member.status}</span></div>
          {member.status !== "Revoked" && <form className="brokerage-form" key={member.role} onSubmit={(event) => {
            event.preventDefault();
            void change({ type: "role", email: member.email, role: new FormData(event.currentTarget).get("role") });
          }}>
            <label className="field">Staff role<select name="role" defaultValue={member.role}>{brokerageRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>Save role</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
              if (window.confirm(`Revoke brokerage access for ${member.email}?`)) void change({ type: "revoke", email: member.email });
            }}>Revoke access</Button>
          </form>}
        </li>)}</ul>
      </section>
      <section className="pipeline relationship-panel" aria-label="Loan reassignment">
        <h2>Loan reassignment</h2><p className="muted">Open tasks follow the loan’s new owner.</p>
        <form className="brokerage-form" onSubmit={(event) => {
          event.preventDefault();
          if (loan) void change({ type: "assign", loanId: loan.id, previousEmail: loan.officerEmail, email: new FormData(event.currentTarget).get("email") });
        }}>
          <label className="field">Loan<select value={loanId} onChange={(event) => setLoanId(event.target.value)} required><option value="">Choose a loan</option>
            {state.loans.map((item) => <option key={item.id} value={item.id}>{state.contacts.find((contact) => contact.id === item.contactId)?.name} · {item.address || item.stage}</option>)}</select></label>
          <label className="field">New owner<select name="email" required defaultValue=""><option value="">Choose active staff</option>
            {settings.members.filter((member) => member.status === "Active").map((member) => <option value={member.email} key={member.email}>{member.email}</option>)}</select></label>
          <Button type="submit" size="sm" disabled={busy || !loan}>Reassign loan</Button>
        </form>
        {loan && <p className="muted">Current owner {loan.officerEmail ?? (loan.officer || "Unassigned")}</p>}
      </section>
      <section className="pipeline relationship-panel" aria-label="Access history">
        <h2>Access history</h2>
        <ul className="document-list">{settings.history.map((event) => <li className="document-item" key={event.id}>
          <strong>{event.action}</strong><p>{event.subject}</p><small className="muted">{event.actor} · {dateTime(event.createdAt)} ET</small>
        </li>)}</ul>
        {!settings.history.length && <p className="muted">Staff and link changes will appear here.</p>}
      </section>
    </>}
  </div>;
}
